#!/usr/bin/env python3
"""PLATEAU 公式 CityGML（建築物モデル）→ public/plateau/ の静的タイル（z16 XYZ）へ変換する。

入力（fetch_citygml.py / fetch_evac.py の出力、リポジトリ外）:
  {cache}/citygml/bldg/{mesh}.gml.gz, {cache}/citygml/codelists/*.xml, {cache}/citygml/fetch_meta.json
  {cache}/evac_skhb05.geojson（任意）
出力（docs/award/00_分担表.md の「A1→A2 のデータ契約」）:
  public/plateau/index.json
  public/plateau/16/{x}_{y}.json  … 建物の配列

1件の形:
  {"ring": [[lon,lat],...], "h": 実測高さm|null, "s": 地上階数|null,
   "st": "wood"|"rc"|"src"|"steel"|"other"|null, "u": 用途|null, "td": 津波浸水深m|null,
   "evac": 避難場所名|false, "id": 建物ID,
   追加（契約の拡張・任意）: "sc": 建物区分 "sturdy"|"ordinary"|"shed"|"sturdy_shed"|null, "fd": 洪水浸水想定の深さm|null}

使い方:
  python3 scripts/plateau/build_tiles.py --cache /path/to/scratch/A1 [--wards 23105,23109,23110,23111,23112]
"""
import argparse
import concurrent.futures as cf
import glob
import gzip
import json
import math
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ensure_dir, lonlat_to_tile, tile_bounds  # noqa: E402

Z = 16
NS = {
    "bldg": "http://www.opengis.net/citygml/building/2.0",
    "gml": "http://www.opengis.net/gml",
    "core": "http://www.opengis.net/citygml/2.0",
}
BLDG = "{%s}" % NS["bldg"]
GML = "{%s}" % NS["gml"]
WARDS_DEFAULT = "23105,23109,23110,23111,23112"  # 中村・熱田・中川・港・南
WARD_NAMES = {"23105": "中村区", "23109": "熱田区", "23110": "中川区", "23111": "港区", "23112": "南区"}

# uro:buildingStructureType（標準製品仕様書のコードリスト 601〜611）→ 契約の正規化
STRUCT_MAP = {"601": "wood", "602": "src", "603": "rc", "604": "steel", "605": "steel", "606": "other",
              "610": "other", "611": None}
# bldg:class（公共測量標準図式の建物区分）
CLASS_MAP = {"3001": "ordinary", "3002": "sturdy", "3003": "shed", "3004": "sturdy_shed", "3000": None, "9999": None}


def local(tag):
    return tag.rsplit("}", 1)[-1]


def ns_of(tag):
    return tag[1:].split("}", 1)[0] if tag.startswith("{") else ""


def load_codelist(path):
    if not os.path.exists(path):
        return {}
    s = open(path, encoding="utf-8").read()
    return {n.strip(): d.strip() for d, n in re.findall(r"<gml:description>(.*?)</gml:description>\s*<gml:name>(.*?)</gml:name>", s, re.S)}


def parse_poslist(text):
    v = text.split()
    # EPSG:6697 は 緯度 経度 標高 の順
    return [(float(v[i + 1]), float(v[i]), float(v[i + 2])) for i in range(0, len(v) - 2, 3)]


def exterior_rings(geom_el):
    """geom_el 配下の Polygon の exterior LinearRing を (lon,lat,z) のリストで返す"""
    rings = []
    for poly in geom_el.iter(GML + "Polygon"):
        ext = poly.find(GML + "exterior")
        if ext is None:
            continue
        pl = ext.find(".//" + GML + "posList")
        if pl is not None and pl.text:
            rings.append(parse_poslist(pl.text))
    return rings


def ring_area(r):
    a = 0.0
    for i in range(len(r) - 1):
        a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return a / 2


