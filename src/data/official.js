// 内閣府 南海トラフ巨大地震モデル（2025）ケース01 の浸水メッシュを100m格子へ集約した値
// row = [lon, lat, 最大浸水深 m, 1cm到達 秒 | null, 元セル数]
import { M_PER_DEG_LAT, mPerDegLon, makeFrame } from './geo.js';

const base = import.meta.env.BASE_URL;
let manifestP = null;
// a failed load is not kept: the next call tries again (a dropped connection must not pin "no data" until reload)
export const loadManifest = () => (manifestP ??= fetch(`${base}inundation/manifest.json`).then((r) => {
  if (!r.ok) throw new Error('manifest ' + r.status);
  return r.json();
}).catch((e) => { manifestP = null; throw e; }));

const tileCache = new Map(); // path → Promise<rows>
const loadTile = (path) => {
  if (!tileCache.has(path)) {
    const p = fetch(`${base}inundation/${path}`).then((r) => { if (!r.ok) throw new Error('tile ' + r.status); return r.json(); });
    p.catch(() => tileCache.delete(path));
    tileCache.set(path, p);
  }
  return tileCache.get(path);
};

export async function loadOfficialCells(frame, L) {
  const m = await loadManifest();
  const half = L / 2 + 60;
  const a = frame.toLatLon(-half, -half), b = frame.toLatLon(half, half);
  const bbox = [a.lon, b.lat, b.lon, a.lat];
  const tiles = m.tiles.filter((t) => t.bounds[0] <= bbox[2] + 0.002 && t.bounds[2] >= bbox[0] - 0.002 && t.bounds[1] <= bbox[3] + 0.002 && t.bounds[3] >= bbox[1] - 0.002);
  // is the domain inside the area the Cabinet Office computed at all? (0.25° tile keys)
  const keys = new Set(m.tiles.map((t) => t.path.split('/').pop().replace('.json', '')));
  const kx0 = Math.floor(bbox[0] * 4), kx1 = Math.floor(bbox[2] * 4), ky0 = Math.floor(bbox[1] * 4), ky1 = Math.floor(bbox[3] * 4);
  let covered = false;
  for (let x = kx0; x <= kx1; x++) for (let y = ky0; y <= ky1; y++) if (keys.has(`${x}_${y}`)) covered = true;
  // one unreachable tile must not sink the rest — but it must be REPORTED: "could not load" is not "outside the data"
  let failed = 0;
  const rows = (await Promise.all(tiles.map((t) => loadTile(t.path).catch(() => { failed++; return []; })))).flat();
  const cells = [];
  for (const r of rows) {
    const p = frame.toLocal(r[1], r[0]);
    if (Math.abs(p.x) > half || Math.abs(p.z) > half) continue;
    cells.push({ x: p.x, z: p.z, lon: r[0], lat: r[1], depth: r[2], arrival: r[3], n: r[4] });
  }
  return { cells, covered, available: failed === 0, failedTiles: failed, label: m.case?.label, sourceUrl: m.sourceUrl, sizeM: 100 };
}

/**
 * What the official data says about one spot — four states that must never be mixed up:
 *  'hit'     the 100 m cell around the spot is flooded in ケース01
 *  'none'    inside the computed area, but no flooded cell here in ケース01 (NOT "safe": other cases, breaches, rivers)
 *  'outside' the spot is outside the area we carry
 *  'failed'  the data could not be loaded (network) — nothing is known
 */
export function officialState(off, cell) {
  if (cell) return 'hit';
  if (!off || off.available === false) return 'failed';
  if (off.covered || off.cells?.length) return 'none';
  return 'outside';
}

/**
 * the flooded cells around a spot: a spot whose own 100 m cell is dry in ケース01 may have a flooded cell
 * across the street — "no cell here" must never be shown without that
 */
export function officialAround(off, x, z, R = 300) {
  let nearest = Infinity, max = 0, n = 0;
  for (const c of off?.cells ?? []) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d > R) continue;
    n++; nearest = Math.min(nearest, d); max = Math.max(max, c.depth);
  }
  return { R, n, nearest: n ? nearest : null, max };
}

/**
 * ケース01 is ONE of the 11 cases. Where another case gives a higher tsunami on this coast (四国・九州 など),
 * the ケース01 depths understate the worst case — say so with the Cabinet-Office coastal heights per case.
 * row = a record of public/data/tsunami_h.json (cases_2025: { "1": m, …, "11": m }, max_2025)
 */
export function caseNote(row) {
  const cs = row?.cases_2025, c1 = cs?.['1'], max = row?.max_2025;
  if (c1 == null || max == null) return null;
  const tops = Object.entries(cs).filter(([, v]) => v === max).map(([k]) => Number(k));
  return { c1, max, tops, lower: c1 < max };
}

/** official cells around one lat/lon (GPU-free; used by the pick screen) */
export async function officialNear(lat, lon, L = 1200) {
  const frame = makeFrame(lat, lon);
  let off;
  try { off = await loadOfficialCells(frame, L); } catch { off = { cells: [], covered: false, available: false }; }
  const cell = officialAt(off, 0, 0);
  return { off, cell, state: officialState(off, cell), around: officialAround(off, 0, 0) };
}

/** flooded cells inside a lon/lat box, for the 2-D map (rows: [lon, lat, depth, arrival]) */
export async function officialInBox(west, south, east, north) {
  const m = await loadManifest();
  const tiles = m.tiles.filter((t) => t.bounds[0] <= east && t.bounds[2] >= west && t.bounds[1] <= north && t.bounds[3] >= south);
  let failed = 0;
  const rows = (await Promise.all(tiles.map((t) => loadTile(t.path).catch(() => { failed++; return []; })))).flat();
  return { rows: rows.filter((r) => r[0] >= west && r[0] <= east && r[1] >= south && r[1] <= north), failed };
}

/** the official 100 m cell that contains (x,z), or null */
export function officialAt(off, x, z) {
  if (!off?.cells?.length) return null;
  let best = null, bd = Infinity;
  for (const c of off.cells) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bd) { bd = d; best = c; }
  }
  return bd <= 75 ? best : null;
}

export { M_PER_DEG_LAT, mPerDegLon };
