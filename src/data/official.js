// 内閣府 南海トラフ巨大地震モデル（2025）ケース01 の浸水メッシュを100m格子へ集約した値
// row = [lon, lat, 最大浸水深 m, 1cm到達 秒 | null, 元セル数]
import { M_PER_DEG_LAT, mPerDegLon } from './geo.js';

const base = import.meta.env.BASE_URL;
let manifestP = null;
export const loadManifest = () => (manifestP ??= fetch(`${base}inundation/manifest.json`).then((r) => {
  if (!r.ok) throw new Error('manifest ' + r.status);
  return r.json();
}));

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
  const rows = (await Promise.all(tiles.map((t) => fetch(`${base}inundation/${t.path}`).then((r) => (r.ok ? r.json() : []))))).flat();
  const cells = [];
  for (const r of rows) {
    const p = frame.toLocal(r[1], r[0]);
    if (Math.abs(p.x) > half || Math.abs(p.z) > half) continue;
    cells.push({ x: p.x, z: p.z, lon: r[0], lat: r[1], depth: r[2], arrival: r[3], n: r[4] });
  }
  return { cells, covered, available: true, label: m.case?.label, sourceUrl: m.sourceUrl, sizeM: 100 };
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
