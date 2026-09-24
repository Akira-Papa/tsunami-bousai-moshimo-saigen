// ─────────────────────────────────────────────────────────────
//  Build the simulation domain around a chosen point:
//  ground (DEM), sea + synthetic bathymetry, buildings (footprints+heights),
//  aerial photo, and the official Cabinet-Office inundation cells for comparison.
// ─────────────────────────────────────────────────────────────
import { makeFrame, hash01 } from './geo.js';
import { loadDemMosaic, loadPhoto, loadBuildings, loadVectorCoarse, URLS } from './tiles.js';
import { loadOfficialCells } from './official.js';

/**
 * @param {object} o  { lat, lon, center:{lat,lon}, L (m), N (cells), photoSize, onProgress(msg, frac) }
 */
export async function buildRegion(o) {
  const { N, L } = o;
  const center = o.center ?? { lat: o.lat, lon: o.lon };
  const frame = makeFrame(center.lat, center.lon);
  const dx = L / N;
  const half = L / 2;
  const prog = o.onProgress ?? (() => {});
  const nw = frame.toLatLon(-half - 40, -half - 40), se = frame.toLatLon(half + 40, half + 40);
  const bbox = { west: nw.lon, east: se.lon, north: nw.lat, south: se.lat };

  // progress bookkeeping across the parallel loaders
  let done = 0, total = 1;
  const tick = (label) => () => { done++; prog(label, Math.min(0.95, done / total)); };

  prog('地形（5mメッシュ標高）を読込中…', 0.02);
  const dems = Promise.all([
    loadDemMosaic(bbox, 15, URLS.dem5a, tick('地形を読込中…')),
    loadDemMosaic(bbox, 14, URLS.dem10, tick('地形を読込中…')),
  ]);
  const photoP = loadPhoto(frame, L, o.photoSize ?? 4096, L > 2000 ? 16 : 17, tick('航空写真を読込中…'));
  // surroundings outside the computed square (visual context only, not simulated) — not needed when a
  // simulated outer square surrounds this one
  const OL = L * 3;
  const on = frame.toLatLon(-OL / 2, -OL / 2), os = frame.toLatLon(OL / 2, OL / 2);
  const outerP = o.noSurroundings ? Promise.resolve(null) : Promise.all([
    loadPhoto(frame, OL, 2048, L > 2000 ? 13 : 14, tick('周辺の航空写真を読込中…')),
    loadDemMosaic({ west: on.lon, east: os.lon, north: on.lat, south: os.lat }, L > 2000 ? 12 : 13, URLS.dem10, tick('周辺の地形を読込中…')),
  ]).then(([ph, dem]) => {
    const M = 192, hgt = new Float32Array(M * M), mask = new OffscreenCanvas(M, M);
    const g = mask.getContext('2d'), img = g.createImageData(M, M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = -OL / 2 + (i / (M - 1)) * OL, z = -OL / 2 + (j / (M - 1)) * OL;
      const p = frame.toLatLon(x, z);
      const e = dem.sample(p.lat, p.lon, true);
      const sea = Number.isNaN(e);
      hgt[j * M + i] = sea ? -4 : e;
      img.data.set([sea ? 255 : 0, 0, 0, 255], (j * M + i) * 4);
    }
    g.putImageData(img, 0, 0);
    return { L: OL, M, hgt, mask, photo: ph.canvas };
  }).catch(() => null);
  const bldP = loadBuildings(frame, L, tick('建物を読込中…'));
  const offP = loadOfficialCells(frame, L).catch(() => ({ cells: [], available: false }));
  total = 9 + 4 + Math.ceil((L / (L > 2000 ? 500 : 250)) ** 2) + Math.ceil((L / 480) ** 2) + 30;

  const [[d5, d10], photo, bld, official, outer] = await Promise.all([dems, photoP, bldP, offP, outerP]);
  if (d5.got + d10.got === 0 && d5.failed + d10.failed > 0) throw new Error('標高タイルを取得できませんでした（通信を確認してください）');
  // the 10 m mosaic is the fallback under every 5 m hole: a missing 10 m tile would turn land into "sea"
  if (d10.failed > 0) throw new Error(`地形の一部（標高タイル${d10.failed}枚）を取得できませんでした。このまま計算すると陸が海として扱われるため中止しました。もう一度お試しください`);
  prog('計算格子を組み立て中…', 0.96);

  // ── ground ──
  const ground = new Float32Array(N * N);
  const water = new Uint8Array(N * N); // 1 = no DEM (sea, river, pond)
  let fromFine = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -half + (i + 0.5) * dx, z = -half + (j + 0.5) * dx;
    const { lat, lon } = frame.toLatLon(x, z);
    let e = d5.sample(lat, lon, true);
    if (Number.isNaN(e)) e = d10.sample(lat, lon, true); else fromFine++;
    // 5 m DEM can leave holes on land; the 10 m DEM is continuous on land, so NaN in both = water
    const k = j * N + i;
    if (Number.isNaN(e)) { water[k] = 1; ground[k] = 0; } else ground[k] = e;
  }
  const res = finishRegion({ N, L, dx, ground, water, frame, buildings: bld.list, center, lines: bld.lines, levee: o.levee });
  res.photo = photo;
  res.outer = outer;
  res.official = official;
  res.stats = { dem5aShare: fromFine / (N * N), buildings: bld.stats, photoTiles: photo.got };
  res.plateau = bld.plateau; // { source, license, fields } when the A1 PLATEAU extract covered this square
  return res;
}