def footprints(el):
    """lod0FootPrint → lod0RoofEdge → lod1Solid の底面 の順で外周リングを取る（直下の子だけを見る）"""
    for name in ("lod0FootPrint", "lod0RoofEdge"):
        g = el.find(BLDG + name)
        if g is not None:
            rs = [r for r in exterior_rings(g) if len(r) >= 4]
            if rs:
                return rs, name
    g = el.find(BLDG + "lod1Solid")
    if g is not None:
        rs = exterior_rings(g)
        if rs:
            zmin = min(p[2] for r in rs for p in r)
            bottom = [r for r in rs if len(r) >= 4 and all(abs(p[2] - zmin) < 0.01 for p in r)]
            if bottom:
                return bottom, "lod1Solid.bottom"
    return [], None


def num(el, path, bad=(-9999, 9999)):
    x = el.find(path)
    if x is None or x.text is None:
        return None
    try:
        v = float(x.text)
    except ValueError:
        return None
    return None if v in bad else v


def attrs_of(el, usage_cl, parent=None):
    """Building / BuildingPart の属性。無い項目は parent（Building）から引き継ぐ"""
    p = parent or {}
    a = {}
    h = num(el, BLDG + "measuredHeight")
    a["h"] = round(h, 1) if h is not None else p.get("h")
    s = num(el, BLDG + "storeysAboveGround")
    a["s"] = int(s) if s is not None else p.get("s")
    u = el.find(BLDG + "usage")
    uname = usage_cl.get(u.text.strip()) if u is not None and u.text else None
    a["u"] = uname if uname and uname != "不明" else p.get("u")
    c = el.find(BLDG + "class")
    a["sc"] = CLASS_MAP.get(c.text.strip()) if c is not None and c.text else p.get("sc")
    st, td, fd_l2, fd_any, bid, city = None, None, None, None, None, None
    for x in el.iter():
        if x is not el and local(x.tag) == "BuildingPart":
            continue
        ln = local(x.tag)
        if ln in ("buildingStructureType",) and x.text:
            st = STRUCT_MAP.get(x.text.strip(), st)
        elif ln in ("BuildingTsunamiRiskAttribute", "TsunamiRiskAttribute"):
            for y in x:
                if local(y.tag) == "depth" and y.text:
                    d = float(y.text)
                    td = d if td is None else max(td, d)
        elif ln in ("BuildingRiverFloodingRiskAttribute", "RiverFloodingRiskAttribute"):
            dep, scale = None, None
            for y in x:
                if local(y.tag) == "depth" and y.text:
                    dep = float(y.text)
                elif local(y.tag) == "scale" and y.text:
                    scale = y.text.strip()
            if dep is not None:
                fd_any = dep if fd_any is None else max(fd_any, dep)
                if scale == "2":
                    fd_l2 = dep if fd_l2 is None else max(fd_l2, dep)
        elif ln == "buildingID" and x.text and x.text.strip() not in ("Null", "") and bid is None:
            bid = x.text.strip()
        elif ln == "city" and x.text and x.text.strip() != "99999" and city is None:
            city = x.text.strip()
    a["st"] = st if st is not None else p.get("st")
    a["td"] = round(td, 2) if td is not None else p.get("td")
    fd = fd_l2 if fd_l2 is not None else fd_any
    a["fd"] = round(fd, 2) if fd is not None else p.get("fd")
    a["id"] = bid or p.get("id") or el.get(GML + "id")
    a["city"] = city or p.get("city")
    return a


