// Decide the simulation square: it must contain the chosen point AND a band of open sea,
// otherwise no tsunami could ever enter it.
import { makeFrame, haversine } from './geo.js';
import { loadDemMosaic, URLS, fetchOk } from './tiles.js';

const base = import.meta.env.BASE_URL;
let tsunamiP = null, muniP = null;
export const loadTsunamiTable = () => (tsunamiP ??= fetch(`${base}data/tsunami_h.json`).then((r) => r.json()));
export const loadMunicipalities = () => (muniP ??= fetch(`${base}data/municipalities.json`).then((r) => r.json()));

/** nearest wide open water from (lat, lon) within ±R metres, sampled every `step` metres on DEM zoom z */
async function findOpenSea(lat, lon, R, step, z) {
  const n = Math.round((2 * R) / step);
  const f = makeFrame(lat, lon);
  const a = f.toLatLon(-R, -R), b = f.toLatLon(R, R);
  const dem = await loadDemMosaic({ west: a.lon, east: b.lon, north: a.lat, south: b.lat }, z, URLS.dem10);
  if (dem.got === 0 && dem.failed > 0) throw new Error('標高タイルを取得できませんでした');
  const wet = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = f.toLatLon(-R + (i + 0.5) * step, -R + (j + 0.5) * step);
    if (Number.isNaN(dem.sample(p.lat, p.lon, true))) wet[j * n + i] = 1;
  }
  const here = dem.sample(lat, lon, true);
  // connected water bodies; "open sea" = big or touching the search border
  const comp = new Int32Array(n * n).fill(-1);
  const sizes = [], border = [];
  const q = new Int32Array(n * n);
  for (let s0 = 0; s0 < n * n; s0++) {
    if (!wet[s0] || comp[s0] >= 0) continue;
    const c = sizes.length;
    let qh = 0, qt = 0, size = 0, touches = false;
    q[qt++] = s0; comp[s0] = c;
    while (qh < qt) {
      const k = q[qh++]; size++;
      const i = k % n, j = (k / n) | 0;
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) touches = true;
      for (const [u, v] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (u < 0 || v < 0 || u >= n || v >= n) continue;
        const m = v * n + u;
        if (wet[m] && comp[m] < 0) { comp[m] = c; q[qt++] = m; }
      }
    }
    sizes.push(size); border.push(touches);
  }
  const minCells = 1e6 / (step * step); // ≥ 1 km² of water, or touching the search border
  const open = sizes.map((sz, c) => sz > minCells || (border[c] && sz > minCells / 4));
  // open water must also be WIDE (≥ 150 m from land): canals and rivers are not the sea
  const dl = new Float32Array(n * n).fill(1e9);
  for (let k = 0; k < n * n; k++) if (!wet[k]) dl[k] = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; let v = dl[k]; if (i > 0) v = Math.min(v, dl[k - 1] + step); if (j > 0) v = Math.min(v, dl[k - n] + step); dl[k] = v; }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) { const k = j * n + i; let v = dl[k]; if (i < n - 1) v = Math.min(v, dl[k + 1] + step); if (j < n - 1) v = Math.min(v, dl[k + n] + step); dl[k] = v; }
  let best = null;
  for (let k = 0; k < n * n; k++) {
    if (comp[k] < 0 || !open[comp[k]] || dl[k] < 150) continue;
    const x = -R + ((k % n) + 0.5) * step, z = -R + (((k / n) | 0) + 0.5) * step;
    const d = Math.hypot(x, z);
    if (!best || d < best.d) best = { d, x, z };
  }
  return { best, here, f };
}