/**
 * Wide, coarse square for inland points: sea → port → rivers/canals → the city around the point.
 * No building walls at ~10 m cells; instead Manning roughness rises with the built-up fraction
 * (内閣府・都道府県の津波計算も土地利用別の粗度で市街地を表す：高密度市街地 0.08 程度).
 */
export async function buildOuterRegion(o) {
  const { N, L } = o;
  const frame = makeFrame(o.center.lat, o.center.lon);
  const dx = L / N, half = L / 2;
  const prog = o.onProgress ?? (() => {});
  const nw = frame.toLatLon(-half - 60, -half - 60), se = frame.toLatLon(half + 60, half + 60);
  const bbox = { west: nw.lon, east: se.lon, north: nw.lat, south: se.lat };
  let done = 0, total = 1;
  const tick = () => { done++; prog(Math.min(0.95, done / total)); };
  const demP = loadDemMosaic(bbox, 14, URLS.dem10, tick);
  const photoP = loadPhoto(frame, L, 2048, L > 12000 ? 13 : 14, tick);
  const vecP = loadVectorCoarse(frame, L, tick);
  total = Math.ceil((L / 2000 + 1) ** 2) * 3;
  const [dem, photo, vec] = await Promise.all([demP, photoP, vecP]);
  if (dem.failed > 0) throw new Error(`広域の地形の一部（標高タイル${dem.failed}枚）を取得できませんでした。もう一度お試しください`);
  const ground = new Float32Array(N * N), water = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = frame.toLatLon(-half + (i + 0.5) * dx, -half + (j + 0.5) * dx);
    const e = dem.sample(p.lat, p.lon, true);
    const k = j * N + i;
    if (Number.isNaN(e)) { water[k] = 1; ground[k] = 0; } else ground[k] = e;
  }
  const res = finishRegion({ N, L, dx, ground, water, frame, buildings: [], center: o.center, lines: vec.lines, levee: o.levee });
  // built-up fraction from the z14 solid buildings (z14 carries no wooden houses → base land roughness 0.045)
  const cover = new Float32Array(N * N);
  for (const b of vec.solids) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [x, z] of b.ring) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    for (let j = Math.max(0, Math.floor((minz + half) / dx)); j <= Math.min(N - 1, Math.floor((maxz + half) / dx)); j++)
      for (let i = Math.max(0, Math.floor((minx + half) / dx)); i <= Math.min(N - 1, Math.floor((maxx + half) / dx)); i++)
        if (pointInRingShrunk(b.ring, -half + (i + 0.5) * dx, -half + (j + 0.5) * dx, 0)) cover[j * N + i] = 1;
  }
  const cb = blur(cover, N, Math.max(1, Math.round(40 / dx)));
  res.manning = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) res.manning[k] = water[k] ? 0.025 : Math.min(0.09, 0.045 + 0.08 * cb[k]);
  res.photo = photo;
  res.official = { cells: [], covered: false, available: false };
  res.stats = { outer: true, solids: vec.solids.length, lines: vec.lines.length };
  return res;
}