def parse_mesh(args):
    path, codelist_dir, wards, out_dir = args
    mesh = os.path.basename(path).split(".")[0]
    out = os.path.join(out_dir, f"{mesh}.json")
    if os.path.exists(out):
        return mesh, json.load(open(out))["stats"]
    usage_cl = load_codelist(os.path.join(codelist_dir, "Building_usage.xml"))
    feats = []
    st = {"buildings": 0, "in_wards": 0, "features": 0, "geom_src": {}}
    with gzip.open(path, "rb") as f:
        for ev, el in ET.iterparse(f, events=("end",)):
            if el.tag != BLDG + "Building":
                continue
            st["buildings"] += 1
            a = attrs_of(el, usage_cl)
            if a["city"] not in wards:
                el.clear()
                continue
            st["in_wards"] += 1
            units = []
            rings, src = footprints(el)
            if rings:
                units.append((a, rings, src))
            else:
                for k, part in enumerate(el.iter(BLDG + "BuildingPart")):
                    pa = attrs_of(part, usage_cl, parent=a)
                    pa["id"] = a["id"]
                    prings, psrc = footprints(part)
                    if prings:
                        units.append((pa, prings, "part:" + psrc))
            for ua, rs, src in units:
                st["geom_src"][src] = st["geom_src"].get(src, 0) + 1
                for r in rs:
                    ring = [(round(p[0], 7), round(p[1], 7)) for p in r]
                    feats.append({**ua, "ring": ring})
                    st["features"] += 1
            el.clear()
    json.dump({"mesh": mesh, "stats": st, "features": feats}, open(out, "w"), ensure_ascii=False)
    return mesh, st


# ---------- 幾何 ----------

