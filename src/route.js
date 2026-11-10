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

const R = 1150;        // 道を調べる範囲（地点から±R m。ズーム14のタイル最大4枚）
const SNAP_START = 150; // 地点から道まで
const SNAP_SITE = 120;  // 逃げる場所から道まで
const PLATEAU = 50;     // 「高い所」は、まわりこの距離も基準以上

/**
 * @param sites loadEvacSites() の sites（lat, lon を持つ）
 * @returns status: 'ok' | 'failed'（道のタイルが取れない）| 'noroad'（近くに道のデータがない）
 */
export async function planRoutes(lat, lon, sites = []) {
  const g = await loadRoadGraph(lat, lon, R);
  if (g.status === 'failed') return { status: 'failed' };
  if (g.status !== 'ok') return { status: 'noroad' };
  const start = snapToGraph(g, 0, 0, SNAP_START);
  if (!start) return { status: 'noroad' };
  // splice every destination into the network before the search
  const snaps = sites.map((s) => { const p = g.frame.toLocal(s.lat, s.lon); return snapToGraph(g, p.x, p.z, SNAP_SITE); });
  const sp = shortestPaths(g, start.id);
  // elevations (GSI 10 m DEM). A missing tile means "unknown", never "low" or "sea"
  let dem = null;
  try {
    const nw = g.frame.toLatLon(-R - 120, -R - 120), se = g.frame.toLatLon(R + 120, R + 120);
    const d = await loadDemMosaic({ west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }, 14, URLS.dem10);
    if (d.got && !d.failed) dem = d;
  } catch { dem = null; }
  const elevAt = (la, lo) => (dem ? dem.sample(la, lo, true) : NaN);
  const out = sites.map((s, i) => {
    const sn = snaps[i];
    const ok = sn && Number.isFinite(sp.dist[sn.id]);
    const e = elevAt(s.lat, s.lon);
    return {
      road: ok ? sp.dist[sn.id] + start.d + sn.d : null,   // the walk to and from the road is part of the way
      path: ok ? [[lon, lat], ...pathTo(g, sp, sn.id), [s.lon, s.lat]] : null,
      elev: Number.isNaN(e) ? null : e,
    };
  });
  // nodes in order of walking distance (for the "nearest high ground" searches)
  const order = [];
  for (let i = 0; i < g.adj.length; i++) if (Number.isFinite(sp.dist[i])) order.push(i);
  order.sort((a, b) => sp.dist[a] - sp.dist[b]);
  const here = elevAt(lat, lon);
  return { status: 'ok', lat, lon, g, sp, start, order, dem, sites: out, here: Number.isNaN(here) ? null : here, R };
}

/**
 * the nearest point on the road network (by walking distance) that stands at or above `level` metres (T.P.),
 * together with the ground 50 m around it.
 * @returns { found: true, dist, elev, lat, lon, path } | { found: false, reason: 'none' | 'nodem' }
 */
export function highGround(plan, level) {
  if (plan?.status !== 'ok') return { found: false, reason: 'none' };
  if (!plan.dem) return { found: false, reason: 'nodem' };
  const { g, sp, dem } = plan;
  const kx = 111320 * Math.cos((plan.lat * Math.PI) / 180);
  for (const i of plan.order) {
    const p = g.frame.toLatLon(g.x[i], g.z[i]);
    const e = dem.sample(p.lat, p.lon, true);
    if (!(e >= level)) continue;
    let all = true;
    for (let k = 0; k < 8 && all; k++) {
      const a = (k * Math.PI) / 4;
      const v = dem.sample(p.lat + (Math.sin(a) * PLATEAU) / 110940, p.lon + (Math.cos(a) * PLATEAU) / kx, true);
      if (!(v >= level)) all = false;   // NaN (water / no data) fails too
    }
    if (!all) continue;
    return { found: true, dist: sp.dist[i] + plan.start.d, elev: e, lat: p.lat, lon: p.lon, path: [[plan.lon, plan.lat], ...pathTo(g, sp, i)] };
  }
  return { found: false, reason: 'none' };
}

export const ROUTE_RANGE_M = R;
