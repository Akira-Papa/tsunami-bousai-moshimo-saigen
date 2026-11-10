// 1コマぶんの水の進め方（単独の計算／広い計算＋細かい計算の二段）。
// 画面（main.js の frame()）と試験（test/tests.js の T6）が、同じこの関数を使う。
// 設計：docs/fable52/11_水の流れ・計算・画面・3D地図の設計.md（B1）
//
// 結果は「どう分けて呼ぶか」（再生の速さ・fps・1コマの量）に依らない：
//  ・どの計算も、決まった sub-step 番号でだけ 沖の波・最大の記録・破堤・制御 を行う（sim/swe.js の step()）
//  ・二段では、広い計算が自分の1歩ぶんだけ先に進み、細かい計算がそこまで追いつく。追いついた時だけ、広い計算が次の1歩を進む
//  ・細かい計算を起こす判定は、広い計算の「制御の読み戻しが効く時点」（決まった番号）の値だけで行い、広い計算はその番号でいったん止まる

/**
 * @param solver  the detailed square (the only one when `outer` is null)
 * @param outer   the wide square of a nested pair, or null
 * @param st      { acc: simulated seconds still owed, maxSteps: sub-steps of the detailed square per frame,
 *                  innerActive: the detailed square of a pair has woken up }  — carried between frames
 * @param owed    simulated seconds to add in this frame (playback speed × real seconds)
 * @param o       { spray: 0–1 spray rate of the detailed square, wake: m — the detailed square of a pair wakes
 *                  when the flood front is closer than this to the chosen point }
 * @returns simulated seconds the detailed square's clock advanced
 */
export function advanceWater(solver, outer, st, owed, { spray = 1, wake = Infinity } = {}) {
  const t0 = solver.time;
  if (!outer) {
    st.acc = Math.min(st.acc + owed, st.maxSteps * solver.dt * 1.5);
    const want = Math.min(Math.floor(st.acc / solver.dt), st.maxSteps);
    const done = want > 0 ? solver.step(want, spray) : 0;
    st.acc -= done * solver.dt;
    return solver.time - t0;
  }
  // the fine square sleeps until the flood is near it. Decided from the wide square's CONTROL readback, which
  // takes effect at a fixed sub-step number; the wide square stops at exactly that sub-step (stopWhenFrontWithin),
  // so the moment the fine square wakes does not depend on the frame rate either.
  const wakeNow = () => { if (!st.innerActive && outer.coast.ctrlFront < wake) { st.innerActive = true; st.wokeAt = outer.time; solver.idle(outer.time); } };
  wakeNow();
  if (!st.innerActive) {
    outer.stopWhenFrontWithin(wake);
    // only the wide square runs: its own (larger) time step sets how far one frame may go
    const cap = st.maxSteps * 6;
    st.acc = Math.min(st.acc + owed, cap * outer.dt * 1.5);
    const want = Math.min(Math.floor(st.acc / outer.dt), cap);
    const done = want > 0 ? outer.step(want, 0) : 0;
    st.acc -= done * outer.dt;
    solver.idle(outer.time);
    wakeNow();
    return Math.max(0, solver.time - t0);
  }
  // the wide square leads by one of its own sub-steps and the fine one follows it; the wide one steps
  // again only when the fine one has caught up → the pairing of the two is always the same
  st.acc = Math.min(st.acc + owed, st.maxSteps * solver.dt * 1.5 + outer.dt);
  let left = Math.min(Math.floor(st.acc / solver.dt), st.maxSteps);
  for (let guard = 0; left > 0 && guard < 400; guard++) {
    const gap = Math.round((outer.time - solver.time) / solver.dt);
    if (gap <= 0) { if (!outer.step(1, 0)) break; continue; }
    const done = solver.step(Math.min(left, gap), spray);
    if (!done) break;
    left -= done; st.acc -= done * solver.dt;
  }
  return Math.max(0, solver.time - t0);
}
