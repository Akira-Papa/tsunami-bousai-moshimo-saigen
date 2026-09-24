#!/usr/bin/env python3
"""PLATEAU 公式 CityGML（建築物モデル bldg）を取得して、作業フォルダへ gzip で保存する。

- 配布元：国土交通省 PLATEAU（G空間情報センター掲載）。URL はデータカタログ API から毎回引く
- ZIP（名古屋市 2022 年度 v4 は約2.8GB）を丸ごと落とさず、HTTP Range で bldg の GML だけ取り出す
- 生データはリポジトリに入れない（--cache に置く）

使い方:
  python3 scripts/plateau/fetch_citygml.py --cache /path/to/scratch/A1/citygml \
      [--city 23100] [--bbox 136.78,35.02,136.95,35.20] [--workers 8]
"""
import argparse
import concurrent.futures as cf
import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RangeZip, catalog, ensure_dir, mesh3_bounds  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, help="生データの保存先（リポジトリ外）")
    ap.add_argument("--city", default="23100")
    ap.add_argument("--bbox", default="136.78,35.02,136.95,35.20",
                    help="west,south,east,north。この範囲に掛かる第3次メッシュだけ取る（既定：港・南・中川・熱田・中村区を包む範囲）")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--with-codelists", action="store_true", default=True)
    a = ap.parse_args()

    W, S, E, N = map(float, a.bbox.split(","))
    cat = catalog(a.city)
    city = sorted(cat["cities"], key=lambda c: (c["year"], c.get("registrationYear", 0)))[-1]  # 最新年度
    zurl = city["url"]
    print(f"[catalog] {city['cityName']} year={city['year']} spec={city['spec']} zip={zurl}")

    z = RangeZip(zurl)
    root = ensure_dir(a.cache)
    ensure_dir(os.path.join(root, "bldg"))
    ensure_dir(os.path.join(root, "codelists"))

    pat = re.compile(r"(^|/)udx/bldg/(\d{8})_bldg_\d+_op\.gml$")
    todo = []
    for name, e in z.entries.items():
        m = pat.search(name)
        if not m:
            continue
        w, s, ee, n = mesh3_bounds(m.group(2))
        if ee < W or w > E or n < S or s > N:
            continue
        todo.append((name, m.group(2), e))
    codelists = [n for n in z.entries if "/codelists/" in "/" + n and n.endswith(".xml")]
    print(f"[zip] bldg GML in bbox: {len(todo)} files, compressed {sum(t[2]['csize'] for t in todo)/1e6:.0f}MB,"
          f" uncompressed {sum(t[2]['usize'] for t in todo)/1e9:.2f}GB")

    for n in codelists:
        out = os.path.join(root, "codelists", os.path.basename(n))
        if not os.path.exists(out):
            open(out, "wb").write(z.read(n))

    def job(t):
        name, code, e = t
        out = os.path.join(root, "bldg", f"{code}.gml.gz")
        if os.path.exists(out) and os.path.getsize(out) > 0:
            return code, "skip"
        data = z.read(name)
        tmp = out + ".part"
        with gzip.open(tmp, "wb", compresslevel=3) as f:
            f.write(data)
        os.replace(tmp, out)
        return code, len(data)

    done = 0
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for code, r in ex.map(job, todo):
            done += 1
            if done % 20 == 0 or done == len(todo):
                print(f"  {done}/{len(todo)} {code} {r}", flush=True)

    meta = dict(source_zip=zurl, city=city["cityCode"], cityName=city["cityName"], year=city["year"],
                registrationYear=city.get("registrationYear"), spec=city["spec"],
                meshes=sorted(t[1] for t in todo))
    json.dump(meta, open(os.path.join(root, "fetch_meta.json"), "w"), ensure_ascii=False, indent=1)
    print("[done]", os.path.join(root, "fetch_meta.json"))


if __name__ == "__main__":
    main()
