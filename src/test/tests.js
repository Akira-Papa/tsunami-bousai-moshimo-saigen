// Solver verification (汐見 D1 / 検証): run with /test.html — results in window.__results
import * as THREE from 'three/webgpu';
import { createSolver } from '../sim/swe.js';

function makeRegion(N, L, fill) {
  const dx = L / N, NN = N * N;
  const r = {
    N, L, dx, bed: new Float32Array(NN), eta0: new Float32Array(NN), sea: new Uint8Array(NN), water: new Uint8Array(NN),
    dist: new Float32Array(NN).fill(1000), bldH: new Float32Array(NN), bldId: new Int32Array(NN).fill(-1), buildings: [{ kind: 'solid' }],
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -L / 2 + (i + 0.5) * dx, z = -L / 2 + (j + 0.5) * dx;
    fill(r, j * N + i, x, z, i, j);
  }
  return r;
}

async function run(renderer, solver, seconds, perCall = 100) {
  const dev = renderer.backend.device;
  while (solver.time < seconds) { solver.step(Math.min(perCall, Math.ceil((seconds - solver.time) / solver.dt)), 0); solver.pack(); await dev.queue.onSubmittedWorkDone(); }
  const buf = await renderer.getArrayBufferAsync(solver.buffers.A.value);
  return new Float32Array(buf);
}

export async function runTests() {
  const renderer = new THREE.WebGPURenderer();
  await renderer.init();
  const res = {};

  // T1 lake at rest over bumps, a pit, walls and a dry island (well-balancedness)
  {
    const r = makeRegion(128, 256, (r, k, x, z, i, j) => {
      const b = -3 + 2.2 * Math.sin(x / 9) * Math.cos(z / 13) + (Math.hypot(x - 40, z) < 20 ? 5 : 0);
      r.bed[k] = b; r.eta0[k] = Math.max(0, b);
      r.water[k] = b < 0 ? 1 : 0; r.sea[k] = r.water[k]; r.dist[k] = 0; // no relaxation zone
      if (Math.abs(x + 50) < 6 && Math.abs(z) < 30) { r.bldH[k] = 10; r.bldId[k] = 0; }
    });
    const s = createSolver(renderer, r, { H: 0 });
    s.wave.H = 0;
    const q = await run(renderer, s, 60);
    let umax = 0, mass = 0;
    for (let k = 0; k < 128 * 128; k++) { if (q[k * 4] > 1e-3) umax = Math.max(umax, Math.hypot(q[k * 4 + 1], q[k * 4 + 2]) / q[k * 4]); mass += q[k * 4]; }
    let mass0 = 0; for (let k = 0; k < 128 * 128; k++) mass0 += r.bldH[k] > 0 ? 0 : Math.max(0, r.eta0[k] - r.bed[k]);
    res.T1_lakeAtRest = { umax, massErr: (mass - mass0) / mass0, pass: umax < 1e-3 && Math.abs(mass - mass0) / mass0 < 1e-5 };
  }

  // T2 dam break on a dry bed (Ritter): front speed 2√(g h0)
  {
    const h0 = 2;
    const r = makeRegion(512, 512, (r, k, x) => { r.bed[k] = 0; r.eta0[k] = x < 0 ? h0 : 0; });
    const s = createSolver(renderer, r, { H: 0, manning: 0 });
    s.wave.H = 0;
    const T = 8;
    const q = await run(renderer, s, T);
    const N = 512, j = 256;
    let front = -1e9;
    for (let i = 0; i < N; i++) if (q[(j * N + i) * 4] > 0.01) front = -256 + (i + 0.5) * 1;
    // Ritter: h = (2c0 − x/t)² / 9g → the 1 cm contour sits at x = t·(2c0 − 3√(g·0.01))
    const exact = (2 * Math.sqrt(9.81 * h0) - 3 * Math.sqrt(9.81 * 0.01)) * s.time;
    // Ritter depth at x=0 is 4/9 h0
    const h0mid = q[(j * N + 256) * 4];
    res.T2_damBreak = { front, exact, relErr: (front - exact) / exact, hMid: h0mid, hMidExact: (4 / 9) * h0, pass: Math.abs(front - exact) / exact < 0.15 && Math.abs(h0mid - (4 / 9) * h0) < 0.06 };
  }

  // T3 basin filling: level raised to H in the relaxation zone; land ramp must not end far above H
  {
    const H = 3;
    const N = 256, L = 1024;
    const r = makeRegion(N, L, (r, k, x) => {
      // sea on the west (x < 0, depth 8 m), then a 1:60 beach rising to +12 m
      const b = x < 0 ? -8 + Math.min(8, Math.max(0, x + 480) / 60) * 0 : x / 40;
      r.bed[k] = x < 0 ? -8 : b; r.eta0[k] = Math.max(0, r.bed[k]);
      r.water[k] = x < 0 ? 1 : 0; r.sea[k] = r.water[k]; r.dist[k] = x < 0 ? -x : 0;
    });
    const s = createSolver(renderer, r, { H, gain: 0.6, calibrate: true });
    s.wave.H = H; s.wave.hold = 400; s.wave.rise = 180;
    const q = await run(renderer, s, 8 + 180 + 380, 30); // small batches so the controller sees the coast
    const m = new Float32Array(await renderer.getArrayBufferAsync(s.buffers.M.value));
    // current shoreline level and the max η reached on land
    let etaNow = 0, cnt = 0, maxEtaLand = -1e9;
    for (let j = 100; j < 156; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = -L / 2 + (i + 0.5) * (L / N);
      if (x > 0 && q[k * 4] > 0.05) maxEtaLand = Math.max(maxEtaLand, q[k * 4] + r.bed[k]);
      if (x > -60 && x < -20) { etaNow += q[k * 4] + r.bed[k]; cnt++; }
    }
    let maxEver = -1e9; for (let k = 0; k < N * N; k++) { const x = -L / 2 + ((k % N) + 0.5) * (L / N); if (x > 0) maxEver = Math.max(maxEver, m[k * 4 + 3]); }
    res.T3_basinFill = { H, etaNearShoreNow: etaNow / cnt, maxEtaLandNow: maxEtaLand, maxEtaLandEver: maxEver, gain: s.wave.gain, pass: Math.abs(etaNow / cnt - H) < 0.25 * H && maxEver < 1.6 * H };
  }
  return res;
}
