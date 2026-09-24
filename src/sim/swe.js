// ─────────────────────────────────────────────────────────────
//  GPU tsunami solver (three.js WebGPURenderer + TSL compute)
//  state A/B  : instancedArray vec4 (h, hu, hv, _)  — f32 (fp16 would break 1 mm wet/dry)
//  static S   : (z, wall, manning, _)     static W : (relax weight, dir x, dir z, sea depth)
//  aux T0/T1  : (foam, turbidity, wetness, η of last frame)   M : (max depth, arrival s, max speed, max η)
//  render R   : (η for drawing, n.x, n.z, drawn depth)        R2: (foam, turbidity, u, v)
//  One sub-step = SSP-RK2 = 2 dispatches (A→B, then (A,B)→A in place).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three/webgpu';
import {
  Fn, wgsl, wgslFn, uniform, vec2, vec3, vec4, float, int, uint, uvec2, instanceIndex, instancedArray,
  textureStore, clamp, max, min, sqrt, abs, exp, select, If, mix, smoothstep, fract, sin, dot, length, atomicAdd, atomicMax, atomicMin, atomicStore, floatBitsToUint, floor,
} from 'three/tsl';
import { SWE_LIB, SWE_CELL } from './swe-wgsl.js';

export const G = 9.81;
export const PARTICLES = 1 << 17;

