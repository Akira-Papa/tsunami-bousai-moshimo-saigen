// 道の網（国土地理院ベクトルタイル提供実験の道路中心線）と、その上の最短の道のり。GPU を使わない。
//   タイル: https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/14/{x}/{y}.pbf  レイヤー road
//   ズーム14を使う：道路中心線の総延長はズーム14〜16で同じで、14がいちばん軽い（docs/fable52/10_避難ルートの設計.md）
//   使う線   ftCode 2701 通常部・2703 橋・高架・2704 トンネル・2711〜 庭園路・2721〜 徒歩道・2731〜 石段
//   使わない 高速道路（motorway = 1 または rdCtg = 3）：歩いて入れない
// 浸水する道・橋・川沿いは避けない（津波が来る前に逃げる想定での、ふつうの道の案内）。
// 地図にない細い道・私道・歩道橋・地下道は入っていない。立体交差が同じ点でつながって見えることがある。
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { makeFrame, tilesFor, tx2lon, ty2lat } from './geo.js';
import { fetchOk } from './tiles.js';

const Z = 14;
const URL = (t) => `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${t.z}/${t.x}/${t.y}.pbf`;
const cache = new Map(); // url → Promise<ArrayBuffer | null>
function loadTile(t) {
  const url = URL(t);
  if (!cache.has(url)) {
    const p = fetchOk(url, 15000).then((r) => (r ? r.arrayBuffer() : null));
    p.catch(() => cache.delete(url)); // a failed tile may be retried
    cache.set(url, p);
  }
  return cache.get(url);
}

/** clip segment a→b to the square [0, ext]² (Liang–Barsky); null when it lies outside */
function clipSeg(a, b, ext) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0]], [dx, ext - a[0]], [-dy, a[1]], [dy, ext - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy], t0 > 0, t1 < 1];
}

/**
 * road graph around (lat, lon) within ±R metres.
 * @returns {{ status: 'ok'|'failed'|'empty', frame, x: number[], z: number[], adj: Array<Array<[number, number]>>, edges: number }}
 *   x east / z south in metres from the point; adj[i] = [[j, length m], …]
 */
export async function loadRoadGraph(lat, lon, R = 1150) {
  const frame = makeFrame(lat, lon);
  const nw = frame.toLatLon(-R, -R), se = frame.toLatLon(R, R);
  const tiles = tilesFor({ west: nw.lon, east: se.lon, north: nw.lat, south: se.lat }, Z);
  let bufs;
  try { bufs = await Promise.all(tiles.map(loadTile)); } catch { return { status: 'failed', frame }; }

  const x = [], z = [], adj = [];
  const ids = new Map();
  const edge = []; // nodes created by clipping at a tile edge: the two halves of one road meet there
  const node = (px, pz, onEdge) => {
    const key = `${Math.round(px * 4)},${Math.round(pz * 4)}`; // 0.25 m: the tile grid itself is ~0.6 m
    let id = ids.get(key);
    if (id === undefined) { id = x.length; ids.set(key, id); x.push(px); z.push(pz); adj.push([]); if (onEdge) edge.push(id); }
    return id;
  };
  const link = (a, b) => {
    if (a === b) return;
    if (adj[a].some((e) => e[0] === b)) return;
    const len = Math.hypot(x[a] - x[b], z[a] - z[b]);
    adj[a].push([b, len]); adj[b].push([a, len]);
  };
  let nEdges = 0;
  tiles.forEach((t, k) => {
    const buf = bufs[k];
    if (!buf) return;
    let road;
    try { road = new VectorTile(new PbfReader(new Uint8Array(buf))).layers.road; } catch { return; }
    if (!road) return;
    const ext = road.extent;
    const toLocal = (q) => frame.toLocal(ty2lat(t.y + q[1] / ext, Z), tx2lon(t.x + q[0] / ext, Z));
    for (let i = 0; i < road.length; i++) {
      const f = road.feature(i), p = f.properties;
      if (!(p.ftCode >= 2700 && p.ftCode < 2800)) continue;   // road centre lines only (2201… are road edges)
      if (p.motorway === 1 || p.rdCtg === 3) continue;         // no walking on motorways
      for (const line of f.loadGeometry()) {
        for (let s = 1; s < line.length; s++) {
          // drop the tile buffer: each tile contributes exactly its own square, so nothing is doubled
          const c = clipSeg([line[s - 1].x, line[s - 1].y], [line[s].x, line[s].y], ext);
          if (!c) continue;
          const A = toLocal(c[0]), B = toLocal(c[1]);
          if (Math.max(Math.abs(A.x), Math.abs(A.z)) > R + 50 && Math.max(Math.abs(B.x), Math.abs(B.z)) > R + 50) continue;
          link(node(A.x, A.z, c[2]), node(B.x, B.z, c[3]));
          nEdges++;
        }
      }
    }
  });
  // stitch the tile seams: the two clipped ends of one road land within a tile-grid step of each other
  const cell = new Map();
  for (const id of edge) {
    const key = `${Math.round(x[id] / 2)},${Math.round(z[id] / 2)}`;
    (cell.get(key) ?? cell.set(key, []).get(key)).push(id);
  }
  for (const id of edge) {
    const cx = Math.round(x[id] / 2), cz = Math.round(z[id] / 2);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of cell.get(`${cx + i},${cz + j}`) ?? []) {
      if (o > id && Math.hypot(x[o] - x[id], z[o] - z[id]) < 1.6) link(id, o);
    }
  }
  if (!x.length) return { status: 'empty', frame, x, z, adj, edges: 0 };
  return { status: 'ok', frame, x, z, adj, edges: nEdges };
}

