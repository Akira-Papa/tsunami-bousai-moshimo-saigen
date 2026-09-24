"""共通の小道具（標準ライブラリのみ）。

- PLATEAU データカタログ API から CityGML の配布URLを引く
- HTTP Range で ZIP の中身を1ファイルずつ取り出す（2.7GB の ZIP を丸ごと落とさない）
- 地域メッシュ（第3次）と XYZ タイルの計算
"""
import json
import math
import os
import struct
import time
import urllib.request
import zlib

CATALOG_API = "https://api.plateauview.mlit.go.jp/datacatalog/citygml/{code}"
UA = {"User-Agent": "tsunami-bousai-moshimo-saigen/plateau-pipeline (+https://github.com/Akira-Papa/tsunami-bousai-moshimo-saigen)"}


def http_get(url, headers=None, timeout=300, retries=4):
    h = dict(UA)
    if headers:
        h.update(headers)
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                return r.read(), r.headers
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))


def catalog(code):
    body, _ = http_get(CATALOG_API.format(code=code), timeout=120)
    return json.loads(body)


class RangeZip:
    """HTTP Range で ZIP の中央ディレクトリだけ読み、必要なエントリを個別に取り出す。"""

    def __init__(self, url):
        self.url = url
        _, hd = http_get(url, headers={"Range": "bytes=0-0"}, timeout=60)
        cr = hd.get("Content-Range")  # bytes 0-0/NNN
        self.size = int(cr.split("/")[1])
        self.entries = self._read_central_directory()

    def _range(self, start, end):
        body, _ = http_get(self.url, headers={"Range": f"bytes={start}-{end}"})
        return body

    def _read_central_directory(self):
        tail_len = min(self.size, 1 << 20)
        tail = self._range(self.size - tail_len, self.size - 1)
        # ZIP64 end of central directory locator を優先
        loc = tail.rfind(b"PK\x06\x07")
        if loc >= 0:
            eocd64_off = struct.unpack("<Q", tail[loc + 8:loc + 16])[0]
            rec = self._range(eocd64_off, eocd64_off + 56 - 1)
            cd_size, cd_off = struct.unpack("<QQ", rec[40:56])
        else:
            e = tail.rfind(b"PK\x05\x06")
            cd_size, cd_off = struct.unpack("<II", tail[e + 12:e + 20])
        cd = self._range(cd_off, cd_off + cd_size - 1)
        out, p = {}, 0
        while p + 46 <= len(cd) and cd[p:p + 4] == b"PK\x01\x02":
            (method, _t, _d, _crc, csize, usize, nlen, xlen, clen) = struct.unpack("<HHHIIIHHH", cd[p + 10:p + 34])
            lho = struct.unpack("<I", cd[p + 42:p + 46])[0]
            name = cd[p + 46:p + 46 + nlen].decode("utf-8", "replace")
            extra = cd[p + 46 + nlen:p + 46 + nlen + xlen]
            # ZIP64 extra field
            q = 0
            while q + 4 <= len(extra):
                hid, hlen = struct.unpack("<HH", extra[q:q + 4])
                if hid == 1:
                    vals = extra[q + 4:q + 4 + hlen]
                    k = 0
                    if usize == 0xFFFFFFFF:
                        usize = struct.unpack("<Q", vals[k:k + 8])[0]; k += 8
                    if csize == 0xFFFFFFFF:
                        csize = struct.unpack("<Q", vals[k:k + 8])[0]; k += 8
                    if lho == 0xFFFFFFFF:
                        lho = struct.unpack("<Q", vals[k:k + 8])[0]; k += 8
                q += 4 + hlen
            out[name.replace("\\", "/")] = dict(method=method, csize=csize, usize=usize, offset=lho)
            p += 46 + nlen + xlen + clen
        return out

    def read(self, name):
        e = self.entries[name]
        head = self._range(e["offset"], e["offset"] + 30 - 1)
        nlen, xlen = struct.unpack("<HH", head[26:30])
        start = e["offset"] + 30 + nlen + xlen
        data = self._range(start, start + e["csize"] - 1) if e["csize"] else b""
        if e["method"] == 0:
            return data
        if e["method"] == 8:
            return zlib.decompress(data, -15)
        raise ValueError(f"unsupported compression {e['method']} for {name}")


def mesh3_bounds(code):
    """第3次地域区画（8桁）の範囲 (west, south, east, north)。JGD2011 経緯度。"""
    c = str(code)
    p, u = int(c[0:2]), int(c[2:4])
    q, v = int(c[4]), int(c[5])
    r, w = int(c[6]), int(c[7])
    south = p / 1.5 + q * (5 / 60) + r * (30 / 3600)
    west = 100 + u + v * (7.5 / 60) + w * (45 / 3600)
    return west, south, west + 45 / 3600, south + 30 / 3600


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tile_bounds(x, y, z):
    n = 2 ** z
    west = x / n * 360 - 180
    east = (x + 1) / n * 360 - 180
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def ensure_dir(p):
    os.makedirs(p, exist_ok=True)
    return p
