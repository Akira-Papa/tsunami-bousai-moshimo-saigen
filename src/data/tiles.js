// GSI (国土地理院) tile access — all endpoints answer with Access-Control-Allow-Origin: *
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import { lon2tx, lat2ty, tx2lon, ty2lat, tilesFor } from './geo.js';

const GSI = 'https://cyberjapandata.gsi.go.jp/xyz';
export const URLS = {
  dem5a: (t) => `${GSI}/dem5a_png/${t.z}/${t.x}/${t.y}.png`,
  dem10: (t) => `${GSI}/dem_png/${t.z}/${t.x}/${t.y}.png`,
  photo: (t) => `${GSI}/seamlessphoto/${t.z}/${t.x}/${t.y}.jpg`,
  bvmap: (t) => `${GSI}/experimental_bvmap/${t.z}/${t.x}/${t.y}.pbf`,
  plateau: 'https://shiworks.xsrv.jp/pmtiles-data/plateau/PLATEAU_2022_LOD1.pmtiles',
};

/** fetch with timeout; 404 → null (GSI returns 404 for sea / no data), other failures throw */
export async function fetchOk(url, ms = 15000) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally { clearTimeout(tm); }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function decodeImage(resp) {
  const bmp = await createImageBitmap(await resp.blob());
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { bmp, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

/**
 * DEM mosaic at zoom z. GSI PNG: x = R·65536 + G·256 + B; x < 2^23 → x·0.01 m,
 * x = 2^23 → no data (sea / water surface), x > 2^23 → (x − 2^24)·0.01 m
 */
export async function loadDemMosaic(bbox, z, urlFn, onTile) {
  const tiles = tilesFor(bbox, z);
  const x0 = Math.min(...tiles.map((t) => t.x)), y0 = Math.min(...tiles.map((t) => t.y));
  const nx = Math.max(...tiles.map((t) => t.x)) - x0 + 1, ny = Math.max(...tiles.map((t) => t.y)) - y0 + 1;
  const W = nx * 256, H = ny * 256;
  const elev = new Float32Array(W * H).fill(NaN);
  let got = 0, failed = 0;
  await pool(tiles, 6, async (t) => {
    let r = null;
    try { r = await fetchOk(urlFn(t)); } catch { failed++; onTile?.(); return; }
    onTile?.();
    if (!r) return;
    const { data } = await decodeImage(r);
    got++;
    const ox = (t.x - x0) * 256, oy = (t.y - y0) * 256;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const p = (j * 256 + i) * 4;
      const v = data[p] * 65536 + data[p + 1] * 256 + data[p + 2];
      if (v === 8388608) continue;
      elev[(oy + j) * W + ox + i] = (v < 8388608 ? v : v - 16777216) * 0.01;
    }
  });
  return {
    got, failed, total: tiles.length,
    /** bilinear sample; NaN when any tap is missing (caller decides the fallback) */
    sample(lat, lon, nearestOk = false) {
      const fx = (lon2tx(lon, z) - x0) * 256 - 0.5, fy = (lat2ty(lat, z) - y0) * 256 - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix + 1 >= W || iy + 1 >= H) return NaN;
      const ax = fx - ix, ay = fy - iy;
      const a = elev[iy * W + ix], b = elev[iy * W + ix + 1], c = elev[(iy + 1) * W + ix], d = elev[(iy + 1) * W + ix + 1];
      const v = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
      if (!Number.isNaN(v) || !nearestOk) return v;
      const k = [[a, (1 - ax) * (1 - ay)], [b, ax * (1 - ay)], [c, (1 - ax) * ay], [d, ax * ay]].filter((q) => !Number.isNaN(q[0]));
      if (!k.length) return NaN;
      const ws = k.reduce((s, q) => s + q[1], 0);
      return ws > 0.2 ? k.reduce((s, q) => s + q[0] * q[1], 0) / ws : NaN;
    },
  };
}

/** aerial photo drawn into a square canvas that exactly covers the local domain */
export async function loadPhoto(frame, L, size, z, onTile) {
  const h = L / 2;
  const nw = frame.toLatLon(-h, -h), se = frame.toLatLon(h, h);
  const tiles = tilesFor({ west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }, z);
  const cv = new OffscreenCanvas(size, size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#6d7466';
  ctx.fillRect(0, 0, size, size);
  let got = 0;
  await pool(tiles, 8, async (t) => {
    let r = null;
    try { r = await fetchOk(URLS.photo(t)); } catch { onTile?.(); return; }
    onTile?.();
    if (!r) return;
    const bmp = await createImageBitmap(await r.blob());
    const a = frame.toLocal(ty2lat(t.y, z), tx2lon(t.x, z));
    const b = frame.toLocal(ty2lat(t.y + 1, z), tx2lon(t.x + 1, z));
    const px = (v) => ((v + h) / L) * size;
    // +0.6 px overlap hides hairline seams between tiles
    ctx.drawImage(bmp, px(a.x) - 0.3, px(a.z) - 0.3, px(b.x) - px(a.x) + 0.6, px(b.z) - px(a.z) + 0.6);
    got++;
  });
  return { canvas: cv, got, total: tiles.length };
}

// ── buildings ──────────────────────────────────────────────
let plateau = null;
const plateauSrc = () => (plateau ??= new PMTiles(URLS.plateau));

function clipRing(ring, ext) {
  // Sutherland–Hodgman against the tile square (removes the tile buffer → no duplicated walls)
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= ext, (p) => p[1] >= 0, (p) => p[1] <= ext,
  ];
  const cut = [
    (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (ext - a[0]) / (b[0] - a[0]); return [ext, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; },
    (a, b) => { const t = (ext - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), ext]; },
  ];
  let out = ring;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ia = edges[e](a), ib = edges[e](b);
      if (ib) { if (!ia) out.push(cut[e](a, b)); out.push(b); } else if (ia) out.push(cut[e](a, b));
    }
  }
  return out;
}

