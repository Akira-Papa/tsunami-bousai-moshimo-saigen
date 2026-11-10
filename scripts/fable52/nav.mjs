// 3Dの視点の操作と、地図の見やすさの確認（設計「11」10章 C+D の完了条件 1〜4）。
//   node scripts/fable52/nav.mjs <出力フォルダ>      VERIFY_BASE=http://127.0.0.1:5341
// 確かめること：
//   pc     ホイールを200回回しても地点が画面の中／動かし続けても注視点が地点から600m以内・地面より上／
//          視点の切り替え中のドラッグが効く／「地点へ戻る」「北が上」「矢印キー」「＋−」が効く／
//          いちばん引いても黒い画素がない／名前の札が重ならずに出る／回して離したあと、すぐ止まる
//   inland 内陸（二段の計算）で「名古屋駅」の札が出る／広い視点でも黒い画素がない
//   sp     スマホ幅で、3Dの見える面積が60%以上・押す所がすべて44px以上・名前の札が1〜6・地点が隠れていない
//   sp_inland スマホ幅の内陸（視点が5つ）で、操作がはみ出さない・最初の視点で地点が隠れていない
//   sp_small  375×667 での見える面積（記録）・はみ出しなし
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'docs/fable52/nav');
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const ONLY = (process.env.NAV_ONLY || '').split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base: BASE, at: new Date().toISOString(), cases: {} };