/** nearest point on the network to (px, pz): a new node spliced into that road. null when nothing within maxD metres */
export function snapToGraph(g, px, pz, maxD = 150) {
  let best = null;
  for (let a = 0; a < g.adj.length; a++) for (const [b] of g.adj[a]) {
    if (b < a) continue;
    const vx = g.x[b] - g.x[a], vz = g.z[b] - g.z[a], l2 = vx * vx + vz * vz;
    const t = l2 ? Math.max(0, Math.min(1, ((px - g.x[a]) * vx + (pz - g.z[a]) * vz) / l2)) : 0;
    const qx = g.x[a] + t * vx, qz = g.z[a] + t * vz, d = Math.hypot(qx - px, qz - pz);
    if (!best || d < best.d) best = { d, a, b, t, qx, qz };
  }
  if (!best || best.d > maxD) return null;
  if (best.t < 1e-3) return { id: best.a, d: best.d };
  if (best.t > 1 - 1e-3) return { id: best.b, d: best.d };
  const id = g.x.length;
  g.x.push(best.qx); g.z.push(best.qz); g.adj.push([]);
  for (const o of [best.a, best.b]) { const len = Math.hypot(g.x[o] - best.qx, g.z[o] - best.qz); g.adj[id].push([o, len]); g.adj[o].push([id, len]); }
  return { id, d: best.d };
}

/** shortest walking distance from `src` to every node (Dijkstra, binary heap). dist in metres, Infinity when not connected */
export function shortestPaths(g, src) {
  const n = g.adj.length;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const heap = [[0, src]];
  dist[src] = 0;
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const down = (i) => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
  while (heap.length) {
    const [d, u] = heap[0];
    const last = heap.pop();
    if (heap.length) { heap[0] = last; down(0); }
    if (d > dist[u]) continue;
    for (const [v, w] of g.adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push([nd, v]); up(heap.length - 1); }
    }
  }
  return { dist, prev };
}

/** the path src → dst as [[lon, lat], …] */
export function pathTo(g, sp, dst) {
  const out = [];
  for (let u = dst; u >= 0; u = sp.prev[u]) { const p = g.frame.toLatLon(g.x[u], g.z[u]); out.push([p.lon, p.lat]); }
  return out.reverse();
}

export const ROAD_SOURCE = '国土地理院ベクトルタイル提供実験の道路中心線';
export const ROAD_SOURCE_URL = 'https://maps.gsi.go.jp/development/vt.html';