def clip_rect(ring, W, S, E, N):
    """Sutherland–Hodgman。ring は閉じていない (lon,lat) のリスト"""
    def clip(pts, inside, inter):
        out = []
        n = len(pts)
        for i in range(n):
            cur, prev = pts[i], pts[i - 1]
            ci, pi = inside(cur), inside(prev)
            if ci:
                if not pi:
                    out.append(inter(prev, cur))
                out.append(cur)
            elif pi:
                out.append(inter(prev, cur))
        return out

    def ix(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def iy(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = ring
    for inside, inter in ((lambda p: p[0] >= W, ix(W)), (lambda p: p[0] <= E, ix(E)),
                          (lambda p: p[1] >= S, iy(S)), (lambda p: p[1] <= N, iy(N))):
        if not pts:
            break
        pts = clip(pts, inside, inter)
    return pts


def finish_ring(pts):
    """小数6桁に丸め、連続重複を除き、閉じたリング [[lon,lat],...,[lon0,lat0]] にする"""
    out = []
    for x, y in pts:
        q = [round(x, 6), round(y, 6)]
        if not out or out[-1] != q:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    if len(out) < 3:
        return None
    a = 0.0
    for i in range(len(out)):
        x0, y0 = out[i]
        x1, y1 = out[(i + 1) % len(out)]
        a += x0 * y1 - x1 * y0
    if abs(a) < 1e-12:  # 面積ゼロ（辺だけ）
        return None
    out.append(list(out[0]))
    return out


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def dist_to_ring_m(x, y, ring):
    kx = 111320 * math.cos(math.radians(y))
    ky = 110940
    best = 1e18
    for i in range(len(ring) - 1):
        ax, ay = (ring[i][0] - x) * kx, (ring[i][1] - y) * ky
        bx, by = (ring[i + 1][0] - x) * kx, (ring[i + 1][1] - y) * ky
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0 if L == 0 else max(0, min(1, -(ax * dx + ay * dy) / L))
        px, py = ax + t * dx, ay + t * dy
        best = min(best, px * px + py * py)
    return math.sqrt(best)


def match_evac(features, evac_path, max_dist_m):
    """避難場所の点 → 建物。点を含む建物を優先、無ければ max_dist_m 以内で最も近い建物"""
    if not evac_path or not os.path.exists(evac_path):
        return {}, {"points": 0}
    pts = json.load(open(evac_path))["features"]
    grid = {}
    G = 0.002  # 約200m格子の索引
    for i, f in enumerate(features):
        xs = [p[0] for p in f["ring"]]
        ys = [p[1] for p in f["ring"]]
        f["_bb"] = (min(xs), min(ys), max(xs), max(ys))
        for gx in range(int(min(xs) / G), int(max(xs) / G) + 1):
            for gy in range(int(min(ys) / G), int(max(ys) / G) + 1):
                grid.setdefault((gx, gy), []).append(i)
    hit = {}
    st = {"points": len(pts), "inside": 0, "near": 0, "unmatched": 0, "unmatched_samples": []}
    for p in pts:
        x, y = p["geometry"]["coordinates"][:2]
        name = (p["properties"].get("name") or "指定緊急避難場所（津波）").replace("　", " ")
        cands = set()
        for gx in range(int(x / G) - 1, int(x / G) + 2):
            for gy in range(int(y / G) - 1, int(y / G) + 2):
                cands.update(grid.get((gx, gy), []))
        inside = [i for i in cands if features[i]["_bb"][0] <= x <= features[i]["_bb"][2]
                  and features[i]["_bb"][1] <= y <= features[i]["_bb"][3] and point_in_ring(x, y, features[i]["ring"])]
        if inside:
            i = max(inside, key=lambda k: (features[k]["h"] or 0))
            st["inside"] += 1
        else:
            best, bi = max_dist_m, None
            for i in cands:
                d = dist_to_ring_m(x, y, features[i]["ring"])
                if d < best:
                    best, bi = d, i
            if bi is None:
                st["unmatched"] += 1
                if len(st["unmatched_samples"]) < 10:
                    st["unmatched_samples"].append(name)
                continue
            i = bi
            st["near"] += 1
        bid = features[i]["id"]
        if bid not in hit:
            hit[bid] = name
    return hit, st


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, help="fetch_*.py の保存先（scratch/A1）")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "plateau"))
    ap.add_argument("--wards", default=WARDS_DEFAULT)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--evac-dist", type=float, default=10.0, help="点が建物の外にあるとき、この距離(m)以内の最寄り建物に付ける")
    a = ap.parse_args()

    wards = set(a.wards.split(","))
    cg = os.path.join(a.cache, "citygml")
    meta = json.load(open(os.path.join(cg, "fetch_meta.json")))
    parsed = ensure_dir(os.path.join(a.cache, "parsed"))
    files = sorted(glob.glob(os.path.join(cg, "bldg", "*.gml.gz")))
    print(f"[parse] {len(files)} meshes, wards={sorted(wards)}")
    total = {"buildings": 0, "in_wards": 0, "features": 0, "geom_src": {}}
    with cf.ProcessPoolExecutor(a.workers) as ex:
        for k, (mesh, st) in enumerate(ex.map(parse_mesh, [(p, os.path.join(cg, "codelists"), wards, parsed) for p in files])):
            for key in ("buildings", "in_wards", "features"):
                total[key] += st[key]
            for s, n in st["geom_src"].items():
                total["geom_src"][s] = total["geom_src"].get(s, 0) + n
            if (k + 1) % 25 == 0:
                print(f"  {k + 1}/{len(files)}", flush=True)
    print("[parse]", total)

    # 全件を読み、ring を閉じない形の (lon,lat) にして結合用に整える
    features = []
    for p in sorted(glob.glob(os.path.join(parsed, "*.json"))):
        for f in json.load(open(p))["features"]:
            r = f["ring"]
            if len(r) > 1 and r[0] == r[-1]:
                r = r[:-1]
            f["ring"] = [tuple(q) for q in r] + [tuple(r[0])]
            features.append(f)

    evac, evac_st = match_evac(features, os.path.join(a.cache, "evac_skhb05.geojson"), a.evac_dist)
    print("[evac]", {k: v for k, v in evac_st.items() if k != "unmatched_samples"}, "buildings:", len(evac))

    # タイル分割
    tiles = {}
    for f in features:
        bb = f.pop("_bb", None)
        ring = f["ring"][:-1]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        tx0, ty0 = lonlat_to_tile(min(xs), max(ys), Z)
        tx1, ty1 = lonlat_to_tile(max(xs), min(ys), Z)
        rec = {"h": f["h"], "s": f["s"], "st": f["st"], "u": f["u"], "td": f["td"],
               "evac": evac.get(f["id"], False), "id": f["id"], "sc": f["sc"], "fd": f["fd"]}
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                W, S, E, N = tile_bounds(tx, ty, Z)
                pts = ring if (tx0 == tx1 and ty0 == ty1) else clip_rect(ring, W, S, E, N)
                r = finish_ring(pts)
                if r is None:
                    continue
                tiles.setdefault((tx, ty), []).append({"ring": r, **rec})

    out = os.path.abspath(a.out)
    if os.path.isdir(os.path.join(out, str(Z))):
        shutil.rmtree(os.path.join(out, str(Z)))
    ensure_dir(os.path.join(out, str(Z)))
    nbytes = 0
    for (tx, ty), arr in sorted(tiles.items()):
        p = os.path.join(out, str(Z), f"{tx}_{ty}.json")
        s = json.dumps(arr, ensure_ascii=False, separators=(",", ":"))
        open(p, "w", encoding="utf-8").write(s)
        nbytes += len(s.encode("utf-8"))

    ids = {f["id"] for f in features}
    index = {
        "source": (f"「3D都市モデル（Project PLATEAU）{meta['cityName']}（{meta['year']}年度）」建築物モデル CityGML"
                   f"（標準製品仕様書 第{meta['spec']}版、国土交通省）を加工して作成。"
                   "evac は国土地理院「指定緊急避難場所データ」（津波）を建物と空間結合したもの"),
        "license": "https://www.mlit.go.jp/plateau/site-policy/",
        "license_extra": {"evac": "https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html"},
        "source_url": meta["source_zip"],
        "dataset_page": f"https://www.geospatial.jp/ckan/dataset/plateau-{meta['city']}-nagoya-shi-{meta['year']}",
        "city": meta["city"], "year": meta["year"], "spec": meta["spec"],
        "wards": {w: WARD_NAMES.get(w, w) for w in sorted(wards)},
        "z": Z,
        "tiles": [f"{x}_{y}" for (x, y) in sorted(tiles)],
        "counts": {"buildings": len(ids), "footprints": len(features),
                   "tile_records": sum(len(v) for v in tiles.values()), "tiles": len(tiles), "bytes": nbytes},
        "fields": {
            "ring": "外周リング [[経度,緯度],...]（JGD2011=WGS84相当、小数6桁、閉じたリング＝最後の点が最初の点と同じ）。z16 タイルの境界で切り取り済み。タイルを跨ぐ建物は同じ id で複数タイルに入る",
            "h": "bldg:measuredHeight 実測高さ（m）。-9999 等の欠損は null",
            "s": "bldg:storeysAboveGround 地上階数。9999 等の欠損は null",
            "st": "構造種別（uro:buildingStructureType を wood/rc/src/steel/other に正規化）。名古屋市2022年度データにはこの属性が無いため全件 null",
            "u": "bldg:usage 用途（コードリスト Building_usage の日本語名）。不明・欠損は null",
            "td": "建物ごとの津波浸水想定の深さ（uro:BuildingTsunamiRiskAttribute の depth、m）。名古屋市2022年度データには津波浸水想定の属性が無いため全件 null",
            "evac": "指定緊急避難場所（津波）に指定された施設の名称（国土地理院データの点を含む建物、または点から10m以内の最寄り建物）。該当なしは false。津波避難ビルの公式一覧との照合ではない",
            "id": "uro:buildingID（例 23100-bldg-304585）",
            "sc": "【拡張】bldg:class 建物区分（公共測量標準図式）。sturdy=堅ろう建物（鉄筋コンクリート等・地上3階以上）、ordinary=普通建物（3階未満、または3階以上の木造等）、shed=普通無壁舎、sturdy_shed=堅ろう無壁舎、null=不明。構造種別そのものではない",
            "fd": "【拡張】洪水浸水想定の深さ（m）。uro:RiverFloodingRiskAttribute（庄内川・矢田川・木曽川、国管理）のうち L2 想定最大規模の最大値。L2 が無ければ全規模の最大。津波ではない",
        },
        "stats": {"parse": total, "evac": evac_st},
    }
    json.dump(index, open(os.path.join(out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[write] {len(tiles)} tiles, {nbytes/1e6:.1f}MB, buildings={len(ids)} -> {out}")


if __name__ == "__main__":
    main()
