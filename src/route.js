// 逃げる道のり（目安）— 選んだ地点から、指定緊急避難場所と「高い所」までの、道の網の上でいちばん短い道。
// GPU を使わない。計算はブラウザの中だけで行い、外へは何も送らない。
// 設計：docs/fable52/10_避難ルートの設計.md
//  ・浸水する道・橋・川沿いは避けない（津波が来る前に逃げる想定での、ふつうの道の案内）
//  ・「高い所」＝道路の上で、まわり50mも含めて標高が基準以上の、道のりがいちばん近い地点
//    （堤防の天端のような細い高まりは、まわりが低いので選ばれない）
//  ・基準は「海の高さ」と、その2倍。気象庁：津波がかけ上がる高さ（遡上高）は、海岸での津波の高さの
//    2〜4倍に達することが多い → 「海の高さより高ければ来ない」とは言えないので、2倍も並べる
import { loadRoadGraph, snapToGraph, shortestPaths, pathTo } from './data/roads.js';
import { loadDemMosaic, URLS } from './data/tiles.js';
import { makeFrame } from './data/geo.js';

const R = 1150;        // 道を調べる範囲（地点から±R m。ズーム14のタイル4〜6枚・最悪9枚、標高タイルも同じくらい）
const SNAP_START = 150; // 地点から道まで
const SNAP_SITE = 120;  // 逃げる場所から道まで
const PLATEAU = 50;     // 「高い所」は、まわりこの距離も基準以上

/**
 * @param sites loadEvacSites() の sites（lat, lon を持つ）
 * @returns status: 'ok' | 'failed'（道のタイルが取れない）| 'noroad'（近くに道のデータがない）
 */
// ── 標高：10mメッシュ（全国）と、あれば5mメッシュ（航空レーザ測量など・より正確）の、低いほうを使う ──
// 10mメッシュだけでは、斜面や造成地で数m高く出ることがある（尾鷲で 19.4m に対し5mメッシュは 14.9m）。
// 「高い」と言う側の誤りを避けるため、両方ある所では低いほうを採る。
const fine = [];   // 5mメッシュの小さなモザイク（地点のまわりだけ）を覚えておく
async function fineAt(lat, lon, r = 70) {
  for (const f of fine) if (lat < f.n && lat > f.s && lon > f.w && lon < f.e) return f.dem;
  const dLat = 320 / 110940, dLon = 320 / (111320 * Math.cos((lat * Math.PI) / 180));
  const box = { west: lon - dLon, east: lon + dLon, north: lat + dLat, south: lat - dLat };
  let dem = null;
  try { const d = await loadDemMosaic(box, 15, URLS.dem5a); if (d.got && !d.failed) dem = d; } catch { dem = null; }
  const m = (r + 10) / 110940, ml = (r + 10) / (111320 * Math.cos((lat * Math.PI) / 180));
  fine.push({ n: box.north - m, s: box.south + m, w: box.west + ml, e: box.east - ml, dem });
  if (fine.length > 24) fine.shift();
  return dem;
}
/** elevation at a point: the lower of the 10 m and (where it exists) the 5 m mesh. NaN when neither is known */
async function elevLow(dem10, lat, lon) {
  const a = dem10 ? dem10.sample(lat, lon, true) : NaN;
  const f = await fineAt(lat, lon);
  const b = f ? f.sample(lat, lon, true) : NaN;
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return Math.min(a, b);
}

