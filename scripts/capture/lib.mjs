// 撮影パイプラインの共通部品（src/ は変更しない。dev サーバーの window.__t フックだけを使う）
//  - ヘッドレス Chrome（WebGPU）で実際の画面を開き、app.frame(1/30) を1コマずつ回して page.screenshot で連番を保存
//  - 地点選択のような実時間の画面は、ページの時計を遅くして撮り（recordSlow）、30fps に並べ直す
//  - ffmpeg で 30fps の mp4 にする
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = process.env.CAPTURE_OUT || path.join(ROOT, 'docs/award/video/footage');
export const WORK_DIR = process.env.CAPTURE_WORK || path.join(process.env.TMPDIR || '/tmp', 'tsunami-capture-frames');
export const BASE = process.env.CAPTURE_BASE || 'http://127.0.0.1:5361';
export const FPS = 30;
export const W = 1920, H = 1080;

// puppeteer-core はリポジトリの依存に入れない（撮影専用）。PUPPETEER_CORE_DIR に npm install した場所を渡す
function loadPuppeteer() {
  const dirs = [process.env.PUPPETEER_CORE_DIR, ROOT, process.cwd()].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(path.join(d, 'package.json'))('puppeteer-core'); } catch { /* next */ }
  }
  throw new Error('puppeteer-core が見つかりません。`npm i --prefix <dir> puppeteer-core` して PUPPETEER_CORE_DIR=<dir> を指定してください');
}

export class Retake extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

export async function launch() {
  const puppeteer = loadPuppeteer();
  return puppeteer.launch({
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    protocolTimeout: 600000,
  });
}

/**
 * ページを開く。hmr='block' のときは Vite の HMR ソケットを無効にし、読み込んだ時点のコードのまま撮る
 * （A2 が src を編集してもリロードされない）。hmr='retake' のときはリロードを検知して Retake を投げる。
 */
export async function openPage(browser, url, { hmr = 'retake', log = console.log, slowClock = false } = {}) {
  const page = await browser.newPage();
  if (slowClock) await installSlowClock(page);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`  [console.error] ${m.text().slice(0, 200)}`); });
  if (hmr === 'block') {
    await page.evaluateOnNewDocument(() => {
      const Real = window.WebSocket;
      window.WebSocket = function (u, p) {
        if (String(p).includes('vite-hmr') || /[?&]token=/.test(String(u))) {
          const t = new EventTarget();
          Object.assign(t, { readyState: 0, send() {}, close() {}, url: String(u), protocol: 'vite-hmr' });
          return t;
        }
        return new Real(u, p);
      };
      Object.assign(window.WebSocket, Real);
    });
  }
  let navs = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { navs++; log(`  [navigated] ${f.url().slice(0, 120)}`); } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const token = Math.random().toString(36).slice(2);
  await page.evaluate((t) => { window.__capToken = t; }, token);
  const baseNavs = navs;
  page.__guard = async () => {
    let ok = false;
    try { ok = await page.evaluate((t) => window.__capToken === t, token); } catch { ok = false; }
    if (!ok || navs !== baseNavs) throw new Retake('ページが再読み込みされました（ホットリロード）');
  };
  return page;
}

/** app（1つの街）ができるまで待ち、自動ループを止める */
export async function waitApp(page, timeoutMs = 240000) {
  const t0 = Date.now();
  for (;;) {
    await page.__guard();
    const s = await page.evaluate(() => {
      const a = window.__t?.app;
      const msg = document.getElementById('load-msg')?.textContent ?? '';
      return { ready: !!a && document.getElementById('sim')?.classList.contains('active'), msg };
    });
    if (s.ready) break;
    if (/失敗/.test(s.msg)) throw new Retake(`読み込み失敗: ${s.msg}`);
    if (Date.now() - t0 > timeoutMs) throw new Retake('読み込みがタイムアウトしました');
    await sleep(1000);
  }
  await page.evaluate(() => { window.__t.renderer.setAnimationLoop(null); });
  await sleep(300);
}

/** 画面上の通知・UI の出し入れ（src は触らず、DOM の表示だけを切り替える） */
export async function setUi(page, { hideToast = true, clean = false, hidePerf = true } = {}) {
  await page.evaluate(({ hideToast, clean, hidePerf }) => {
    let st = document.getElementById('__cap_style');
    if (!st) { st = document.createElement('style'); st.id = '__cap_style'; document.head.appendChild(st); }
    st.textContent = [
      hideToast ? '#toast{display:none !important}' : '',
      hidePerf ? '#perf{visibility:hidden !important}' : '',
      clean ? '.hud,.dock,.topbar{display:none !important}' : '',
    ].join('\n');
  }, { hideToast, clean, hidePerf });
}