/** shared by the real loader and the offline synthetic town */
export function finishRegion({ N, L, dx, ground, water, frame, buildings, center, lines = [], levee = null }) {
  const half = L / 2;
  // ── sea = water connected to the domain edge; the rest are ponds/moats ──
  const sea = new Uint8Array(N * N);
  const q = new Int32Array(N * N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) {
    if (water[k] && !sea[k]) { sea[k] = 1; q[qt++] = k; }
  }
  while (qh < qt) {
    const k = q[qh++], i = k % N, j = (k / N) | 0;
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const n = b * N + a;
      if (water[n] && !sea[n]) { sea[n] = 1; q[qt++] = n; }
    }
  }
  // distance (m) from land for every water cell (multi-source BFS, 8-neighbour chamfer)
  const dist = new Float32Array(N * N).fill(1e9);
  qh = qt = 0;
  for (let k = 0; k < N * N; k++) if (!water[k]) { dist[k] = 0; q[qt++] = k; }
  const hasLand = qt > 0;
  // cheap two-pass chamfer distance transform
  const D1 = dx, D2 = dx * Math.SQRT2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; let v = dist[k];
    if (i > 0) v = Math.min(v, dist[k - 1] + D1);
    if (j > 0) { v = Math.min(v, dist[k - N] + D1); if (i > 0) v = Math.min(v, dist[k - N - 1] + D2); if (i < N - 1) v = Math.min(v, dist[k - N + 1] + D2); }
    dist[k] = v;
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const k = j * N + i; let v = dist[k];
    if (i < N - 1) v = Math.min(v, dist[k + 1] + D1);
    if (j < N - 1) { v = Math.min(v, dist[k + N] + D1); if (i < N - 1) v = Math.min(v, dist[k + N + 1] + D2); if (i > 0) v = Math.min(v, dist[k + N - 1] + D2); }
    dist[k] = v;
  }
  if (!hasLand) dist.fill(1000);

  // synthetic bathymetry: d = 3 + s/8 m (cap 14 m) — port basins and channels are deep; a gentler
  // 1 + s/40 made the harbour 1–5 m and over-damped the flow (汐見 round 1). Distances are smoothed
  // first so the chamfer transform's 45° terraces do not print through the water.
  const bed = new Float32Array(N * N);
  const eta0 = new Float32Array(N * N);
  let seaCells = 0;
  const sm = blur(dist, N, Math.max(2, Math.round(30 / dx)));
  for (let k = 0; k < N * N; k++) {
    if (sea[k]) {
      seaCells++;
      bed[k] = -Math.min(3 + sm[k] / 8, 14);
      eta0[k] = 0;
    } else if (water[k]) {
      // enclosed water: sit 0.3 m below the lowest surrounding bank
      bed[k] = NaN;
    } else {
      bed[k] = ground[k];
      eta0[k] = ground[k];
    }
  }
  // ponds
  for (let k = 0; k < N * N; k++) if (Number.isNaN(bed[k])) {
    const i = k % N, j = (k / N) | 0;
    let lo = Infinity;
    for (let r = 1; r < 12 && lo === Infinity; r++) for (const [a, b] of [[i + r, j], [i - r, j], [i, j + r], [i, j - r]]) {
      if (a >= 0 && b >= 0 && a < N && b < N && !water[b * N + a]) lo = Math.min(lo, ground[b * N + a]);
    }
    if (lo === Infinity) lo = 0;
    bed[k] = lo - 1.5;
    eta0[k] = lo - 0.3;
  }

  // ── buildings → grid (cell centre inside the footprint shrunk by ¼ cell) ──
  const bldH = new Float32Array(N * N); // roof height above ground; 0 = open
  const bldId = new Int32Array(N * N).fill(-1);
  const blds = [];
  buildings.forEach((b, bi) => {
    const r = b.ring;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, cx = 0, cz = 0;
    for (const [x, z] of r) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); cx += x; cz += z; }
    cx /= r.length; cz /= r.length;
    if (maxx < -half || minx > half || maxz < -half || minz > half) return;
    const height = buildingHeight(b, bi);
    const i0 = Math.max(0, Math.floor((minx + half) / dx)), i1 = Math.min(N - 1, Math.floor((maxx + half) / dx));
    const j0 = Math.max(0, Math.floor((minz + half) / dx)), j1 = Math.min(N - 1, Math.floor((maxz + half) / dx));
    let gmin = Infinity, gmax = -Infinity, cells = 0, onSea = 0;
    const cellList = [];
    for (let j = j0; j <= j1; j++) {
      const zc = -half + (j + 0.5) * dx;
      for (let i = i0; i <= i1; i++) {
        const xc = -half + (i + 0.5) * dx;
        // wooden houses: no inset — the 1–1.5 m gaps between them must not open into 2 m canals (汐見 r2 #4)
        if (!pointInRingShrunk(r, xc, zc, (b.kind ?? kindOf(b)) === 'normal' ? 0 : dx * 0.25)) continue;
        const k = j * N + i;
        cellList.push(k);
      }
    }
    for (const k of cellList) {
      if (water[k]) { onSea++; continue; }
      gmin = Math.min(gmin, ground[k]); gmax = Math.max(gmax, ground[k]);
      cells++;
    }
    if (!cells || onSea > cells) return; // pier sheds / pontoons over water → skip
    const id = blds.length;
    for (const k of cellList) {
      if (water[k]) continue;
      if (height > bldH[k]) { bldH[k] = height; bldId[k] = id; }
    }
    const kind = b.kind ?? kindOf(b);
    const wood = kind !== 'shed' && isWood(b, kind);
    // woodEst: "wooden" inferred from the 普通建物 class (it also holds 2-storey RC) — the screen must say so
    blds.push({ ring: r, height, base: gmin, top: gmax + height, cx, cz, src: b.src, kind, cells, wood, woodEst: wood && b.attrs?.st !== 'wood', attrs: b.attrs ?? null });
  });

  // ── seawalls / revetments / floodgates (GSI 5103 coastline-at-levee, 5203 river-at-levee, 5515 gate) ──
  // The land-side bank cells along those lines get a crest; a water cell is never raised.
  const leveeZ = new Float32Array(N * N); // 0 = no structure, else crest T.P. m
  let leveeCells = 0;
  if (levee?.enabled && lines.length) {
    const nearWater = (k) => { const i = k % N, j = (k / N) | 0; return (i > 0 && water[k - 1]) || (i < N - 1 && water[k + 1]) || (j > 0 && water[k - N]) || (j < N - 1 && water[k + N]); };
    for (const ln of lines) {
      for (let s2 = 1; s2 < ln.pts.length; s2++) {
        const [ax, az] = ln.pts[s2 - 1], [bx, bz] = ln.pts[s2];
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / (dx * 0.3)));
        for (let t = 0; t <= n; t++) {
          const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n;
          const ci = Math.floor((x + half) / dx), cj = Math.floor((z + half) / dx);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const i = ci + di, j = cj + dj;
            if (i < 0 || j < 0 || i >= N || j >= N) continue;
            const k = j * N + i;
            if (water[k] || bldH[k] > 0 || leveeZ[k]) continue;
            if (!nearWater(k) && (di || dj)) continue;
            leveeZ[k] = Math.max(ground[k] + 0.3, levee.crest);
            leveeCells++;
          }
        }
      }
    }
  }

  return { N, L, dx, frame, center, ground, bed, eta0, sea, water, dist, bldH, bldId, buildings: blds, seaCells, leveeZ, leveeCells, levee };
}

