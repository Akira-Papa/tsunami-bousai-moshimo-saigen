#!/usr/bin/env python3
"""国土地理院「指定緊急避難場所データ」の津波レイヤ（skhb05）を取得する。

PLATEAU の名古屋市 2022 年度データには避難施設・津波避難ビルの属性が無いため、
市町村が指定し国土地理院が公開している「指定緊急避難場所（津波）」の点を、
build_tiles.py で建物の外形と空間結合して `evac` に入れる。

- タイル仕様：https://maps.gsi.go.jp/development/ichiran.html （指定緊急避難場所）
- z10 の GeoJSON タイル（点、properties: name, address, disaster5=1 など）

使い方:
  python3 scripts/plateau/fetch_evac.py --cache /path/to/scratch/A1 [--bbox 136.78,35.02,136.95,35.20]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ensure_dir, http_get, lonlat_to_tile  # noqa: E402

URL = "https://cyberjapandata.gsi.go.jp/xyz/skhb05/{z}/{x}/{y}.geojson"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--bbox", default="136.78,35.02,136.95,35.20")
    a = ap.parse_args()
    W, S, E, N = map(float, a.bbox.split(","))
    z = 10
    x0, y0 = lonlat_to_tile(W, N, z)
    x1, y1 = lonlat_to_tile(E, S, z)
    feats = []
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            try:
                body, _ = http_get(URL.format(z=z, x=x, y=y), timeout=60)
            except Exception as e:  # 404 = その範囲に点なし
                print("skip", x, y, e)
                continue
            for f in json.loads(body)["features"]:
                lon, lat = f["geometry"]["coordinates"][:2]
                if W <= lon <= E and S <= lat <= N:
                    feats.append(f)
    out = os.path.join(ensure_dir(a.cache), "evac_skhb05.geojson")
    json.dump({"type": "FeatureCollection", "source": "国土地理院 指定緊急避難場所データ（津波）skhb05",
               "features": feats}, open(out, "w"), ensure_ascii=False)
    print(len(feats), "points ->", out)


if __name__ == "__main__":
    main()