/** 再生状態にする（▶ボタンを押して UI 表示も合わせる） */
export async function ensurePlaying(page) {
  await page.evaluate(() => { if (!window.__t.app.st.playing) document.getElementById('play').click(); });
}

/** シミュレーション時間（押し波開始から、秒）と各種状態 */
export async function simState(page) {
  return page.evaluate(() => {
    const a = window.__t.app;
    const lead = a.lead, s = a.world ? null : null;
    return {
      t: lead.time - lead.wave.pre, speed: a.st.speed, maxSteps: a.st.maxSteps,
      front: Math.min(a.solver?.coast?.front ?? Infinity, a.outerSolver ? a.outerSolver.coast.front : Infinity),
      breached: (a.solver?.coast?.breached ?? 0) + (a.outerSolver?.coast?.breached ?? 0),
      clock: document.getElementById('clock').textContent, hNow: document.getElementById('h-now').textContent,
    };
  });
}

/**
 * 画面を撮らずに、押し波開始からの時刻 tTarget（秒）まで進める。
 * 1コマあたりのシミュレーション秒数を大きくして高速に進める。
 */
export async function fastForward(page, tTarget, { speed = 600, maxSteps = 200, batch = 20, log = console.log } = {}) {
  await ensurePlaying(page);
  const saved = await page.evaluate(({ speed, maxSteps }) => { const st = window.__t.app.st; const s = { speed: st.speed, maxSteps: st.maxSteps }; st.speed = speed; st.maxSteps = maxSteps; return s; }, { speed, maxSteps });
  let last = -1, lastLog = 0;
  let t = await page.evaluate(() => window.__t.app.lead.time - window.__t.app.lead.wave.pre);
  for (;;) {
    await page.__guard();
    const rem = tTarget - t;
    if (rem < 0.5) break;
    // 目標を越えすぎないよう、残り時間に合わせて1コマの早送り量を絞る
    const sp = Math.max(1, Math.min(speed, (rem * 30) / batch));
    t = await page.evaluate(async ({ n, sp }) => {
      const a = window.__t.app;
      a.st.speed = sp;
      for (let i = 0; i < n; i++) a.frame(1 / 30);
      await new Promise((r) => requestAnimationFrame(() => r())); // GPU キューを溜めすぎない
      return a.lead.time - a.lead.wave.pre;
    }, { n: batch, sp });
    if (t === last) {
      // 最後まで進むとアプリが自分で一時停止して結果画面を開く
      if (!(await page.evaluate(() => window.__t.app.st.playing))) break;
      throw new Error('シミュレーションが進みません');
    }
    last = t;
    if (Date.now() - lastLog > 5000) { lastLog = Date.now(); log(`    早送り中 ${(t / 60).toFixed(1)}分 / ${(tTarget / 60).toFixed(1)}分`); }
  }
  await page.evaluate((s) => Object.assign(window.__t.app.st, s), saved);
}

/**
 * 1コマずつ回して撮る。perFrame(i, n) はブラウザ側で評価する関数の文字列化ではなく、
 * Node 側から page.evaluate するコールバック（カメラの位置を毎コマ決める）。
 */