/** separable box blur ×2 (≈ gaussian) of a float field */
function blur(src, N, r) {
  let a = Float32Array.from(src, (v) => Math.min(v, 5000)), b = new Float32Array(N * N);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < N; j++) { let acc = 0; const row = j * N; for (let i = -r; i <= r; i++) acc += a[row + Math.min(N - 1, Math.max(0, i))]; for (let i = 0; i < N; i++) { b[row + i] = acc / (2 * r + 1); acc += a[row + Math.min(N - 1, i + r + 1)] - a[row + Math.max(0, i - r)]; } }
    for (let i = 0; i < N; i++) { let acc = 0; for (let j = -r; j <= r; j++) acc += b[Math.min(N - 1, Math.max(0, j)) * N + i]; for (let j = 0; j < N; j++) { a[j * N + i] = acc / (2 * r + 1); acc += b[Math.min(N - 1, j + r + 1) * N + i] - b[Math.max(0, j - r) * N + i]; } }
  }
  return a;
}

function kindOf(b) {
  // PLATEAU attributes: 構造種別 = 木造, or (structure unknown) 建物区分 = 普通建物 → rasterised like the GSI 普通建物
  // (no inset, 汐見 r2 #4); 無壁舎 lets water through like the GSI 無壁舎 (D3)
  const a = b.attrs;
  if (a?.st === 'wood' || (!a?.st && a?.sc === 'ordinary')) return 'normal';
  if (a?.sc === 'shed' || a?.sc === 'sturdy_shed') return 'shed';
  if (b.src === 'plateau') return 'plateau';
  return { 3101: 'normal', 3102: 'solid', 3103: 'tall', 3111: 'shed', 3112: 'shed' }[b.props?.ftCode] ?? 'normal';
}

