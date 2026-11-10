// 3Dの地図に出す「逃げる道のり」の帯（設計 D5：docs/fable52/11_水の流れ・計算・画面・3D地図の設計.md）
//   緑＝指定の逃げる場所まで／橙＝標高が高い所まで。2Dの地図と同じ道・同じ色（白いふちつき）。
//   いま水が来ている区間は、灰色の点線にする。消すと「道がない」、実線のままだと「水の中を通れる」と読まれるため。
//   帯は水面より少し上に描く（水の下に沈めると見えない・水の上に色の線を引くと通れるように見える → 点線で区別）。
//   計算した四角の外は描かない（外の水は計算していないので、乾いているとは言えない）。
// 道は、2Dのカードで求めた道のり（国土地理院ベクトルタイルの道路中心線・浸水する道も避けない）と同じもの。
import * as THREE from 'three/webgpu';
import { storage, attribute, varying, vec3, vec4, float, int, max, clamp, mix, smoothstep, abs, fract, step, select, length, cameraPosition } from 'three/tsl';

const KIND = { site: 0, high: 1 };

/**
 * @param feats [{ id, kind: 'site'|'high', path: [[lon, lat], …] }]（brief.routes.feats）
 * @param sel   the id the card picked (drawn wider, the others fainter) or null
 * @returns { mesh, ends: [{ id, kind, x, y, z, feat }], clipped, dispose } or null when nothing lies inside the square
 */
