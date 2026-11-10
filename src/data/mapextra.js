// 3Dの地図に出す「名前」と「道の線」— 国土地理院ベクトルタイル提供実験（bvmap）の label / road レイヤー。
// 建物を読むときに取ったタイル（ズーム16）から一緒に取り出すので、通信は増えない。
// 設計：docs/fable52/11_水の流れ・計算・画面・3D地図の設計.md（D3・D4）
//   名前  annoCtg 422 駅・885 学校・886 病院・884 消防署・883 警察署・880 官公署・651/673/889 おもな施設・800/210 町名
//   道    ftCode 2700番台（道路中心線）。rnkWidth 0〜4 が道幅の区分（細い→広い）。道路の名前はデータにないので出さない
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { tx2lon, ty2lat } from './geo.js';

// [札の種類, 優先度（大きいほど先に出す）]
const CAT = {
  422: ['st', 6],   // 駅
  885: ['sc', 5],   // 学校
  886: ['pub', 4],  // 病院
  884: ['pub', 4],  // 消防署
  883: ['pub', 3],  // 警察署（交番は除く）
  880: ['pub', 2],  // 官公署
  651: ['pub', 3], 673: ['pub', 3], 889: ['pub', 3], // 博物館・ホールなどの施設
  800: ['tw', 1], 210: ['tw', 1], // 町名
};
// 道幅の区分 → 描く幅（m）。3m未満／3〜5.5m／5.5〜13m／13〜19.5m／19.5m以上（地理院の区分）
export const ROAD_WIDTH_M = [2.5, 4, 7.5, 12, 17];

/** one bvmap tile → { labels: [{ name, kind, rank, x, z }], roads: [{ w, pts: [[x, z], …] }] } in local metres */
export function tileMapExtra(buf, t, frame) {
  const out = { labels: [], roads: [] };
  let vt;
  try { vt = new VectorTile(new PbfReader(new Uint8Array(buf))); } catch { return out; }
  const local = (p, ext) => { const q = frame.toLocal(ty2lat(t.y + p.y / ext, t.z), tx2lon(t.x + p.x / ext, t.z)); return [q.x, q.z]; };
  const lb = vt.layers.label;
  if (lb) {
    for (let i = 0; i < lb.length; i++) {
      const f = lb.feature(i), p = f.properties;
      const c = CAT[p.annoCtg];
      if (f.type !== 1 || !c || !p.knj) continue;
      const name = String(p.knj);
      if (/交番|駐在所|派出所/.test(name) || name.length > 16) continue;
      const g = f.loadGeometry()[0]?.[0];
      // only what lies inside this tile's own square (the buffer repeats its neighbours' labels)
      if (!g || g.x < 0 || g.y < 0 || g.x >= lb.extent || g.y >= lb.extent) continue;
      const [x, z] = local(g, lb.extent);
      out.labels.push({ name, kind: c[0], rank: c[1], x, z });
    }
  }
  const rd = vt.layers.road;
  if (rd) {
    for (let i = 0; i < rd.length; i++) {
      const f = rd.feature(i), p = f.properties;
      if (f.type !== 2 || !(p.ftCode >= 2700 && p.ftCode < 2800)) continue;
      // 0–4 are the published width classes; anything else (missing, "unknown") is drawn as a narrow road
      const rw = Number(p.rnkWidth);
      const w = Number.isInteger(rw) && rw >= 0 && rw <= 4 ? rw : 1;
      for (const line of f.loadGeometry()) {
        if (line.length < 2) continue;
        out.roads.push({ w, pts: line.map((q) => local(q, rd.extent)) });
      }
    }
  }
  return out;
}

/** the same name twice within 200 m (tile seams, a station's several operators' boards) → keep one */
export function dedupeLabels(labels) {
  const out = [];
  for (const l of labels) {
    if (out.some((o) => o.name === l.name && Math.hypot(o.x - l.x, o.z - l.z) < 200)) continue;
    out.push(l);
  }
  return out;
}