export async function planRoutes(lat, lon, sites = []) {
  // the roads and the elevations are fetched side by side
  const fr = makeFrame(lat, lon);
  const nw = fr.toLatLon(-R - 120, -R - 120), se = fr.toLatLon(R + 120, R + 120);
  const demP = loadDemMosaic({ west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }, 14, URLS.dem10).then((d) => (d.got && !d.failed ? d : null)).catch(() => null);
  const g = await loadRoadGraph(lat, lon, R);
  if (g.status === 'failed') return { status: 'failed' };
  if (g.status !== 'ok') return { status: 'noroad' };
  const start = snapToGraph(g, 0, 0, SNAP_START);
  if (!start) return { status: 'noroad' };
  // splice every destination into the network before the search
  const snaps = sites.map((s) => { const p = g.frame.toLocal(s.lat, s.lon); return snapToGraph(g, p.x, p.z, SNAP_SITE); });
  const sp = shortestPaths(g, start.id);
  // elevations. A missing tile means "unknown", never "low" or "sea"
  const dem = await demP;
  const elevs = await Promise.all(sites.map((st) => (dem ? elevLow(dem, st.lat, st.lon) : Promise.resolve(NaN))));
  const out = sites.map((st, i) => {
    const sn = snaps[i];
    const ok = sn && Number.isFinite(sp.dist[sn.id]);
    return {
      road: ok ? sp.dist[sn.id] + start.d + sn.d : null,   // the walk to and from the road is part of the way
      path: ok ? [[lon, lat], ...pathTo(g, sp, sn.id), [st.lon, st.lat]] : null,
      elev: Number.isNaN(elevs[i]) ? null : elevs[i],
    };
  });
  // nodes in order of walking distance (for the "nearest high ground" searches)
  const order = [];
  for (let i = 0; i < g.adj.length; i++) if (Number.isFinite(sp.dist[i])) order.push(i);
  order.sort((a, b) => sp.dist[a] - sp.dist[b]);
  const here = dem ? dem.sample(lat, lon, true) : NaN;
  return { status: 'ok', lat, lon, g, sp, start, order, dem, sites: out, here: Number.isNaN(here) ? null : here, R };
}

/**
 * the nearest point on the road network (by walking distance) that stands at or above `level` metres (T.P.),
 * together with the ground 50 m around it — judged on the 10 m mesh first and then, where the 5 m mesh exists,
 * confirmed on it (a candidate the finer data puts below the level is dropped).
 * @returns { found: true, dist, elev, lat, lon, path } | { found: false, reason: 'none' | 'nodem' }
 */
export async function highGround(plan, level) {
  if (plan?.status !== 'ok') return { found: false, reason: 'none' };
  if (!plan.dem) return { found: false, reason: 'nodem' };
  const { g, sp, dem } = plan;
  const kx = 111320 * Math.cos((plan.lat * Math.PI) / 180);
  const ring = (lat, lon) => [[lat, lon], ...Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4; return [lat + (Math.sin(a) * PLATEAU) / 110940, lon + (Math.cos(a) * PLATEAU) / kx]; })];
  let checked = 0, lastRej = null;
  for (const i of plan.order) {
    const p = g.frame.toLatLon(g.x[i], g.z[i]);
    const pts = ring(p.lat, p.lon);
    // 10 m mesh: the point and the eight points 50 m around it (NaN = water / no data fails too)
    if (!pts.every(([la, lo]) => dem.sample(la, lo, true) >= level)) continue;
    // candidates right next to one the finer mesh has just rejected are skipped (they share the same ground)
    if (lastRej && Math.hypot(g.x[i] - lastRej[0], g.z[i] - lastRej[1]) < 40) continue;
    const f = await fineAt(p.lat, p.lon);
    let e = dem.sample(p.lat, p.lon, true);
    if (f) {
      const vs = pts.map(([la, lo]) => f.sample(la, lo, true));
      if (vs.some((v) => v < level)) { lastRej = [g.x[i], g.z[i]]; if (++checked > 40) break; continue; }
      if (!Number.isNaN(vs[0])) e = Math.min(e, vs[0]);
    }
    return { found: true, dist: sp.dist[i] + plan.start.d, elev: e, lat: p.lat, lon: p.lon, path: [[plan.lon, plan.lat], ...pathTo(g, sp, i)], fine: !!f };
  }
  return { found: false, reason: 'none' };
}

export const ROUTE_RANGE_M = R;