export function createRoutes3D(feats, sel, { region, solver }) {
  const { N, L, dx, frame } = region;
  const half = L / 2, edge = half - dx * 1.5;
  const pos = [], side = [], info = [], nrm = [], cell = [];
  const ends = [];
  let clipped = false; // some part of a way lies outside the computed square (not drawn)
  const inside = (p) => Math.abs(p[0]) < edge && Math.abs(p[1]) < edge;
  const groundOf = (x, z) => {
    const i = Math.min(N - 1, Math.max(0, Math.floor((x + half) / dx))), j = Math.min(N - 1, Math.max(0, Math.floor((z + half) / dx)));
    const k = j * N + i;
    // on a building cell (a road under an overpass, a snapped end point) the road is on the ground, not on the roof
    return { k, y: region.water[k] ? Math.max(0, region.bed[k]) : region.bed[k] };
  };
  const idx = [];
  let nv = 0;
  for (const f of feats) {
    if (!f.path || f.path.length < 2) continue;
    // lat/lon → this square's metres, then a point every ~dx so the band follows the ground and the water
    const raw = f.path.map(([lon, lat]) => { const q = frame.toLocal(lat, lon); return [q.x, q.z]; });
    const pts = [];
    for (let a = 0; a < raw.length - 1; a++) {
      const [x0, z0] = raw[a], [x1, z1] = raw[a + 1];
      const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / dx));
      for (let t = 0; t < n; t++) pts.push([x0 + ((x1 - x0) * t) / n, z0 + ((z1 - z0) * t) / n]);
    }
    pts.push(raw[raw.length - 1]);
    // split into the runs that lie inside the computed square
    let run = [];
    const runs = [];
    let s = 0;
    for (let m = 0; m < pts.length; m++) {
      if (m) s += Math.hypot(pts[m][0] - pts[m - 1][0], pts[m][1] - pts[m - 1][1]);
      if (inside(pts[m])) run.push([pts[m][0], pts[m][1], s]);
      else { clipped = true; if (run.length > 1) runs.push(run); run = []; }
    }
    if (run.length > 1) runs.push(run);
    const last = pts[pts.length - 1];
    if (inside(last)) { const g = groundOf(last[0], last[1]); ends.push({ id: f.id, kind: f.kind, x: last[0], y: g.y, z: last[1], feat: f }); }
    const kind = KIND[f.kind] ?? 0, on = sel == null ? 0.5 : f.id === sel ? 1 : 0;
    for (const r of runs) {
      const g = r.map((q) => groundOf(q[0], q[1]));
      // which cell tells whether THIS piece of road is under water:
      //  ・a bridge over a river / canal / harbour basin (the cell is water from the start): the water under it says
      //    nothing about the road on it → read the nearest bank along the way (and keep the band at the banks' height)
      //  ・a building cell (the line snapped onto a footprint, a road under an overpass): read the nearest open cell
      const bad = (k) => region.water[k] || region.bldH[k] > 0;
      const probe = g.map((q) => q.k), base = g.map((q) => q.y);
      for (let m = 0; m < r.length; m++) {
        if (!bad(g[m].k)) continue;
        let a = m, b = m;
        while (a >= 0 && bad(g[a].k)) a--;
        while (b < r.length && bad(g[b].k)) b++;
        const da = a >= 0 ? m - a : Infinity, db = b < r.length ? b - m : Infinity;
        if (da === Infinity && db === Infinity) continue; // a run entirely over water: nothing better to read
        probe[m] = g[da <= db ? a : b].k;
        if (region.water[g[m].k]) base[m] = Math.max(a >= 0 ? g[a].y : -Infinity, b < r.length ? g[b].y : -Infinity);
      }
      for (let m = 0; m < r.length; m++) {
        const a = r[Math.max(0, m - 1)], b = r[Math.min(r.length - 1, m + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        for (const sd of [-1, 1]) {
          pos.push(r[m][0], base[m], r[m][1]);
          side.push(sd);
          nrm.push(-tz, tx);
          info.push(r[m][2], kind, on, 0);
          cell.push(probe[m]);
        }
        if (m) { const v = nv + m * 2; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
      }
      nv += r.length * 2;
    }
  }
  if (!nv) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('rside', new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute('rnrm', new THREE.Float32BufferAttribute(nrm, 2));
  geo.setAttribute('rinfo', new THREE.Float32BufferAttribute(info, 4));
  geo.setAttribute('rcell', new THREE.Float32BufferAttribute(cell, 1));
  // the water that was already there when the run began (land below the starting tide, e.g. a quay at high tide):
  // only water ABOVE it counts as "the tsunami has reached this road". Filled in by calibrate() from the GPU.
  const base0 = new Float32Array(cell.length);
  const baseAttr = new THREE.Float32BufferAttribute(base0, 1);
  geo.setAttribute('rbase', baseAttr);
  geo.setIndex(idx);

  // R = (drawn water level, slope x, slope z, drawn depth) per cell — the same numbers the water surface uses
  const Rr = storage(solver.buffers.R.value, 'vec4', N * N).toReadOnly();
  // the cell and its four neighbours: a wall / levee / gate cell is drawn "dry" even with water all round it
  const kc = int(attribute('rcell', 'float'));
  const taps = [kc, kc.add(1), kc.sub(1), kc.add(N), kc.sub(N)].map((k) => Rr.element(k));
  const p = attribute('position', 'vec3');
  const sd = attribute('rside', 'float');
  const nr = attribute('rnrm', 'vec2');
  const inf = attribute('rinfo', 'vec4');
  const wetH = taps.slice(1).reduce((acc, t) => max(acc, t.w), taps[0].w).sub(attribute('rbase', 'float'));
  const lvl = taps.slice(1).reduce((acc, t) => max(acc, select(t.w.greaterThan(0.02), t.x, float(-1e4))), select(taps[0].w.greaterThan(0.02), taps[0].x, float(-1e4)));
  // on the water: ride just above its surface; on dry ground: just above the ground
  const y = max(p.y, lvl);
  const centre = vec3(p.x, y, p.z);
  const dist = length(cameraPosition.sub(centre));
  // a band a few pixels wide at any distance (wider for the line the card picked)
  const wid = clamp(dist.mul(0.0050), 1.6, 18).mul(mix(float(0.85), float(1.45), inf.z));
  const makeMat = (xray) => {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: !xray, side: THREE.DoubleSide });
    mat.positionNode = vec3(p.x.add(nr.x.mul(sd).mul(wid.mul(0.5))), y.add(0.45).add(dist.mul(0.0011)), p.z.add(nr.y.mul(sd).mul(wid.mul(0.5))));
    const vWet = varying(smoothstep(0.02, 0.05, wetH), 'vRtW'); // dashes from ~5 cm: the same depth as the bright water-edge line
    const vSide = varying(sd, 'vRtS');
    const vS = varying(inf.x, 'vRtA');
    const vK = varying(inf.y, 'vRtK');
    const vOn = varying(inf.z, 'vRtO');
    const vDist = varying(dist, 'vRtD');
    // the same colours as the 2-D map: green #15803d (designated place), orange #c2410c (high ground), white casing
    const base = mix(vec3(0.0075, 0.216, 0.047), vec3(0.539, 0.053, 0.004), vK); // linear values of #15803d / #c2410c
    const casing = smoothstep(0.74, 0.86, abs(vSide)); // a thin white edge: the colour must stay readable when the band is only a few pixels wide
    const dryCol = mix(base, vec3(1, 1, 1), casing);
    // under water: grey dashes (≈ 9 m on, 7 m off near; longer when far, so they never blur into a solid line)
    const dash = clamp(vDist.mul(0.012), 16, 90);
    const on = step(fract(vS.div(dash)), 0.56);
    // under water: light grey dashes with a dark edge — readable on muddy water and on clear water alike, and
    // never the thin tapering pale-blue strokes of the flow marks (those have no edge and no regular gaps)
    const wetCol = mix(vec3(0.58, 0.61, 0.64), vec3(0.02, 0.025, 0.03), smoothstep(0.52, 0.66, abs(vSide)));
    const col = mix(dryCol, wetCol, vWet);
    const aDry = float(0.96), aWet = on.mul(0.95);
    const fade = mix(float(0.42), float(1), step(0.25, vOn)); // with a line picked, the others step back
    mat.colorNode = vec4(col, 1);
    // the x-ray pass: where houses stand in front, the way still shows, faintly (it must not look like it runs over roofs)
    mat.opacityNode = mix(aDry, aWet, vWet).mul(fade).mul(xray ? 0.3 : 1);
    mat.alphaTestNode = float(0.02);
    mat.fog = true;
    return mat;
  };
  const mat = makeMat(false), matX = makeMat(true);
  const mesh = new THREE.Group();
  const front = new THREE.Mesh(geo, mat), behind = new THREE.Mesh(geo, matX);
  front.frustumCulled = behind.frustumCulled = false;
  behind.renderOrder = 5; front.renderOrder = 6; // after the water and the flow marks
  mesh.add(behind, front);
  mesh.visible = false;
  const cells = Int32Array.from(cell);
  /** read the starting water once (call before the wave reaches land). Returns false when it was too late */
  async function calibrate(renderer, time, latest = 120) {
    if (!(time <= latest)) return false;
    const buf = await renderer.getArrayBufferAsync(solver.buffers.R.value);
    const R = new Float32Array(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength / 4);
    for (let v = 0; v < cells.length; v++) {
      const k = cells[v];
      let w = 0;
      for (const q of [k, k + 1, k - 1, k + N, k - N]) w = Math.max(w, R[q * 4 + 3] || 0);
      base0[v] = w;
    }
    baseAttr.needsUpdate = true;
    return true;
  }
  return { mesh, ends, clipped, cells, base: base0, calibrate, dispose() { geo.dispose(); mat.dispose(); matX.dispose(); } };
}