export async function planDomain(lat, lon, { baseL = 1500, maxL = 4000, maxOuter = 20000 } = {}) {
  // 1) near search: one detailed square that holds both the point and the sea
  const near = await findOpenSea(lat, lon, 4200, 20, 14);
  let here = near.here;
  if (near.best) {
    const best = near.best;
    const dir = best.d > 1 ? { x: best.x / best.d, z: best.z / best.d } : { x: 0, z: 1 };
    let L = baseL;
    const need = best.d + 250 + 150;
    if (need > L) L = Math.min(maxL, Math.ceil(need / 100) * 100);
    const sMin = best.d + 250 - L / 2, sMax = L / 2 - 150;
    if (sMin <= sMax) {
      const s = Math.min(sMax, Math.max(sMin, 0.12 * L));
      const c = near.f.toLatLon(dir.x * s, dir.z * s);
      return { ok: true, mode: 'single', L, center: c, distance: best.d, dir, here, pointLocal: { x: -dir.x * s, z: -dir.z * s } };
    }
  }
  // 2) inland: a wide, coarse square (sea → city → the point) drives a detailed 1.5 km square at the point
  const far = near.best ?? (await findOpenSea(lat, lon, 16000, 60, 12)).best;
  if (!far) return { ok: false, reason: 'no-sea', here };
  const dir = { x: far.x / far.d, z: far.z / far.d };
  // along dir the outer square spans [s − Lo/2, s + Lo/2]: ≥ 1.3 km of land behind the point and ≥ 3.5 km of
  // open sea beyond the nearest wide water — a small harbour basin alone cannot feed a city-wide flood
  const SEA = 3500, BACK = 1300;
  const Lo = Math.max(6000, Math.ceil((far.d + SEA + BACK) / 500) * 500);
  if (Lo > maxOuter) return { ok: false, reason: 'far', distance: far.d, here, dir };
  const s = (far.d + SEA - BACK) / 2;
  const oc = near.f.toLatLon(dir.x * s, dir.z * s);
  return {
    ok: true, mode: 'nest', distance: far.d, dir, here,
    // inner: detailed square centred on the point
    L: baseL, center: { lat, lon }, pointLocal: { x: 0, z: 0 },
    // outer: coarse square; the point sits at (−s·dir) in its frame
    outer: { L: Lo, center: oc, innerOffset: { x: -dir.x * s, z: -dir.z * s } },
  };
}

// ward names are not in municipalities.json (codes only); Nagoya is the priority area
const WARDS = { 23101: '千種区', 23102: '東区', 23103: '北区', 23104: '西区', 23105: '中村区', 23106: '中区', 23107: '昭和区', 23108: '瑞穂区', 23109: '熱田区', 23110: '中川区', 23111: '港区', 23112: '南区', 23113: '守山区', 23114: '緑区', 23115: '名東区', 23116: '天白区' };

/** municipality code via the GSI reverse geocoder, then the Cabinet-Office 2025 coastal maximum */
export async function tsunamiHeightAt(lat, lon) {
  let code = null, place = '';
  try {
    const r = await fetchOk(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, 8000);
    const j = r ? await r.json() : null;
    code = j?.results?.muniCd ?? null;
    place = j?.results?.lv01Nm ?? '';
  } catch { /* offline */ }
  const [tab, mun] = await Promise.all([loadTsunamiTable(), loadMunicipalities()]);
  const byCode = new Map(mun.municipalities.map((m) => [m.code, m]));
  const parentOf = (c) => mun.municipalities.find((m) => (m.wards ?? []).includes(c)) ?? null;
  if (!code) {
    // offline: nearest municipality representative point
    let bd = Infinity;
    for (const m of mun.municipalities) { const d = haversine(lat, lon, m.lat, m.lon); if (d < bd) { bd = d; code = m.code; } }
  }
  const city = byCode.get(code) ?? parentOf(code);
  const ward = city && city.code !== code ? (WARDS[code] ?? '') : '';
  const name = city ? `${city.pref}${city.name}${ward}` : '';
  let row = tab.rows.find((r) => r.code === code) ?? null;
  let borrowed = null;
  if (!row && city && city.code !== code) {
    // a ward missing from the table (e.g. 名古屋市中川区・南区・熱田区): use the highest listed ward of the same city
    const sib = tab.rows.filter((r) => (city.wards ?? []).includes(r.code)).sort((a, b) => b.max_2025 - a.max_2025)[0];
    if (sib) { row = sib; borrowed = `${sib.pref}${sib.name}`; }
  }
  if (!row) {
    // otherwise the nearest listed municipality within 20 km
    let bd = Infinity, best = null;
    for (const r of tab.rows) {
      const m = byCode.get(r.code) ?? parentOf(r.code);
      if (!m) continue;
      const d = haversine(lat, lon, m.lat, m.lon);
      if (d < bd) { bd = d; best = r; }
    }
    if (best && bd < 20000) { row = best; borrowed = `${best.pref}${best.name}`; }
  }
  return { code, place, name, H: row?.max_2025 ?? null, mean: row?.mean_2025 ?? null, row, borrowed };
}