async function open(vp, query) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage();
  await page.setViewport(vp);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 300)); });
  await page.goto(`${BASE}/?manual=1${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
  await sleep(1500);
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
  await sleep(3000);
  return { browser, page, errors };
}
// where the chosen point is on screen, where the pivot is, how far the camera is
const state = (page) => page.evaluate(() => {
  const a = window.__t.app, T = window.__t.THREE, c = a.camera, t = a.controls.target;
  const home = new T.Vector3(a.pin.x, a.pin.ground + 2, a.pin.z);
  const v = home.clone().project(c);
  return {
    pinPx: [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)], pinInFront: v.z < 1,
    targetFromPin: Math.round(Math.hypot(t.x - a.pin.x, t.z - a.pin.z) * 10) / 10, targetY: Math.round(t.y * 10) / 10, pinGround: a.pin.ground,
    dist: Math.round(c.position.distanceTo(t) * 10) / 10, camY: Math.round(c.position.y * 10) / 10,
    az: Math.round((a.rig.azimuth() * 180) / Math.PI * 10) / 10, view: a.rig.view, moving: a.rig.moving,
  };
});
// share of (nearly) black pixels in the 3-D picture — the sky must never break up
const black = (page) => page.evaluate(async () => {
  const a = window.__t.app;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = window.__t.renderer.domElement, w = 320, h = Math.round((320 * cv.height) / cv.width);
  const c2 = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c2.getContext('2d');
  a.frame(0); g.drawImage(cv, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 24) n++;
  return Math.round((n / (w * h)) * 10000) / 100;
});
// the chosen point is on screen AND not under a panel (what lies at its pixel is the 3-D view or one of its labels)
const pinFree = (page) => page.evaluate(() => {
  const a = window.__t.app, T = window.__t.THREE;
  const v = new T.Vector3(a.pin.x, a.pin.ground + 2, a.pin.z).project(a.camera);
  const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
  const el = v.z < 1 && x > 0 && y > 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
  return { x: Math.round(x), y: Math.round(y), free: !!el && (el.tagName === 'CANVAS' || !!el.closest('#stage3d')) };
});
const labelsNow = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('#stage3d .lbl.mp')].filter((e) => e.style.display !== 'none' && e.offsetParent !== null);
  const r = els.map((e) => { const b = e.getBoundingClientRect(); return { name: e.textContent, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }; });
  let overlaps = 0;
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].x0 < r[j].x1 && r[i].x1 > r[j].x0 && r[i].y0 < r[j].y1 && r[i].y1 > r[j].y0) overlaps++;
  return { n: r.length, overlaps, names: r.map((x) => x.name) };
});

async function pc() {
  const { browser, page, errors } = await open({ width: 1440, height: 900, deviceScaleFactor: 1 }, '&lat=35.0905&lon=136.8844&n=512');
  const r = { checks: {}, errors };
  const C = [520, 300]; // a free spot of the 3-D view
  r.start = await state(page);
  r.labels = await labelsNow(page);
  await page.screenshot({ path: path.join(OUT, 'pc_start.jpg'), type: 'jpeg', quality: 84 });
  // 1. wheel in 200 times: the point stays on screen
  await page.mouse.move(...C);
  for (let i = 0; i < 200; i++) { await page.mouse.wheel({ deltaY: -120 }); if (i % 20 === 19) await sleep(60); }
  await sleep(700);
  r.wheelIn = await state(page);
  r.checks.wheel200_pinOnScreen = r.wheelIn.pinInFront && r.wheelIn.pinPx[0] > 0 && r.wheelIn.pinPx[0] < 1440 && r.wheelIn.pinPx[1] > 0 && r.wheelIn.pinPx[1] < 900;
  await page.screenshot({ path: path.join(OUT, 'pc_wheel_in.jpg'), type: 'jpeg', quality: 84 });
  // 2. wheel out all the way: no black pixels
  for (let i = 0; i < 200; i++) { await page.mouse.wheel({ deltaY: 120 }); if (i % 20 === 19) await sleep(60); }
  await sleep(900);
  r.wheelOut = await state(page);
  r.blackAtMaxOut = await black(page);
  r.checks.noBlackAtMaxOut = r.blackAtMaxOut < 0.2;
  await page.screenshot({ path: path.join(OUT, 'pc_wheel_out.jpg'), type: 'jpeg', quality: 84 });
  await page.evaluate(() => window.__t.app.setView('over', true));
  await sleep(300);
  // 3. keep moving (right drag) in one direction: the pivot stays within 600 m and above the ground
  let worst = { far: 0, low: Infinity };
  for (const [dx, dy] of [[900, 0], [0, 500], [-900, 0], [0, -500]]) {
    for (let k = 0; k < 8; k++) {
      await page.mouse.move(C[0] - dx / 4, C[1] - dy / 4);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(C[0] + dx / 4, C[1] + dy / 4, { steps: 6 });
      await page.mouse.up({ button: 'right' });
      await sleep(120);
      const s = await state(page);
      worst.far = Math.max(worst.far, s.targetFromPin); worst.low = Math.min(worst.low, s.targetY - s.pinGround);
    }
  }
  r.pan = worst;
  r.afterPan = await state(page);
  r.checks.panWithin600m = worst.far <= 601;
  r.checks.panAboveGround = worst.low >= -1.5 && r.afterPan.camY > 0;
  await page.screenshot({ path: path.join(OUT, 'pc_after_pan.jpg'), type: 'jpeg', quality: 84 });
  // 4. "back to the point" button
  await page.click('#nav-home'); await sleep(1200);
  r.home = await state(page);
  r.checks.homeButton = r.home.targetFromPin < 1;
  // 5. a drag during a view change wins
  await page.evaluate(() => window.__t.app.setView('pin'));
  await sleep(250);
  const mid = await state(page);
  await page.mouse.move(...C); await page.mouse.down(); await page.mouse.move(C[0] + 220, C[1], { steps: 8 }); await page.mouse.up();
  await sleep(150);
  const aft = await state(page);
  r.dragDuringChange = { movingBefore: mid.moving, movingAfter: aft.moving, azBefore: mid.az, azAfter: aft.az };
  r.checks.dragWinsDuringViewChange = mid.moving === true && aft.moving === false && Math.abs(aft.az - mid.az) > 5;
  // 6. after the hand lets go, the view settles quickly (0.4 s later it turns by less than 3° more)
  await page.evaluate(() => window.__t.app.setView('over', true)); await sleep(200);
  const d = (x, y) => { const v = Math.abs(x - y) % 360; return v > 180 ? 360 - v : v; };
  const a0 = (await state(page)).az;
  await page.mouse.move(...C); await page.mouse.down(); await page.mouse.move(C[0] + 400, C[1], { steps: 10 });
  await page.mouse.up(); await sleep(400);
  const a1 = (await state(page)).az;
  await sleep(1500);
  const a2 = (await state(page)).az;
  r.coast = { turned: d(a2, a0), after400ms: d(a2, a1) };
  r.checks.settlesQuickly = r.coast.turned > 30 && r.coast.after400ms < 3;
  // 7. north button, keyboard
  await page.click('#nav-n'); await sleep(900);
  r.north = (await state(page)).az;
  r.checks.northButton = d(r.north, 0) < 2;
  await page.focus('#stage3d canvas');
  const k0 = await state(page);
  await page.keyboard.press('ArrowRight'); await sleep(500);
  const k1 = await state(page);
  await page.keyboard.press('Equal'); await sleep(500);
  const k2 = await state(page);
  await page.keyboard.press('KeyE'); await sleep(600);
  const k3 = await state(page);
  await page.keyboard.press('Digit0'); await sleep(1000);
  const k4 = await state(page);
  r.keys = { arrowMoved: k1.targetFromPin - k0.targetFromPin, zoomed: k1.dist - k2.dist, turned: d(k3.az, k2.az), homeAgain: k4.targetFromPin };
  r.checks.keyboard = r.keys.arrowMoved > 5 && r.keys.zoomed > 5 && r.keys.turned > 5 && r.keys.homeAgain < 1;
  // 8. +/− buttons
  const z0 = (await state(page)).dist; await page.click('#nav-in'); await sleep(600); const z1 = (await state(page)).dist; await page.click('#nav-out'); await sleep(600); const z2 = (await state(page)).dist;
  r.checks.zoomButtons = z1 < z0 - 5 && z2 > z1 + 5;
  // 9. standing view: a drag turns the head, the body stays
  await page.evaluate(() => window.__t.app.setView('eye', true)); await sleep(300);
  const e0 = await page.evaluate(() => window.__t.app.camera.position.toArray());
  await page.mouse.move(...C); await page.mouse.down(); await page.mouse.move(C[0] + 200, C[1], { steps: 6 }); await page.mouse.up(); await sleep(400);
  const e1 = await page.evaluate(() => window.__t.app.camera.position.toArray());
  r.eyeMoved = Math.round(Math.hypot(e1[0] - e0[0], e1[2] - e0[2]) * 100) / 100;
  r.checks.eyeTurnsHead = r.eyeMoved < 1.5;
  await page.screenshot({ path: path.join(OUT, 'pc_eye.jpg'), type: 'jpeg', quality: 84 });
  // 10. labels
  await page.evaluate(() => window.__t.app.setView('over', true)); await sleep(800);
  r.labelsOver = await labelsNow(page);
  r.checks.labelsShownNoOverlap = r.labelsOver.n > 0 && r.labelsOver.n <= 12 && r.labelsOver.overlaps === 0;
  await page.screenshot({ path: path.join(OUT, 'pc_over.jpg'), type: 'jpeg', quality: 84 });
  r.checks.noErrors = errors.length === 0;
  await browser.close();
  return r;
}

async function inland() {
  const { browser, page, errors } = await open({ width: 1440, height: 900, deviceScaleFactor: 1 }, '&lat=35.1709&lon=136.8815&n=512');
  const r = { checks: {}, errors };
  await page.evaluate(() => { document.getElementById('nav-hint').hidden = true; document.getElementById('toast').hidden = true; });
  r.pinInWide = await pinFree(page);
  r.labelsWide = await labelsNow(page);
  r.checks.pinVisibleInFirstView = r.pinInWide.free;
  r.blackWide = await black(page);
  await page.screenshot({ path: path.join(OUT, 'inland_wide.jpg'), type: 'jpeg', quality: 84 });
  for (let i = 0; i < 200; i++) { await page.mouse.move(520, 300); await page.mouse.wheel({ deltaY: 120 }); if (i % 20 === 19) await sleep(60); }
  await sleep(900);
  r.blackAtMaxOut = await black(page);
  await page.screenshot({ path: path.join(OUT, 'inland_max_out.jpg'), type: 'jpeg', quality: 84 });
  await page.evaluate(() => window.__t.app.setView('over', true)); await sleep(900);
  r.labels = await labelsNow(page);
  await page.screenshot({ path: path.join(OUT, 'inland_over.jpg'), type: 'jpeg', quality: 84 });
  r.checks.noBlack = r.blackWide < 0.2 && r.blackAtMaxOut < 0.2;
  r.checks.nagoyaStationLabel = r.labels.names.some((n) => /名古屋/.test(n) && /駅|名古屋$/.test(n));
  r.checks.labelsNoOverlap = r.labels.overlaps === 0;
  r.checks.noErrors = errors.length === 0;
  await browser.close();
  return r;
}

async function sp() {
  const { browser, page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '&lat=35.0905&lon=136.8844&n=512');
  const r = { checks: {}, errors };
  await page.evaluate(() => { document.getElementById('nav-hint').hidden = true; });
  const measure = () => page.evaluate(() => {
    const W = innerWidth, H = innerHeight, step = 4, sim = document.getElementById('sim');
    let free = 0, all = 0;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      all++;
      const el = document.elementFromPoint(x, y);
      if (el && (el.tagName === 'CANVAS' || el.id === 'stage3d' || el.closest('#stage3d') || el === sim)) free++;
    }
    const small = [...sim.querySelectorAll('button, select, input, summary')].filter((e) => e.offsetParent !== null && !e.closest('#result')).map((e) => { const b = (e.closest('label') ?? e).getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 12), w: Math.round(b.width), h: Math.round(b.height) }; }).filter((b) => b.w < 44 || b.h < 44);
    const h = (q) => Math.round(document.querySelector(q)?.getBoundingClientRect().height ?? 0);
    return { free: Math.round((free / all) * 1000) / 10, small, hud: h('#sim .hud'), dock: h('#sim .dock'), labels: [...document.querySelectorAll('#stage3d .lbl.mp')].filter((e) => e.style.display !== 'none').length };
  });
  r.before = await measure();
  await page.screenshot({ path: path.join(OUT, 'sp_start.jpg'), type: 'jpeg', quality: 84 });
  // while it runs (the status line changes, the water arrives)
  let t = 0;
  while (t < 900) t = await page.evaluate(async () => { await window.__t.advance(8, 30); return window.__t.app.lead.time; });
  await sleep(9500); // event lines and the one-time offer are gone
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; window.__t.app.frame(0); });
  r.running = await measure();
  await page.screenshot({ path: path.join(OUT, 'sp_running.jpg'), type: 'jpeg', quality: 84 });
  await page.evaluate(() => document.getElementById('disp-btn').click()); await sleep(300);
  r.withSwitches = await measure();
  await page.screenshot({ path: path.join(OUT, 'sp_switches.jpg'), type: 'jpeg', quality: 84 });
  // names on the phone: at least one, at most six, in the first view or the close one
  await page.evaluate(() => document.getElementById('disp-btn').click()); await sleep(300);
  const lab = [];
  for (const v of ['over', 'pin']) { await page.evaluate((view) => window.__t.app.setView(view, true), v); await sleep(700); lab.push((await labelsNow(page)).n); }
  r.labelsOverPin = lab;
  r.pinFree = await pinFree(page);
  r.checks.labelsAtMost6 = Math.max(...lab) <= 6; // (this pier has few named places: the count is recorded; 1–6 is judged inland)
  r.checks.pinVisible = r.pinFree.free;
  r.checks.free60 = r.before.free >= 60 && r.running.free >= 60;
  r.checks.targets44 = r.before.small.length === 0 && r.running.small.length === 0 && r.withSwitches.small.length === 0;
  r.checks.noErrors = errors.length === 0;
  await browser.close();
  return r;
}

async function spInland() {
  const { browser, page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '&lat=35.1709&lon=136.8815&n=512');
  const r = { checks: {}, errors };
  await page.evaluate(() => { document.getElementById('nav-hint').hidden = true; document.getElementById('toast').hidden = true; });
  r.pinInWide = await pinFree(page);
  r.overflow = await page.evaluate(() => [...document.querySelectorAll('#sim .dock button, #sim .dock select')].filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 8), l: Math.round(b.left), r: Math.round(b.right) }; }).filter((b) => b.l < 0 || b.r > innerWidth));
  r.labels = await labelsNow(page);
  await page.screenshot({ path: path.join(OUT, 'sp_inland_wide.jpg'), type: 'jpeg', quality: 84 });
  r.checks.pinVisibleInFirstView = r.pinInWide.free;
  r.checks.labels1to6 = r.labels.n >= 1 && r.labels.n <= 6;
  r.checks.noOverflow = r.overflow.length === 0;
  r.checks.noErrors = errors.length === 0;
  await browser.close();
  return r;
}
async function spSmall() {
  const { browser, page, errors } = await open({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '&lat=35.0905&lon=136.8844&n=512');
  const r = { checks: {}, errors };
  await page.evaluate(() => { document.getElementById('nav-hint').hidden = true; });
  r.m = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight, step = 4, sim = document.getElementById('sim');
    let free = 0, all = 0;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) { all++; const el = document.elementFromPoint(x, y); if (el && (el.tagName === 'CANVAS' || el.id === 'stage3d' || el.closest('#stage3d') || el === sim)) free++; }
    const over = [...document.querySelectorAll('#sim .dock button, #sim .dock select')].filter((e) => e.offsetParent !== null).filter((e) => { const b = e.getBoundingClientRect(); return b.left < 0 || b.right > W; }).length;
    return { free: Math.round((free / all) * 1000) / 10, overflow: over };
  });
  r.pinFree = await pinFree(page);
  await page.screenshot({ path: path.join(OUT, 'sp_small_start.jpg'), type: 'jpeg', quality: 84 });
  r.checks.noOverflow = r.m.overflow === 0;
  r.checks.pinVisible = r.pinFree.free;
  r.checks.noErrors = errors.length === 0;
  await browser.close();
  return r; // (the 60 % criterion is for 390×844; here the share is recorded, not judged)
}

for (const [name, fn] of [['pc', pc], ['inland', inland], ['sp', sp], ['sp_inland', spInland], ['sp_small', spSmall]]) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  let r;
  try { r = await fn(); } catch (e) { r = { checks: { ran: false }, errors: ['script: ' + e.message.slice(0, 300)] }; }
  report.cases[name] = r;
  const bad = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`${name}: ${bad.length ? '不合格 ' + bad.join(', ') : '合格'}  errors=${r.errors.length}`);
  console.log('  ' + JSON.stringify({ ...r, errors: undefined, checks: undefined }).slice(0, 1500));
  for (const e of r.errors.slice(0, 4)) console.log('  ' + e);
}
fs.writeFileSync(path.join(OUT, 'nav_report.json'), JSON.stringify(report, null, 1));