export function createSolver(renderer, region, opts = {}) {
  const { N, dx } = region;
  const NN = N * N;
  const H = opts.H ?? 5;
  const tide = opts.tide ?? 0;          // initial sea level (T.P. m): 朔望平均満潮位 where known
  const breach = opts.breach ?? true;   // 越流した堤防はその場で壊れる（内閣府・愛知県の想定条件）
  // 木造家屋の流失: a wooden house whose surroundings reach 2 m of flow depth stops being a wall
  // (首藤 1993: 浸水深 2 m で木造家屋は全面破壊). Off unless asked for (the solver tests use plain walls).
  const washDepth = opts.washaway === false || opts.washaway == null ? 0 : (typeof opts.washaway === 'number' ? opts.washaway : 2.0);
  const lArr = new Float32Array(NN * 4); // levee: (is levee, ground, crest, broken)
  // one-way nesting: { solver: outer solver, offset: {x,z} of this square's centre in the outer frame }
  const nest = opts.nest ?? null;
  const nestW = 70; // m of edge band that follows the outer solution
  const leveeIdx = [];

  // ── static fields ──
  const sArr = new Float32Array(NN * 4);
  const wArr = new Float32Array(NN * 4);
  const aArr = new Float32Array(NN * 4);
  const tArr = new Float32Array(NN * 4);
  const mArr = new Float32Array(NN * 4);
  // wave-maker band: wide squares need a thicker, stiffer band — it stands in for the whole open sea
  // that must keep feeding a city-wide flood
  const relaxW = Math.max(200, region.L * 0.04); // m
  const L = region.L;
  let maxDepth = 1;
  for (let k = 0; k < NN; k++) {
    const i = k % N, j = (k / N) | 0;
    const wall = region.bldH[k] > 0 && region.buildings[region.bldId[k]]?.kind !== 'shed';
    const lv = region.leveeZ?.[k] > 0 && !wall;
    const z = lv ? region.leveeZ[k] : region.bed[k];
    if (lv) { lArr.set([1, region.bed[k], region.leveeZ[k], 0], k * 4); leveeIdx.push(k); }
    sArr[k * 4] = z;
    sArr[k * 4 + 1] = wall ? 1 : 0;
    sArr[k * 4 + 2] = opts.manning ?? region.manning?.[k] ?? (region.water[k] ? 0.025 : 0.03);
    sArr[k * 4 + 3] = !region.water[k] && !wall ? 1 : 0; // land that starts dry (for the flood-front probe)
    const eta0 = region.sea[k] ? Math.max(region.eta0[k], tide) : region.eta0[k];
    const h0 = wall ? 0 : Math.max(0, eta0 - z);
    aArr[k * 4] = h0;
    maxDepth = Math.max(maxDepth, h0);
    tArr[k * 4 + 1] = region.sea[k] ? 0.12 : 0.0;
    tArr[k * 4 + 3] = h0 + z;
    mArr[k * 4 + 1] = h0 > 0.01 ? -1 : 1e9; // arrival: −1 = water from the start
    mArr[k * 4 + 3] = -1e3;
    // nested square: every edge cell is fed by the outer (wide) solution; there is no own wave-maker
    if (nest) {
      const x = -L / 2 + (i + 0.5) * dx, zz = -L / 2 + (j + 0.5) * dx;
      const e = Math.min(L / 2 - Math.abs(x), L / 2 - Math.abs(zz));
      wArr[k * 4] = e < nestW ? (1 - e / nestW) ** 2 + 0.02 : 0;
      continue;
    }
    // relaxation zone (open sea only: narrow rivers leaving the domain must not inject waves)
    if (region.sea[k]) {
      const x = -L / 2 + (i + 0.5) * dx, zz = -L / 2 + (j + 0.5) * dx;
      const e = Math.min(L / 2 - Math.abs(x), L / 2 - Math.abs(zz));
      const open = smooth(40, 110, region.dist[k]);
      const w = e < relaxW ? (1 - e / relaxW) ** 2 * open : 0;
      // shoreward direction = −∇(distance to land)
      const d = (a, b) => region.dist[Math.min(N - 1, Math.max(0, b)) * N + Math.min(N - 1, Math.max(0, a))];
      let gx = d(i + 1, j) - d(i - 1, j), gz = d(i, j + 1) - d(i, j - 1);
      const gl = Math.hypot(gx, gz) || 1;
      wArr[k * 4] = w;
      wArr[k * 4 + 1] = -gx / gl;
      wArr[k * 4 + 2] = -gz / gl;
      wArr[k * 4 + 3] = -z;
    }
  }
  function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  // ── wash-away lists: the wall cells of every wooden house, and the ring of cells around it (8-neighbours
  //    that are not the house itself and did not start under water — a quay-side house must not "wash away"
  //    at t = 0 because the harbour next to it is 5 m deep) ──
  const nB = region.buildings?.length ?? 0;
  const woodCells = [], woodCellB = [], rimCells = [], rimB = [], woodIds = [];
  if (washDepth > 0 && nB) {
    const count = new Int32Array(nB + 1);
    for (let k = 0; k < NN; k++) { const b = region.bldId[k]; if (b >= 0 && sArr[k * 4 + 1] > 0.5 && region.buildings[b]?.wood) count[b + 1]++; }
    for (let b = 0; b < nB; b++) count[b + 1] += count[b];
    const start = count.slice(0, nB + 1), byB = new Int32Array(count[nB]);
    const fill = start.slice();
    for (let k = 0; k < NN; k++) { const b = region.bldId[k]; if (b >= 0 && sArr[k * 4 + 1] > 0.5 && region.buildings[b]?.wood) byB[fill[b]++] = k; }
    const stamp = new Int32Array(NN).fill(-1);
    for (let b = 0; b < nB; b++) {
      if (start[b + 1] === start[b]) continue;
      woodIds.push(b);
      for (let q = start[b]; q < start[b + 1]; q++) {
        const k = byB[q], i = k % N, j = (k / N) | 0;
        woodCells.push(k); woodCellB.push(b);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, c = j + dj;
          if ((!di && !dj) || a < 0 || c < 0 || a >= N || c >= N) continue;
          const n = c * N + a;
          if (region.bldId[n] === b || stamp[n] === b || region.water[n] || aArr[n * 4] > 0.01) continue;
          stamp[n] = b; rimCells.push(n); rimB.push(b);
        }
      }
    }
  }
  const wash = washDepth > 0 && woodIds.length > 0;

  const S = instancedArray(sArr, 'vec4');
  const W = instancedArray(wArr, 'vec4');
  const A = instancedArray(aArr.slice(), 'vec4');
  const B = instancedArray(aArr.slice(), 'vec4');
  const T0 = instancedArray(tArr.slice(), 'vec4');
  const T1 = instancedArray(tArr.slice(), 'vec4');
  const M = instancedArray(mArr, 'vec4');
  const LV = instancedArray(lArr, 'vec4');
  const LI = instancedArray(new Uint32Array(leveeIdx.length ? leveeIdx : [0]), 'uint');
  const breachCount = instancedArray(1, 'uint').toAtomic();
  // wash-away state per building (0 standing, 1 washed, 2 washed & counted) + the cell lists above
  const WF = instancedArray(new Uint32Array(Math.max(1, nB)), 'uint');
  const WC = instancedArray(new Uint32Array(wash ? woodCells : [0]), 'uint');
  const WCB = instancedArray(new Uint32Array(wash ? woodCellB : [0]), 'uint');
  const RC = instancedArray(new Uint32Array(wash && rimCells.length ? rimCells : [0]), 'uint');
  const RCB = instancedArray(new Uint32Array(wash && rimB.length ? rimB : [0]), 'uint');
  const WI = instancedArray(new Uint32Array(wash ? woodIds : [0]), 'uint');
  const washCount = instancedArray(1, 'uint').toAtomic();
  const uWash = uniform(washDepth);
  const R = instancedArray(NN, 'vec4');
  const R2 = instancedArray(NN, 'vec4');
  const P = instancedArray(PARTICLES, 'vec4'); // pos, life
  const V = instancedArray(PARTICLES, 'vec4'); // vel, size
  const counter = instancedArray(1, 'uint').toAtomic();
  // near-shore band (sea cells 5–60 m from land, outside the relaxation zone) → coastal level probe
  const coastIdx = [];
  for (let k = 0; k < NN; k++) if (region.sea[k] && region.dist[k] > 4 && region.dist[k] < 60 && wArr[k * 4] === 0) coastIdx.push(k);
  if (!coastIdx.length) coastIdx.push(0);
  const CI = instancedArray(new Uint32Array(coastIdx), 'uint');
  const coastMax = instancedArray(1, 'uint').toAtomic();
  const coastSum = instancedArray(2, 'uint').toAtomic(); // Σ(η+50)·100, wet count
  // distance (dm) from the chosen point to the nearest flooded land cell = "how far is the water front"
  const frontMin = instancedArray(1, 'uint').toAtomic();
  const uPin = uniform(new THREE.Vector2(-1e6, -1e6)); // pin cell (i, j)

  // fixed dt from the velocity cap (15 m/s) and the deepest water we can expect
  const hCap = maxDepth + 1.6 * H + 2;
  // 2-D CFL: |u|+|v| can reach 15√2 — 0.3 keeps HLL + hydrostatic reconstruction positive
  const dt = (0.3 * dx) / (15 + Math.sqrt(G * hCap));

  // ── uniforms ──
  const uPrm = uniform(new THREE.Vector4(dt, dx, 0, 0));
  const uWave = uniform(new THREE.Vector4(0, 0, region.L > 5000 ? 2.5 : 8, 0)); // η target, (unused), τ relax (s), time
  const uFrame = uniform(new THREE.Vector4(0.1, 0, 0, 0)); // frame dt, time, spray rate, frame id
  const uNest = uniform(new THREE.Vector2(nest?.offset.x ?? 0, nest?.offset.z ?? 0)); // this square's centre in the outer frame
  const uPdt = uniform(0); // real-time step for spray (0 while paused)

  // ── render textures (filterable half floats) ──
  const mkTex = () => {
    const t = new THREE.StorageTexture(N, N);
    t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat;
    t.generateMipmaps = false; t.mipmapsAutoUpdate = false;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const surfTex = mkTex(); // (h, n.x, n.z, turbidity)
  const envTex = mkTex();  // (wetness, max depth, foam, max η − ground)

  // ── kernels ──
  const lib = wgsl(SWE_LIB);
  const cellFn = wgslFn(SWE_CELL, [lib]);

  const ij = () => {
    const k = int(instanceIndex);
    return { k, i: k.mod(N), j: k.div(N) };
  };
  const at = (i, j, di, dj) => clamp(j.add(dj), 0, N - 1).mul(N).add(clamp(i.add(di), 0, N - 1));

  // neighbour state; outside the square the ghost copies the cell but only lets water LEAVE.
  // (A plain zero-gradient copy also lets inflow through, which silently pumps water into the
  //  town from the land edges — seen as a 20 m pile-up in a corner of 名古屋港 before this fix.)
  const nb = (src, qc, i, j, di, dj, inZone) => {
    const ii = i.add(di), jj = j.add(dj);
    const out = ii.lessThan(0).or(ii.greaterThan(N - 1)).or(jj.lessThan(0)).or(jj.greaterThan(N - 1));
    const q = src.element(at(i, j, di, dj));
    // wave-maker zone: outflow-only ghost (reflected waves must leave).
    // elsewhere: a mirror wall = "outside the square floods the same way" (汐見 r2 #3) — a transmissive
    // edge turned the rim of the square into a drain during the long hold.
    let ghost;
    if (di !== 0) ghost = select(inZone, vec4(qc.x, di > 0 ? max(qc.y, 0) : min(qc.y, 0), qc.z, qc.w), vec4(qc.x, qc.y.negate(), qc.z, qc.w));
    else ghost = select(inZone, vec4(qc.x, qc.y, dj > 0 ? max(qc.z, 0) : min(qc.z, 0), qc.w), vec4(qc.x, qc.y, qc.z.negate(), qc.w));
    return select(out, ghost, q);
  };

  const cellUpdate = (src) => {
    const { k, i, j } = ij();
    const e = at(i, j, 1, 0), e2 = at(i, j, 2, 0), w = at(i, j, -1, 0), w2 = at(i, j, -2, 0);
    const s = at(i, j, 0, 1), s2 = at(i, j, 0, 2), n = at(i, j, 0, -1), n2 = at(i, j, 0, -2);
    const qc = src.element(k).toVar();
    const z = W.element(k).x.greaterThan(0);
    return cellFn({
      qc, sc: S.element(k),
      qe: nb(src, qc, i, j, 1, 0, z), se: S.element(e), qe2: nb(src, qc, i, j, 2, 0, z), se2: S.element(e2),
      qw: nb(src, qc, i, j, -1, 0, z), sw: S.element(w), qw2: nb(src, qc, i, j, -2, 0, z), sw2: S.element(w2),
      qs: nb(src, qc, i, j, 0, 1, z), ss: S.element(s), qs2: nb(src, qc, i, j, 0, 2, z), ss2: S.element(s2),
      qn: nb(src, qc, i, j, 0, -1, z), sn: S.element(n), qn2: nb(src, qc, i, j, 0, -2, z), sn2: S.element(n2),
      prm: uPrm,
    });
  };

  const stage1 = Fn(() => {
    const { k } = ij();
    B.element(k).assign(cellUpdate(A));
  })().compute(NN);

  const stage2 = Fn(() => {
    const { k } = ij();
    const q1 = cellUpdate(B);
    const q = A.element(k).add(q1).mul(0.5).toVar();
    // offshore wave-maker (D4, 汐見 round 1): Riemann invariants. The incoming invariant
    // R+ = u_T + 2c_T carries the target long wave shoreward; the outgoing R− = u_n − 2√(gh) is taken
    // from the water itself, so reflected waves leave freely (no pumping, no trapped energy).
    const wz = W.element(k);
    if (nest) {
      // follow the outer solution: bilinear (h, hu, hv, z) of the wide square at this cell's position,
      // re-levelled onto the fine bed (η is shared; depth = η − z_fine). Only where the outer grid is wet.
      const { i, j } = ij();
      const oN = nest.solver.N, odx = nest.solver.dx;
      const ox = float(i).add(0.5).mul(dx).sub(L / 2).add(uNest.x).add(nest.solver.L / 2).div(odx).sub(0.5);
      const oz = float(j).add(0.5).mul(dx).sub(L / 2).add(uNest.y).add(nest.solver.L / 2).div(odx).sub(0.5);
      const fx0 = clamp(floor(ox), 0, oN - 2), fz0 = clamp(floor(oz), 0, oN - 2);
      const tx = clamp(ox.sub(fx0), 0, 1), tz = clamp(oz.sub(fz0), 0, 1);
      const i0 = int(fx0), j0 = int(fz0);
      const OA = nest.solver.buffers.A, OS = nest.solver.buffers.S;
      const id = (a, b) => j0.add(b).mul(oN).add(i0.add(a));
      const bil = (f) => mix(mix(f(id(0, 0)), f(id(1, 0)), tx), mix(f(id(0, 1)), f(id(1, 1)), tx), tz);
      const qo = bil((n) => OA.element(n));
      const zo = bil((n) => OS.element(n).x);
      If(wz.x.greaterThan(0).and(qo.x.greaterThan(0.02)), () => {
        const z = S.element(k).x;
        const hT = max(qo.x.add(zo).sub(z), 0);
        const uo = qo.y.div(max(qo.x, 0.05)), vo = qo.z.div(max(qo.x, 0.05));
        const tgt = vec4(hT, hT.mul(uo), hT.mul(vo), q.w);
        const a = clamp(wz.x.mul(uPrm.x).div(3.0), 0, 1).mul(smoothstep(0.02, 0.15, qo.x));
        q.assign(mix(q, tgt, a));
      });
    } else If(wz.x.greaterThan(0), () => {
      const d = wz.w;
      const hc = max(q.x, 0.01);
      const dir = vec2(wz.y, wz.z), perp = vec2(wz.z.negate(), wz.y);
      const un = q.y.mul(dir.x).add(q.z.mul(dir.y)).div(hc);
      const ut = q.y.mul(perp.x).add(q.z.mul(perp.y)).div(hc);
      const cT = sqrt(float(G).mul(max(d.add(uWave.x), 0.1)));
      const uT = cT.sub(sqrt(float(G).mul(max(d, 0.1)))).mul(2);
      const Rp = uT.add(cT.mul(2));
      const Rm = un.sub(sqrt(float(G).mul(hc)).mul(2));
      const hN = max(Rp.sub(Rm).mul(0.25), 0).pow(2).div(G);
      const unN = Rp.add(Rm).mul(0.5);
      const vel = dir.mul(unN).add(perp.mul(ut.mul(0.8)));
      const tgt = vec4(hN, hN.mul(vel.x), hN.mul(vel.y), q.w);
      const a = clamp(wz.x.mul(uPrm.x).div(uWave.z), 0, 1);
      q.assign(mix(q, tgt, a));
    });
    q.x.assign(max(q.x, 0));
    A.element(k).assign(q);
  })().compute(NN);

  // ── once per frame: foam / turbidity advection, maxima, spray emission, render packing ──
  const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
  const makeAux = (Tin, Tout) => Fn(() => {
    const { k, i, j } = ij();
    const q = A.element(k);
    const s = S.element(k);
    const h = q.x;
    const wet = h.greaterThan(0.005);
    const u = select(wet, q.y.div(max(h, 0.01)), float(0));
    const v = select(wet, q.z.div(max(h, 0.01)), float(0));
    const sp = length(vec2(u, v));
    const dtF = uFrame.x;
    // semi-Lagrangian back-trace (in cells), bilinear
    const bx = clamp(float(i).sub(u.mul(dtF).div(dx)), 0, N - 1.001);
    const by = clamp(float(j).sub(v.mul(dtF).div(dx)), 0, N - 1.001);
    const ix = int(floor(bx)), iy = int(floor(by));
    const fx = bx.sub(floor(bx)), fy = by.sub(floor(by));
    const t00 = Tin.element(iy.mul(N).add(ix)), t10 = Tin.element(iy.mul(N).add(ix.add(1)));
    const t01 = Tin.element(iy.add(1).mul(N).add(ix)), t11 = Tin.element(iy.add(1).mul(N).add(ix.add(1)));
    const adv = mix(mix(t00, t10, fx), mix(t01, t11, fx), fy);
    const told = Tin.element(k);
    const eta = h.add(s.x);

    // foam sources: rising bore front, supercritical flow, impact on walls
    const rise = max(eta.sub(told.w).div(max(dtF, 1e-3)), 0);
    const fr = sp.div(sqrt(float(G).mul(max(h, 0.02))));
    const imp = float(0).toVar();
    const wallE = S.element(at(i, j, 1, 0)).y, wallW = S.element(at(i, j, -1, 0)).y;
    const wallS = S.element(at(i, j, 0, 1)).y, wallN = S.element(at(i, j, 0, -1)).y;
    imp.addAssign(wallE.mul(max(u, 0)).add(wallW.mul(max(u.negate(), 0))).add(wallS.mul(max(v, 0))).add(wallN.mul(max(v.negate(), 0))));
    // the leading edge of water running over dry land churns white (日向: make the flood front visible)
    const dryAt = (id) => A.element(id).x.lessThan(0.005).and(S.element(id).y.lessThan(0.5));
    const edge = select(dryAt(at(i, j, 1, 0)).or(dryAt(at(i, j, -1, 0))).or(dryAt(at(i, j, 0, 1))).or(dryAt(at(i, j, 0, -1))), float(1), float(0));
    const front = edge.mul(select(s.w.greaterThan(0.5), float(1), float(0))).mul(smoothstep(0.2, 1.5, sp));
    const src = clamp(rise.mul(0.35), 0, 1).add(smoothstep(0.9, 2.0, fr).mul(0.6)).add(smoothstep(0.8, 3.5, imp)).add(front.mul(2.5));
    const tau = mix(float(9), float(2.5), smoothstep(0.5, 4.0, sp));
    const foam = clamp(adv.x.mul(exp(dtF.negate().div(tau))).add(src.mul(dtF).mul(1.4)), 0, 1.5);
    // turbidity: coastal sea is slightly murky; flow over land scours soil
    const onLand = s.x.greaterThan(0.3);
    const scour = select(onLand, smoothstep(0.2, 2.5, sp).mul(0.8).add(0.15), float(0));
    const turb = clamp(adv.y.add(scour.mul(dtF).mul(0.5)).mul(exp(dtF.negate().div(900))), 0, 1);
    const wetness = select(wet, float(1), max(told.z.sub(dtF.div(900)), 0));
    Tout.element(k).assign(vec4(select(wet, foam, float(0)), select(wet, turb, told.y.mul(0.999)), wetness, eta));

    // maxima & arrival (land cells that started dry)
    const m = M.element(k);
    const mm = vec4(
      max(m.x, select(wet, h, float(0))),
      select(wet.and(m.y.greaterThan(1e8)), uFrame.y, m.y),
      max(m.z, select(wet, sp, float(0))),
      max(m.w, select(wet, eta, float(-1e3))),
    );
    M.element(k).assign(mm);

    // spray: violent impacts and breaking fronts throw droplets
    const energy = smoothstep(2.0, 6.0, imp).add(smoothstep(1.4, 2.6, fr).mul(smoothstep(0.6, 2.0, h)).mul(0.5));
    const r = hash(vec2(float(k).mul(0.0137), uFrame.w.mul(0.731)));
    If(wet.and(r.lessThan(energy.mul(uFrame.z))), () => {
      const slot = atomicAdd(counter.element(0), uint(1)).toVar();
      const id = slot.bitAnd(uint(PARTICLES - 1));
      const r2 = hash(vec2(float(k).mul(0.37), uFrame.w.add(3.1)));
      const r3 = hash(vec2(float(k).mul(0.71), uFrame.w.add(7.7)));
      const px = float(i).add(r2).mul(dx).sub(L / 2);
      const pz = float(j).add(r3).mul(dx).sub(L / 2);
      // reflected + upward kick √(2g·Δ) where Δ grows with impact speed
      const up = sqrt(float(2 * G).mul(clamp(imp.mul(0.35).add(sp.mul(0.15)), 0.3, 6.0))).mul(r2.mul(0.6).add(0.6));
      const rx = u.mul(select(wallE.add(wallW).greaterThan(0.5), float(-0.35), float(0.55)));
      const rz = v.mul(select(wallS.add(wallN).greaterThan(0.5), float(-0.35), float(0.55)));
      P.element(id).assign(vec4(px, eta.add(0.1), pz, r3.mul(1.2).add(0.8)));
      V.element(id).assign(vec4(rx.add(r2.sub(0.5).mul(2)), up, rz.add(r3.sub(0.5).mul(2)), r2.mul(0.25).add(0.12)));
    });
  })().compute(NN);
  const aux01 = makeAux(T0, T1), aux10 = makeAux(T1, T0);

  // render packing: level η, normal, drawn depth; extend the level one cell under walls / onto dry
  // neighbours so the surface meets walls without dipping.
  const makePack = (Tcur) => Fn(() => {
    const { k, i, j } = ij();
    const q = A.element(k);
    const s = S.element(k);
    const etaAt = (id) => A.element(id).x.add(S.element(id).x);
    const wetAt = (id) => A.element(id).x.greaterThan(0.01).and(S.element(id).y.lessThan(0.5));
    const e = at(i, j, 1, 0), w = at(i, j, -1, 0), sN = at(i, j, 0, 1), nN = at(i, j, 0, -1);
    const h = q.x;
    const selfWet = h.greaterThan(0.01).and(s.y.lessThan(0.5));
    // neighbour-average level for dry/wall cells touching water
    const sum = float(0).toVar(), cnt = float(0).toVar();
    for (const id of [e, w, sN, nN]) {
      If(wetAt(id), () => { sum.addAssign(etaAt(id)); cnt.addAssign(1); });
    }
    const etaN = sum.div(max(cnt, 1));
    const drawEta = select(selfWet, h.add(s.x), select(cnt.greaterThan(0), etaN, s.x.sub(0.6)));
    const drawH = select(selfWet, h, select(cnt.greaterThan(0), float(0.02), float(0)));
    // gradient of the drawn level (use own level where a neighbour is dry)
    const lv = (id) => select(wetAt(id), etaAt(id), drawEta);
    const gx = lv(e).sub(lv(w)).div(2 * dx);
    const gz = lv(sN).sub(lv(nN)).div(2 * dx);
    R.element(k).assign(vec4(drawEta, gx.negate(), gz.negate(), drawH));
    const t = Tcur.element(k);
    const u = select(selfWet, q.y.div(max(h, 0.01)), float(0));
    const v = select(selfWet, q.z.div(max(h, 0.01)), float(0));
    R2.element(k).assign(vec4(t.x, t.y, u, v));
    const m = M.element(k);
    textureStore(surfTex, uvec2(uint(i), uint(j)), vec4(drawH, gx.negate(), gz.negate(), t.y)).toWriteOnly();
    textureStore(envTex, uvec2(uint(i), uint(j)), vec4(t.z, m.x, t.x, max(m.w.sub(s.x), 0))).toWriteOnly();
  })().compute(NN);
  const pack0 = makePack(T0), pack1 = makePack(T1);

  // spray particles: ballistic + drag, die when they fall back into the water or hit a wall
  const particleUpdate = Fn(() => {
    const id = instanceIndex;
    const p = P.element(id);
    const v = V.element(id);
    If(p.w.greaterThan(0), () => {
      const dtF = uPdt;
      const vel = v.xyz.toVar();
      vel.y.subAssign(float(G).mul(dtF));
      vel.mulAssign(exp(dtF.mul(-0.35)));
      const np = p.xyz.add(vel.mul(dtF)).toVar();
      const ci = clamp(int(floor(np.x.add(L / 2).div(dx))), 0, N - 1);
      const cj = clamp(int(floor(np.z.add(L / 2).div(dx))), 0, N - 1);
      const cid = cj.mul(N).add(ci);
      const surf = R.element(cid).x;
      const life = p.w.sub(dtF).toVar();
      If(np.y.lessThan(surf).and(vel.y.lessThan(0)), () => { life.assign(0); });
      If(S.element(cid).y.greaterThan(0.5).and(np.y.lessThan(S.element(cid).x.add(3))), () => { life.assign(0); });
      P.element(id).assign(vec4(np, life));
      V.element(id).assign(vec4(vel, v.w));
    });
  })().compute(PARTICLES);

  // max η over the near-shore band (η + 100 m keeps the float positive → uint order = float order)
  const coastReset = Fn(() => { atomicStore(coastSum.element(0), uint(0)); atomicStore(coastSum.element(1), uint(0)); atomicStore(coastMax.element(0), uint(0)); atomicStore(frontMin.element(0), uint(0xffffffff)); })().compute(1);
  const frontProbe = Fn(() => {
    const { k, i, j } = ij();
    If(S.element(k).w.greaterThan(0.5).and(A.element(k).x.greaterThan(0.05)), () => {
      const d = length(vec2(float(i).sub(uPin.x), float(j).sub(uPin.y))).mul(dx * 10);
      atomicMin(frontMin.element(0), uint(d));
    });
  })().compute(NN);
  const coastProbe = Fn(() => {
    const k = int(CI.element(instanceIndex));
    const q = A.element(k);
    If(q.x.greaterThan(0.01), () => {
      const eta = q.x.add(S.element(k).x);
      atomicMax(coastMax.element(0), floatBitsToUint(eta.add(100)));
      atomicAdd(coastSum.element(0), uint(clamp(eta.add(50), 0, 200).mul(100)));
      atomicAdd(coastSum.element(1), uint(1));
    });
  })().compute(coastIdx.length);

  // 越流破堤: a levee cell carrying water over its crest collapses to the ground it stands on
  const breachKernel = Fn(() => {
    const k = int(LI.element(instanceIndex));
    const lv = LV.element(k);
    If(lv.x.greaterThan(0.5).and(lv.w.lessThan(0.5)).and(A.element(k).x.greaterThan(0.05)), () => {
      LV.element(k).assign(vec4(lv.x, lv.y, lv.z, 1));
      S.element(k).assign(vec4(lv.y, S.element(k).y, S.element(k).z, S.element(k).w));
      atomicAdd(breachCount.element(0), uint(1));
    });
  })().compute(Math.max(1, leveeIdx.length));

  // 木造家屋の流失 (same mechanism as the breach above, per building):
  //  1) any cell of the ring around a wooden house carrying ≥ 2 m of water marks the house
  //  2) every wall cell of a marked house opens (wall flag → 0; its ground stays) — water now flows through
  //  3) newly marked houses are counted once (1 → 2) for the HUD / result
  const washDetect = Fn(() => {
    const k = int(RC.element(instanceIndex));
    const b = int(RCB.element(instanceIndex));
    If(A.element(k).x.greaterThanEqual(uWash).and(WF.element(b).equal(uint(0))), () => { WF.element(b).assign(uint(1)); });
  })().compute(Math.max(1, rimCells.length));
  const washApply = Fn(() => {
    const k = int(WC.element(instanceIndex));
    const b = int(WCB.element(instanceIndex));
    const s = S.element(k);
    If(WF.element(b).greaterThan(uint(0)).and(s.y.greaterThan(0.5)), () => {
      S.element(k).assign(vec4(s.x, 0, s.z, 1)); // open land that started dry (flood-front probe)
    });
  })().compute(Math.max(1, woodCells.length));
  const washTally = Fn(() => {
    const b = int(WI.element(instanceIndex));
    If(WF.element(b).equal(uint(1)), () => {
      WF.element(b).assign(uint(2));
      atomicAdd(washCount.element(0), uint(1));
    });
  })().compute(Math.max(1, woodIds.length));

  // ── host side ──
  let parity = 0;
  let time = 0;
  let frameNo = 0;
  // The official "津波高" is the height AT THE COAST. Shoaling and reflection roughly double an incoming
  // long wave there, so the offshore amplitude is scaled by `gain`, which a slow controller adjusts
  // until the near-shore level follows H (汐見: calibrate the coastal level to the input).
  // 600 s ramps: the harbour's own period (~4L/√(gh) ≈ 600 s) must not be struck by a sharp ramp (汐見 r2 #2)
  const wave = { H, rise: 600, hold: 900, fall: 600, trough: 0.4, pre: 8, gain: opts.gain ?? 0.5, calibrate: opts.calibrate ?? true };
  // η(t) = tide + gain·(H − tide)·shape(t): the official 津波高 H is measured from T.P. and already
  // includes the high tide, so only (H − tide) is the wave
  wave.tide = tide;
  const shape = (t) => etaTargetRaw(t);
  function etaTarget(t) { return wave.tide + wave.gain * (wave.H - wave.tide) * etaTargetRaw(t); }
  function etaTargetRaw(t) {
    const { rise, hold, fall, trough, pre } = wave;
    const h = 1;
    const s = (x) => x * x * (3 - 2 * x);
    const tt = t - pre;
    if (tt <= 0) return 0;
    if (tt < rise) return h * s(tt / rise);
    if (tt < rise + hold) return h;
    if (tt < rise + hold + fall) return h + (-trough * h - h) * s((tt - rise - hold) / fall);
    const back = tt - rise - hold - fall;
    return -trough * h * (1 - s(Math.min(1, back / 240)));
  }

  /** advance by `steps` sub-steps (each = one SSP-RK2 step) */
  function step(steps, sprayRate = 1) {
    if (steps <= 0) return;
    uWave.value.x = etaTarget(time + (steps * dt) / 2);
    const list = [];
    for (let s = 0; s < steps; s++) list.push(stage1, stage2);
    renderer.compute(list);
    time += steps * dt;
    frameNo++;
    uFrame.value.set(steps * dt, time, sprayRate, frameNo % 9973);
    renderer.compute(parity ? aux10 : aux01);
    if (breach && leveeIdx.length) renderer.compute(breachKernel);
    if (wash) renderer.compute([washDetect, washApply, washTally]);
    parity ^= 1;
  }
  // coastal level readback (4 bytes, non-blocking) + controller
  const rbC = new THREE.ReadbackBuffer(4), rbF = new THREE.ReadbackBuffer(4), rbS = new THREE.ReadbackBuffer(8), rbB = new THREE.ReadbackBuffer(4), rbW = new THREE.ReadbackBuffer(4);
  let cBusy = false, cTick = 0;
  const coast = { now: NaN, max: -Infinity, front: Infinity, mean: NaN, meanMax: -Infinity, breached: 0, levees: leveeIdx.length, washed: 0, woodHouses: wash ? woodIds.length : 0 };
  let dead = false;
  function coastUpdate() {
    if (cBusy || ++cTick % 6) return;
    cBusy = true;
    renderer.compute(coastReset);
    renderer.compute(coastProbe);
    renderer.compute(frontProbe);
    Promise.all([
      renderer.getArrayBufferAsync(coastMax.value, rbC, 0, 4),
      renderer.getArrayBufferAsync(frontMin.value, rbF, 0, 4),
      renderer.getArrayBufferAsync(coastSum.value, rbS, 0, 8),
      // the breach counter only exists on the GPU when there are levees (reading it otherwise rejects the whole batch)
      leveeIdx.length ? renderer.getArrayBufferAsync(breachCount.value, rbB, 0, 4) : Promise.resolve(null),
      wash ? renderer.getArrayBufferAsync(washCount.value, rbW, 0, 4) : Promise.resolve(null),
    ]).then(([r, f, sm, bc, wc]) => {
      if (dead) return;
      if (bc) coast.breached = new Uint32Array(bc.buffer ?? bc, bc.byteOffset ?? 0, 1)[0];
      if (wc) coast.washed = new Uint32Array(wc.buffer ?? wc, wc.byteOffset ?? 0, 1)[0];
      const u = new Uint32Array(r.buffer ?? r, r.byteOffset ?? 0, 1)[0];
      const fu = new Uint32Array(f.buffer ?? f, f.byteOffset ?? 0, 1)[0];
      const su = new Uint32Array(sm.buffer ?? sm, sm.byteOffset ?? 0, 2);
      coast.front = fu === 0xffffffff ? Infinity : fu / 10;
      if (!u || !su[1]) return;
      coast.now = new Float32Array(new Uint32Array([u]).buffer)[0] - 100;
      coast.max = Math.max(coast.max, coast.now);
      const mean = su[0] / su[1] / 100 - 50;
      coast.mean = mean; coast.meanMax = Math.max(coast.meanMax, mean);
      const want = wave.tide + (wave.H - wave.tide) * shape(time);
      const lastT = coast.lastT; coast.lastT = time; coast.lastT0 = lastT;
      // steer on the near-shore MEAN level (a single reflected peak at a quay would bias the gain low)
      if (wave.calibrate && shape(time) > 0.35 && time < wave.pre + wave.rise + wave.hold) {
        // midway between the near-shore mean and the quay-side peak (official 津波高 = coastal maximum,
        // but a single reflected spike at one quay should not drive the whole wave)
        const level = mean; // with gentle ramps the quay-side seiche peak is gone → steer on the mean
        const err = (want - wave.tide) / Math.max(level - wave.tide, 0.05) - 1;
        // rate per SIMULATED second, so the controller behaves the same at ×1 and at full speed
        const dts = Math.min(60, Math.max(0, time - (coast.lastT0 ?? time)));
        // while the wave is still rising the coast lags the boundary by its travel time: never push up then
        const rising = time < wave.pre + wave.rise;
        const rate = (err < 0 ? 0.012 : rising ? 0 : 0.004) * dts;
        wave.gain = Math.min(1.3, Math.max(0.25, wave.gain * (1 + Math.min(0.3, rate) * Math.max(-0.6, Math.min(0.6, err)))));
      }
    }).catch(() => {}).finally(() => { rbC.release?.(); rbF.release?.(); rbS.release?.(); if (leveeIdx.length) rbB.release?.(); if (wash) rbW.release?.(); cBusy = false; });
  }

  function pack(pdt = 0) {
    coastUpdate();
    renderer.compute(parity ? pack1 : pack0);
    if (pdt > 0) { uPdt.value = Math.min(pdt, 0.05); renderer.compute(particleUpdate); } // spray lives in real time
  }

  // non-blocking probe of one cell (h, hu, hv) + (max depth, arrival, max speed, max η)
  const rbA = new THREE.ReadbackBuffer(16), rbM = new THREE.ReadbackBuffer(16);
  let busy = false;
  const probe = { k: -1, q: null, m: null };
  function requestProbe(k) {
    if (busy || k < 0) return;
    busy = true;
    Promise.all([
      renderer.getArrayBufferAsync(A.value, rbA, k * 16, 16),
      renderer.getArrayBufferAsync(M.value, rbM, k * 16, 16),
    ]).then(([a, m]) => {
      probe.k = k;
      probe.q = Array.from(new Float32Array(a.buffer ?? a, a.byteOffset ?? 0, 4));
      probe.m = Array.from(new Float32Array(m.buffer ?? m, m.byteOffset ?? 0, 4));
    }).catch(() => {}).finally(() => { rbA.release?.(); rbM.release?.(); busy = false; });
  }

  async function readAll() {
    const buf = await renderer.getArrayBufferAsync(M.value);
    return new Float32Array(buf);
  }
  /** per-building wash state (0 standing, ≥1 washed away); null when the rule is off */
  async function readWashed() {
    if (!wash) return null;
    const buf = await renderer.getArrayBufferAsync(WF.value);
    return new Uint32Array(buf.buffer ?? buf, buf.byteOffset ?? 0, Math.max(1, nB)).slice(0, nB);
  }

  return {
    N, dx, L, dt, wave, etaTarget, step, pack, requestProbe, probe, readAll, readWashed, coast, nested: !!nest,
    washDepth: wash ? washDepth : 0, woodHouses: wash ? woodIds.length : 0,
    /** advance the clock without computing (a nested square that the flood has not reached yet) */
    idle(T) { if (T > time) { time = T; uFrame.value.y = time; } },
    setPin(i, j) { uPin.value.set(i, j); },
    get time() { return time; },
    buffers: { A, S, W, R, R2, M, P, V, LV, LI, WF }, surfTex, envTex, leveeCount: leveeIdx.length, buildingCount: nB,
    /** free the GPU buffers of this town (re-picking a point would otherwise leak ~0.3 GB at 1280²) */
    dispose() {
      dead = true;
      for (const kn of [stage1, stage2, aux01, aux10, pack0, pack1, particleUpdate, coastReset, coastProbe, frontProbe, breachKernel, washDetect, washApply, washTally]) kn.dispose?.();
      for (const b of [S, W, A, B, T0, T1, M, R, R2, P, V, counter, CI, coastMax, coastSum, frontMin, LV, LI, breachCount, WF, WC, WCB, RC, RCB, WI, washCount]) {
        try { renderer._attributes?.delete(b.value); } catch { /* already gone */ }
      }
      surfTex.dispose(); envTex.dispose();
      for (const r of [rbA, rbM, rbC, rbF, rbS, rbB, rbW]) r.dispose?.();
    },
    compileAll: async () => {
      const keep = uPrm.value.x;
      uPrm.value.x = 0; // dt = 0 → compiling the pipelines does not move the water
      renderer.compute([stage1, stage2]);
      uPrm.value.x = keep;
      renderer.compute(aux01); renderer.compute(aux10);
      renderer.compute(pack0); renderer.compute(pack1);
      renderer.compute(particleUpdate);
      if (leveeIdx.length) { const keepB = uWave.value.x; renderer.compute(breachKernel); uWave.value.x = keepB; }
      // nothing is ≥ 2 m deep on land at t = 0 (initially wet cells are not in the ring) → compiling is harmless
      if (wash) renderer.compute([washDetect, washApply, washTally]);
      // the warm-up above advanced nothing physically meaningful except aux; reset clocks
      time = 0; frameNo = 0;
    },
  };
}