export async function recordSim(page, name, { frames, speed, maxSteps, before, perFrame, play = true, log = console.log }) {
  const dir = path.join(WORK_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (play) await ensurePlaying(page);
  if (speed != null || maxSteps != null) await page.evaluate(({ speed, maxSteps }) => { const st = window.__t.app.st; if (speed != null) st.speed = speed; if (maxSteps != null) st.maxSteps = maxSteps; }, { speed, maxSteps });
  if (speed != null) await showSpeed(page, speed);
  if (before) await before();
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    if (i % 30 === 0) await page.__guard();
    if (perFrame) await perFrame(i, frames);
    await page.evaluate(async () => {
      window.__t.app.frame(1 / 30);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    });
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (i % 60 === 0) { const s = await simState(page); log(`    ${name}: ${i}/${frames} コマ・押し波開始から ${s.clock}・ここの深さ ${s.hNow}m`); }
  }
  await page.__guard();
  log(`    ${name}: 撮影 ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
  return dir;
}

/** 早送りボタンの表示を、撮影で使う実際の倍率に最も近いものへ合わせる（×60 を超える倍率は「最速」） */
export async function showSpeed(page, speed) {
  await page.evaluate((speed) => {
    const bs = [...document.querySelectorAll('#speeds button')];
    let best = bs[0], d = Infinity;
    for (const b of bs) { const v = Number(b.dataset.s); const e = Math.abs(Math.log(v) - Math.log(speed)); if (e < d) { d = e; best = b; } }
    if (speed > 90) best = bs.find((b) => b.dataset.s === '999') ?? best;
    bs.forEach((b) => b.classList.toggle('on', b === best));
  }, speed);
}

/**
 * ページの時計を遅くする仕掛けを、ページのスクリプトより先に入れる（openPage の前に呼ぶ）。
 * performance.now / Date.now / requestAnimationFrame の時刻を window.__capSetScale(s) で s 倍速にできる。
 * 地図（MapLibre）のアニメーションはこの時計で進むので、遅くしておけば1枚0.3秒かかる撮影でも30fps相当で撮れる。
 */
export async function installSlowClock(page) {
  await page.evaluateOnNewDocument(() => {
    const rp = performance.now.bind(performance), rd = Date.now.bind(Date);
    let scale = 1, r0 = rp(), v0 = r0;
    const vnow = () => v0 + (rp() - r0) * scale;
    window.__capSetScale = (s) => { v0 = vnow(); r0 = rp(); scale = s; };
    const d0 = rd() - rp();
    performance.now = vnow;
    Date.now = () => Math.round(d0 + vnow());
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => cb(vnow()));
  });
}

/**
 * installSlowClock を入れたページを、時計を scale 倍に遅くして撮る。step(vt) は各コマの前に呼ばれる（vt はページ時計の秒）。
 * 撮れたコマをページ時計のタイムスタンプで 30fps に並べ直す。
 */
export async function recordSlow(page, name, { duration, step, scale = 0.08, log = console.log }) {
  const dir = path.join(WORK_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const now = () => page.evaluate(() => performance.now());
  await page.evaluate((s) => window.__capSetScale(s), scale);
  const t0 = await now();
  const shots = [];
  let vt = 0, n = 0;
  while (vt < duration) {
    await step(vt);
    const file = path.join(dir, `${String(n++).padStart(5, '0')}.jpg`);
    const a = (await now() - t0) / 1000;
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    vt = (await now() - t0) / 1000;
    shots.push({ file, vt: (a + vt) / 2 });
    if (n % 60 === 0) log(`    ${name}: ページ時計 ${vt.toFixed(1)}秒 / ${duration}秒`);
  }
  await page.evaluate(() => window.__capSetScale(1));
  const out = path.join(dir, 'cfr');
  fs.mkdirSync(out, { recursive: true });
  const total = Math.floor(duration * FPS);
  let k = 0;
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    while (k + 1 < shots.length && shots[k + 1].vt <= t + 1e-6) k++;
    fs.copyFileSync(shots[k].file, path.join(out, `${String(i).padStart(5, '0')}.jpg`));
  }
  log(`    ${name}: ${shots.length}枚を ${total}コマ（30fps）へ`);
  return out;
}

/**
 * 実時間で動く画面（地点選択の地図アニメーションなど）を、Chrome の仮想時間で1コマずつ進めて撮る。
 * ヘッドレスではスクリーンショット1枚に0.2〜0.4秒かかり、実時間の screencast では数fpsしか出ないため。
 * step(vt) は各コマの前に呼ばれ、vt（秒、仮想時間）に応じてマウス操作などを行う。
 */
export async function recordVirtual(page, name, { duration, step, log = console.log }) {
  const dir = path.join(WORK_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  const adv = async (ms) => {
    const done = new Promise((r) => cdp.once('Emulation.virtualTimeBudgetExpired', r));
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms });
    await done;
  };
  const now = () => page.evaluate(() => performance.now());
  const t0 = await now();
  const shots = [];
  let vt = 0, n = 0;
  while (vt < duration) {
    await step(vt);
    // 1/60 秒ずつ2回進める（requestAnimationFrame が飛ばされにくい）
    await adv(1000 / 60); await adv(1000 / 60);
    vt = ((await now()) - t0) / 1000;
    const file = path.join(dir, `${String(n++).padStart(5, '0')}.jpg`);
    // 止めた仮想時間のまま描画が変わらないと、スクリーンショットが返らないことがある。
    // 1.5秒待って返らなければ仮想時間を一瞬だけ流して撮り、撮れた時刻をそのコマの時刻にする
    const shot = page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    const ok = await Promise.race([shot.then(() => true), sleep(1500).then(() => false)]);
    if (!ok) {
      // 1ミリ秒ずつ進めて描画を1枚出させる（自由に流すと仮想時間が一気に進んでしまう）
      let done = false;
      shot.then(() => { done = true; });
      for (let k = 0; k < 200 && !done; k++) { await adv(1); await sleep(50); }
      await shot;
      vt = ((await now()) - t0) / 1000;
    }
    shots.push({ file, vt });
    if (n % 60 === 0) log(`    ${name}: 仮想時間 ${vt.toFixed(1)}秒 / ${duration}秒`);
  }
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance' }).catch(() => {});
  await cdp.detach().catch(() => {});
  // 仮想時間のタイムスタンプで 30fps に並べ直す
  const out = path.join(dir, 'cfr');
  fs.mkdirSync(out, { recursive: true });
  const total = Math.floor(duration * FPS);
  let k = 0;
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    while (k + 1 < shots.length && shots[k + 1].vt <= t + 1e-6) k++;
    fs.copyFileSync(shots[k].file, path.join(out, `${String(i).padStart(5, '0')}.jpg`));
  }
  return out;
}

/** 実時間の画面を CDP screencast で撮る（ヘッドレスでは数fpsしか出ないため、通常は recordVirtual を使う） */
export async function recordRealtime(page, name, act) {
  const dir = path.join(WORK_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const frames = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(dir, `${String(n++).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, ts: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const tStart = Date.now() / 1000;
  await act();
  const tEnd = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  // 固定の 30fps に並べ直す（各時刻の直前のコマを使う）
  const out = path.join(dir, 'cfr');
  fs.mkdirSync(out, { recursive: true });
  frames.sort((a, b) => a.ts - b.ts);
  const t0 = frames.length ? Math.max(tStart, frames[0].ts) : tStart;
  const total = Math.floor((tEnd - t0) * FPS);
  let k = 0;
  for (let i = 0; i < total; i++) {
    const t = t0 + i / FPS;
    while (k + 1 < frames.length && frames[k + 1].ts <= t) k++;
    fs.copyFileSync(frames[k].file, path.join(out, `${String(i).padStart(5, '0')}.jpg`));
  }
  return out;
}

/** 連番 JPEG → 30fps H.264 mp4 */
export function encode(dir, outFile, { fadeIn = 0, fadeOut = 0 } = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const n = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
  const dur = n / FPS;
  const vf = [`scale=${W}:${H}:flags=lanczos`, 'format=yuv420p'];
  if (fadeIn) vf.push(`fade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut) vf.push(`fade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'),
    '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS), '-movflags', '+faststart', outFile], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg 失敗: ${outFile}`);
  return { file: outFile, frames: n, seconds: dur };
}

/** カメラ：views[name] の位置と注視点を取り出す（瞬時に切り替えて読むだけ） */
export async function viewPose(page, name) {
  return page.evaluate((name) => {
    const a = window.__t.app;
    a.setView(name, true);
    return { pos: a.camera.position.toArray(), target: a.controls.target.toArray() };
  }, name);
}

/** カメラを置く（OrbitControls の注視点も合わせる） */
export async function setPose(page, pos, target) {
  await page.evaluate(({ pos, target }) => {
    const a = window.__t.app;
    a.camera.position.fromArray(pos);
    a.controls.target.fromArray(target);
    a.controls.update();
  }, { pos, target });
}

// ── カメラの動き（Node 側で計算） ──
export const ease = (x) => x * x * (3 - 2 * x);
export const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
/** 注視点のまわりを方位角 dAz（ラジアン）だけ回り、距離を k0→k1 倍にする */
export function orbitPose(base, t, { dAz = 0, k0 = 1, k1 = 1, dy0 = 0, dy1 = 0 } = {}) {
  const [px, py, pz] = base.pos, [tx, ty, tz] = base.target;
  const vx = px - tx, vy = py - ty, vz = pz - tz;
  const a = dAz * t, k = k0 + (k1 - k0) * t;
  const c = Math.cos(a), s = Math.sin(a);
  const rx = vx * c - vz * s, rz = vx * s + vz * c;
  return { pos: [tx + rx * k, ty + vy * k + dy0 + (dy1 - dy0) * t, tz + rz * k], target: [tx, ty, tz] };
}
