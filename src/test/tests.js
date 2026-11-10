// Solver verification (汐見 D1 / 検証): run with /test.html — results in window.__results
import * as THREE from 'three/webgpu';
import { createSolver } from '../sim/swe.js';
import { advanceWater } from '../sim/advance.js';

/** FNV-1a over the raw bytes of a GPU buffer: two runs agree bit for bit ⇔ the hashes agree */
async function hashOf(renderer, attr) {
  const buf = await renderer.getArrayBufferAsync(attr.value);
  const u = new Uint8Array(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const tick = () => new Promise((r) => setTimeout(r, 0)); // lets a control readback arrive

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
    res.T1_lakeAtRest = { umax, massErr: (mass - mass0) / mass0, pass: umax < 1e-3 && Math.abs(mass - mass0) / mass0 < 1e-6 };
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
    // Ritter: h = (2c0 − x/t)² / 9g → the contour of depth hc sits at x = t·(2c0 − 3√(g·hc)).
    // The front is judged at the 5 cm contour: the 1 cm film lags by ~14 % at this grid, but that is where a
    // 1 cm sheet happens to be detected on a 1 m grid — it shrinks as the grid is refined (−16.5 / −14.1 / −9.7 %
    // at dx = 2 / 1 / 0.5 m), while the 5 cm contour is at −9.5 / −3.1 / +2.1 % (氷室, docs/fable52/会議2の生発言/R1_氷室.md).
    const frontAt = (hc) => { let f = -1e9; for (let i = 0; i < N; i++) if (q[(j * N + i) * 4] > hc) f = -256 + (i + 0.5) * 1; return f; };
    const exactAt = (hc) => (2 * Math.sqrt(9.81 * h0) - 3 * Math.sqrt(9.81 * hc)) * s.time;
    const front = frontAt(0.05), exact = exactAt(0.05);
    // Ritter depth at x=0 is 4/9 h0
    const h0mid = q[(j * N + 256) * 4];
    res.T2_damBreak = {
      front, exact, relErr: (front - exact) / exact, film1cmRelErr: (frontAt(0.01) - exactAt(0.01)) / exactAt(0.01),
      hMid: h0mid, hMidExact: (4 / 9) * h0, pass: Math.abs(front - exact) / exact < 0.10 && Math.abs(h0mid - (4 / 9) * h0) < 0.02,
    };
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

  // T4 water swinging in a parabolic bowl (Thacker 1981, the radially symmetric solution): the shoreline runs
  //    up and down a curved bed — the wet / dry front is the whole problem. It starts from rest and has an
  //    exact solution:  η(r, t) = h0·{ √(1−A²)/(1−A·cos ωt) − 1 − (r²/a²)·[ (1−A²)/(1−A·cos ωt)² − 1 ] }
  //    with bed z = −h0·(1 − r²/a²), ω = √(8·g·h0)/a, A = (a⁴ − r0⁴)/(a⁴ + r0⁴).
  {
    const a = 150, h0 = 3, r0 = 120, g = 9.81;
    const A = (a ** 4 - r0 ** 4) / (a ** 4 + r0 ** 4), om = Math.sqrt(8 * g * h0) / a, T = (2 * Math.PI) / om;
    const bedAt = (x, z) => -h0 * (1 - (x * x + z * z) / (a * a));
    const etaAt = (x, z, t) => { const c = 1 - A * Math.cos(om * t); return h0 * (Math.sqrt(1 - A * A) / c - 1 - ((x * x + z * z) / (a * a)) * ((1 - A * A) / (c * c) - 1)); };
    const N = 256, L = 512;
    const r = makeRegion(N, L, (r, k, x, z) => { r.bed[k] = bedAt(x, z); r.eta0[k] = Math.max(r.bed[k], etaAt(x, z, 0)); });
    const s = createSolver(renderer, r, { H: 0, manning: 0 });
    s.wave.H = 0;
    const errAt = (q, t) => {
      let e2 = 0, n2 = 0, mass = 0, wetCells = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = -L / 2 + (i + 0.5) * (L / N), z = -L / 2 + (j + 0.5) * (L / N);
        const ex = Math.max(0, etaAt(x, z, t) - bedAt(x, z)), h = q[(j * N + i) * 4];
        e2 += (h - ex) ** 2; n2 += ex * ex; mass += h;
        if (h > 0.01) wetCells++;
      }
      // the shoreline itself: radius of the wet disc (from its area, depth > 1 cm) against the exact radius
      // r_s(t) = a·√( (1 − A·cos ωt) / √(1 − A²) ), in grid cells — the depth error alone is dominated by the
      // deep middle and would hide a shoreline that is several cells off (review AB1, 軽微-1)
      const rNum = Math.sqrt((wetCells * (L / N) ** 2) / Math.PI);
      const rEx = a * Math.sqrt((1 - A * Math.cos(om * t)) / Math.sqrt(1 - A * A));
      return { l2: Math.sqrt(e2 / n2), mass, shoreCells: (rNum - rEx) / (L / N) };
    };
    let mass0 = 0; for (let k = 0; k < N * N; k++) mass0 += Math.max(0, r.eta0[k] - r.bed[k]);
    const half = errAt(await run(renderer, s, T / 2), s.time);   // the water is spread widest here
    const full = errAt(await run(renderer, s, T), s.time);       // and back where it started
    const half3 = errAt(await run(renderer, s, 2.5 * T), s.time);
    const full3 = errAt(await run(renderer, s, 3 * T), s.time);  // three swings: errors that build up show here
    res.T4_parabolicBowl = {
      period: T, l2Half: half.l2, l2Full: full.l2, shoreHalfCells: half.shoreCells, shoreFullCells: full.shoreCells,
      l2After3: full3.l2, l2Half3: half3.l2, shoreAfter3Cells: full3.shoreCells, shoreHalf3Cells: half3.shoreCells,
      massErr: (full3.mass - mass0) / mass0,
      pass: half.l2 < 0.03 && full.l2 < 0.03 && Math.abs(half.shoreCells) < 2 && Math.abs(full.shoreCells) < 2
        && full3.l2 < 0.06 && half3.l2 < 0.06 && Math.abs(full3.shoreCells) < 3 && Math.abs(half3.shoreCells) < 3
        && Math.abs(full3.mass - mass0) / mass0 < 1e-6,
    };
    s.dispose();
  }

  // T5 the same wave, advanced in different batch sizes (= different playback speeds / frame rates): the result
  //    must not depend on it — not "nearly", but bit for bit (water A, maxima & arrival M, ground & walls S).
  //    The slope carries a seawall that the wave overtops (it breaks) and a wooden house (it is washed away),
  //    so those two decisions are covered as well. Before the fixed schedule the gain differed by up to 3.5 %.
  {
    const H = 3, N = 256, L = 1024;
    const once = async (perCall) => {
      const r = makeRegion(N, L, (r, k, x, z) => {
        r.bed[k] = x < 0 ? -8 : x / 40; r.eta0[k] = Math.max(0, r.bed[k]);
        r.water[k] = x < 0 ? 1 : 0; r.sea[k] = r.water[k]; r.dist[k] = x < 0 ? -x : 0;
        if (x > 40 && x < 52 && Math.abs(z) < 8) { r.bldH[k] = 6; r.bldId[k] = 1; } // a wooden house, bed ≈ 1.1 m
      });
      r.buildings = [{ kind: 'solid' }, { wood: true }];
      r.leveeZ = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = -L / 2 + (i + 0.5) * (L / N); if (x > 16 && x < 24) r.leveeZ[j * N + i] = 2.0; } // crest 2 m < the 3 m wave
      const s = createSolver(renderer, r, { H, gain: 0.6, calibrate: true, breach: true, washaway: 1.0 });
      s.wave.H = H; s.wave.hold = 400; s.wave.rise = 180;
      const target = Math.round((8 + 180 + 380) / s.dt);
      const dev = renderer.backend.device;
      for (let guard = 0; s.subSteps < target && guard < 200000; guard++) {
        s.step(Math.min(perCall, target - s.subSteps), 0); s.pack();
        await dev.queue.onSubmittedWorkDone(); if (s.waiting) await tick();
      }
      const q = new Float32Array(await renderer.getArrayBufferAsync(s.buffers.A.value));
      const m = new Float32Array(await renderer.getArrayBufferAsync(s.buffers.M.value));
      let eta = 0, cnt = 0, maxDepth = 0;
      for (let j = 100; j < 156; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i, x = -L / 2 + (i + 0.5) * (L / N);
        if (x > -60 && x < -20) { eta += q[k * 4] + r.bed[k]; cnt++; }
        if (x > 0) maxDepth = Math.max(maxDepth, m[k * 4]);
      }
      const washed = await s.readWashed();
      const out = {
        perCall, gain: s.wave.gain, etaNearShore: eta / cnt, maxDepthLand: maxDepth, subSteps: s.subSteps,
        hashA: await hashOf(renderer, s.buffers.A), hashM: await hashOf(renderer, s.buffers.M), hashS: await hashOf(renderer, s.buffers.S),
        levees: s.leveeCount, housesWashed: washed ? Array.from(washed).filter((x) => x >= 1).length : 0, ctrlMissed: s.coast.ctrlMissed,
      };
      s.dispose();
      return out;
    };
    const runs = [];
    for (const pc of [1, 7, 30, 100, 300]) runs.push(await once(pc));
    const spread = (key) => { const v = runs.map((x) => x[key]); return (Math.max(...v) - Math.min(...v)) / Math.abs(v[0]); };
    const same = (key) => runs.every((x) => x[key] === runs[0][key]);
    res.T5_sameResultAtAnySpeed = {
      runs, gainSpread: spread('gain'), levelSpread: spread('etaNearShore'), maxDepthSpread: spread('maxDepthLand'),
      bitIdentical: same('hashA') && same('hashM') && same('hashS') && same('gain'),
      // the seawall must really have broken and the house really have gone, or the test proves less than it says
      exercised: runs[0].levees > 0 && runs[0].housesWashed > 0,
      pass: same('hashA') && same('hashM') && same('hashS') && same('gain') && runs[0].levees > 0 && runs[0].housesWashed > 0 && runs.every((x) => x.ctrlMissed === 0),
    };
  }

  // T6 a nested pair (wide square + fine square that follows it), driven by the SAME function the screen uses
  //    (sim/advance.js), at different playback speeds / frame lengths / per-frame budgets: both squares must end
  //    bit for bit the same — with water inside the fine square (in the app, no surveyed point had the flood
  //    reach the fine square, so this is the only place where the pairing is measured wet).
  {
    const H = 3, bed = (x) => (x < 0 ? -8 : x / 150);
    const once = async (speed, fps, maxSteps) => {
      const NO = 192, LO = 1536, NI = 128, LI = 384, cx = 220;
      const ro = makeRegion(NO, LO, (r, k, x) => {
        r.bed[k] = bed(x); r.eta0[k] = Math.max(0, r.bed[k]);
        r.water[k] = x < 0 ? 1 : 0; r.sea[k] = r.water[k]; r.dist[k] = x < 0 ? -x : 0;
      });
      const ri = makeRegion(NI, LI, (r, k, x) => {
        r.bed[k] = bed(x + cx); r.eta0[k] = Math.max(0, r.bed[k]); r.water[k] = 0; r.sea[k] = 0; r.dist[k] = 0;
      });
      const outer = createSolver(renderer, ro, { H, gain: 0.6, calibrate: true });
      outer.wave.H = H; outer.wave.hold = 500; outer.wave.rise = 180;
      const inner = createSolver(renderer, ri, { H, nest: { solver: outer, offset: { x: cx, z: 0 } }, calibrate: false });
      inner.wave.H = H; inner.wave.hold = 500; inner.wave.rise = 180;
      outer.setPin(Math.floor((cx + LO / 2) / (LO / NO)), NO / 2);
      const st = { acc: 0, maxSteps, innerActive: false };
      const target = Math.round(520 / inner.dt);
      const dev = renderer.backend.device;
      let frames = 0;
      for (; inner.subSteps < target && frames < 400000; frames++) {
        // never ask for more than is left: the last frame lands exactly on the target sub-step
        const owed = Math.min(speed / fps, (target - inner.subSteps + 0.5) * inner.dt - st.acc);
        advanceWater(inner, outer, st, owed, { spray: 0, wake: 260 });
        inner.pack(); outer.pack();
        await dev.queue.onSubmittedWorkDone(); if (outer.waiting) await tick();
      }
      const qi = new Float32Array(await renderer.getArrayBufferAsync(inner.buffers.A.value));
      let wet = 0; for (let k = 0; k < NI * NI; k++) if (qi[k * 4] > 0.05) wet++;
      const out = {
        speed, fps, maxSteps, frames, wokeAt: st.wokeAt ?? null, innerSubSteps: inner.subSteps, outerSubSteps: outer.subSteps, gain: outer.wave.gain,
        innerWetShare: wet / (NI * NI), ctrlMissed: outer.coast.ctrlMissed,
        innerA: await hashOf(renderer, inner.buffers.A), innerM: await hashOf(renderer, inner.buffers.M),
        outerA: await hashOf(renderer, outer.buffers.A), outerM: await hashOf(renderer, outer.buffers.M),
      };
      inner.dispose(); outer.dispose();
      return out;
    };
    const runs = [];
    for (const [sp, fps, ms] of [[20, 30, 48], [60, 60, 28], [5, 24, 6], [999, 20, 48]]) runs.push(await once(sp, fps, ms));
    const same = (key) => runs.every((x) => x[key] === runs[0][key]);
    res.T6_nestedPairSameResult = {
      runs,
      bitIdentical: ['innerA', 'innerM', 'outerA', 'outerM', 'gain', 'wokeAt', 'outerSubSteps'].every(same),
      exercised: runs[0].wokeAt > 0 && runs[0].innerWetShare > 0.05,
      pass: ['innerA', 'innerM', 'outerA', 'outerM', 'gain', 'wokeAt', 'outerSubSteps', 'innerSubSteps'].every(same)
        && runs[0].wokeAt > 0 && runs[0].innerWetShare > 0.05 && runs.every((x) => x.ctrlMissed === 0),
    };
  }
  return res;
}
