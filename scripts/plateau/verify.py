#!/usr/bin/env python3
"""public/plateau/ の出力を検証する（件数・属性の充足率・リングの妥当性・名古屋港付近のサンプル）。

使い方:
  python3 scripts/plateau/verify.py [--out public/plateau] [--evac /path/to/scratch/A1/evac_skhb05.geojson]
"""
import argparse
import collections
import glob
import gzip
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import tile_bounds  # noqa: E402

WARD_BY_NAME = {"中村区": "23105", "熱田区": "23109", "中川区": "23110", "港区": "23111", "南区": "23112"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "plateau"))
    ap.add_argument("--evac", default=None)
    ap.add_argument("--lat", type=float, default=35.0905)  # 名古屋港（アプリのプリセット地点）
    ap.add_argument("--lon", type=float, default=136.8844)
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    idx = json.load(open(os.path.join(out, "index.json"), encoding="utf-8"))
    files = sorted(glob.glob(os.path.join(out, str(idx["z"]), "*.json")))
    names = {os.path.basename(p)[:-5] for p in files}
    assert names == set(idx["tiles"]), "index.tiles とファイルが一致しない"

    by_id = {}
    recs = 0
    bad_ring = 0
    out_of_tile = 0
    raw = 0
    gz = 0
    keys = collections.Counter()
    for p in files:
        s = open(p, "rb").read()
        raw += len(s)
        gz += len(gzip.compress(s, 6))
        x, y = map(int, os.path.basename(p)[:-5].split("_"))
        W, S, E, N = tile_bounds(x, y, idx["z"])
        eps = 2e-6
        for f in json.loads(s):
            recs += 1
            keys[tuple(sorted(f))] += 1
            r = f["ring"]
            if len(r) < 4 or r[0] != r[-1]:
                bad_ring += 1
            if any(not (W - eps <= q[0] <= E + eps and S - eps <= q[1] <= N + eps) for q in r):
                out_of_tile += 1
            by_id.setdefault(f["id"], f)
    n = len(by_id)
    print(f"tiles={len(files)} records={recs} unique_buildings={n} bytes={raw/1e6:.1f}MB gzip={gz/1e6:.1f}MB")
    print(f"bad_ring={bad_ring} out_of_tile={out_of_tile} key_sets={len(keys)} {list(keys)[0]}")

    def rate(fn):
        c = sum(1 for f in by_id.values() if fn(f))
        return f"{c} ({100*c/n:.1f}%)"

    print("充足率（ユニーク建物）")
    print("  h  :", rate(lambda f: f["h"] is not None))
    print("  s  :", rate(lambda f: f["s"] is not None))
    print("  st :", rate(lambda f: f["st"] is not None))
    print("  u  :", rate(lambda f: f["u"] is not None))
    print("  td :", rate(lambda f: f["td"] is not None))
    print("  evac:", rate(lambda f: f["evac"] is not False))
    print("  sc :", rate(lambda f: f.get("sc") is not None))
    print("  fd :", rate(lambda f: f.get("fd") is not None), " fd>0:", rate(lambda f: (f.get("fd") or 0) > 0))
    print("  sc 内訳:", collections.Counter(f.get("sc") for f in by_id.values()).most_common())
    print("  u 上位:", collections.Counter(f["u"] for f in by_id.values()).most_common(8))
    hs = sorted(f["h"] for f in by_id.values() if f["h"] is not None)
    print(f"  h 分布: min={hs[0]} p50={hs[len(hs)//2]} p99={hs[int(len(hs)*.99)]} max={hs[-1]}")

    if a.evac and os.path.exists(a.evac):
        pts = json.load(open(a.evac))["features"]
        tgt = [p for p in pts if any(w in (p["properties"].get("address") or "") for w in WARD_BY_NAME)]
        got = {f["evac"] for f in by_id.values() if f["evac"]}
        miss = [p["properties"]["name"] for p in tgt if (p["properties"]["name"] or "").replace("　", " ") not in got]
        print(f"evac: 対象5区の住所の点={len(tgt)} 建物に付いた名称={len(got)} 付かなかった点={len(miss)} 例={miss[:8]}")

    # 名古屋港付近のサンプル
    kx = 111320 * math.cos(math.radians(a.lat))

    def d(f):
        r = f["ring"][:-1]
        cx = sum(q[0] for q in r) / len(r)
        cy = sum(q[1] for q in r) / len(r)
        return math.hypot((cx - a.lon) * kx, (cy - a.lat) * 110940)

    near = sorted(by_id.values(), key=d)[:400]
    print(f"\n名古屋港付近（{a.lat},{a.lon}）のサンプル")
    shown = 0
    for f in sorted(near, key=lambda f: -(f["h"] or 0)):
        if shown >= 6:
            break
        print(f"  {d(f):5.0f}m id={f['id']} h={f['h']} s={f['s']} u={f['u']} sc={f.get('sc')} st={f['st']} td={f['td']} fd={f.get('fd')} evac={f['evac']} 頂点={len(f['ring'])-1}")
        shown += 1
    ev = [f for f in near if f["evac"]]
    for f in ev[:4]:
        print(f"  [避難] {d(f):5.0f}m id={f['id']} h={f['h']} s={f['s']} u={f['u']} evac={f['evac']}")


if __name__ == "__main__":
    main()