/** wooden house (washes away at 2 m, 首藤1993): PLATEAU 構造種別 when known; otherwise the 普通建物 class
 *  of the same public-survey legend — PLATEAU bldg:class (sc = ordinary) when present, else the GSI
 *  普通建物 (3101): for bvmap footprints directly, for PLATEAU footprints via the GSI polygon under them */
function isWood(b, kind) {
  const st = b.attrs?.st;
  if (st) return st === 'wood';
  if (b.attrs?.sc) return b.attrs.sc === 'ordinary';
  if (b.src === 'bvmap' || b.src === 'synthetic') return kind === 'normal';
  return b.props?.gsiFt === 3101;
}

/** measured height (PLATEAU) or a deterministic estimate from the GSI building class */
function buildingHeight(b, bi) {
  const p = b.props ?? {};
  if (b.src === 'plateau') {
    const m = Number(p.measuredHeight);
    if (m > 1.5 && m < 400) return m;
    const s = Number(p.storeysAboveGround);
    if (s > 0) return s * 3.2 + 0.8;
    return 7;
  }
  if (b.height) return b.height;
  const r = hash01(bi, Math.round(b.ring[0][0] * 10));
  switch (p.ftCode) {
    case 3102: return 9 + r * 12;      // 堅ろう建物: RC 3–6 floors
    case 3103: return 30 + r * 30;     // 高層建物
    case 3111: case 3112: return 3.2 + r;  // 無壁舎 (sheds)
    default: return 5.8 + r * 2.2;     // 普通建物: mostly 2-storey wooden
  }
}

function pointInRingShrunk(r, x, z, inset) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (!inside || inset <= 0) return inside;
  // reject cells whose centre is within `inset` of an edge (keeps 1-cell alleys open)
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j], [bx, bz] = r[i];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    const ex = ax + t * vx - x, ez = az + t * vz - z;
    if (ex * ex + ez * ez < inset * inset) return false;
  }
  return true;
}