const ringArea = (r) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
};

function tileFeatures(buf, layerName, t, frame) {
  const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
  const layer = vt.layers[layerName];
  if (!layer) return [];
  const out = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3) continue;
    const ext = layer.extent;
    const rings = f.loadGeometry();
    // vector tiles: exterior rings are one winding, holes the other — keep exteriors only
    for (const ring of rings) {
      const pts = ring.map((p) => [p.x, p.y]);
      if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
      if (ringArea(pts) <= 0) continue; // in tile space (y down) exteriors are positive
      const c = clipRing(pts, ext);
      if (c.length < 3 || Math.abs(ringArea(c)) < 4) continue;
      const loc = c.map(([px, py]) => {
        const lon = tx2lon(t.x + px / ext, t.z), lat = ty2lat(t.y + py / ext, t.z);
        const p = frame.toLocal(lat, lon);
        return [p.x, p.z];
      });
      out.push({ ring: loc, props: f.properties });
    }
  }
  return out;
}

/** GSI line features that mark seawalls / river revetments / floodgates, in local metres */
function tileLines(buf, t, frame) {
  const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
  const out = [];
  const pick = [['coastline', 5103, 'coast'], ['river', 5203, 'river'], ['structurel', 5515, 'gate']];
  for (const [layerName, code, kind] of pick) {
    const layer = vt.layers[layerName];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 2 || f.properties.ftCode !== code) continue;
      for (const line of f.loadGeometry()) {
        const pts = line.map((p) => {
          const q = frame.toLocal(ty2lat(t.y + p.y / layer.extent, t.z), tx2lon(t.x + p.x / layer.extent, t.z));
          return [q.x, q.z];
        });
        if (pts.length > 1) out.push({ kind, pts });
      }
    }
  }
  return out;
}

/** building footprints (local metres) with heights: PLATEAU LOD1 where available, GSI bvmap otherwise;
 *  plus the GSI seawall / revetment / floodgate lines of the same tiles */
export async function loadBuildings(frame, L, onTile) {
  const h = L / 2 + 30;
  const nw = frame.toLatLon(-h, -h), se = frame.toLatLon(h, h);
  const tiles = tilesFor({ west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }, 16);
  const all = [], lines = [];
  const stats = { plateau: 0, bvmap: 0, tiles: tiles.length, failed: 0, lineTiles: 0 };
  await pool(tiles, 6, async (t) => {
    let feats = [];
    const bvP = fetchOk(URLS.bvmap(t)).then((r) => (r ? r.arrayBuffer() : null)).catch(() => { stats.failed++; return null; });
    try {
      const r = await plateauSrc().getZxy(16, t.x, t.y);
      if (r?.data) feats = tileFeatures(r.data, 'PLATEAU', t, frame).map((f) => ({ ...f, src: 'plateau' }));
    } catch { /* PLATEAU mirror unreachable → bvmap */ }
    const bv = await bvP;
    if (bv) {
      if (!feats.length) feats = tileFeatures(bv, 'building', t, frame).map((f) => ({ ...f, src: 'bvmap' }));
      lines.push(...tileLines(bv, t, frame));
      stats.lineTiles++;
    }
    for (const f of feats) { stats[f.src]++; all.push(f); }
    onTile?.();
  });
  return { list: all, lines, stats };
}

/** coarse vector data for the wide (outer) square: z14 GSI tiles → seawall/revetment/gate lines + solid buildings */
export async function loadVectorCoarse(frame, L, onTile) {
  const h = L / 2 + 50;
  const nw = frame.toLatLon(-h, -h), se = frame.toLatLon(h, h);
  const tiles = tilesFor({ west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }, 14);
  const lines = [], solids = [];
  await pool(tiles, 8, async (t) => {
    try {
      const r = await fetchOk(URLS.bvmap(t));
      if (r) {
        const buf = await r.arrayBuffer();
        lines.push(...tileLines(buf, t, frame));
        solids.push(...tileFeatures(buf, 'building', t, frame));
      }
    } catch { /* keep going: missing tiles only lose roughness / seawall detail */ }
    onTile?.();
  });
  return { lines, solids, tiles: tiles.length };
}
