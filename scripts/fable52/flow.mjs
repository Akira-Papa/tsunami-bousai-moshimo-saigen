// 水の流れの見え方と「おまかせ」の速さを、ふつうの再生（実時間・自動の描画ループ）で確かめる。
//   node scripts/fable52/flow.mjs <出力フォルダ> <ラベル> [pc|sp]
//   VERIFY_BASE=http://127.0.0.1:5341   FLOW_KEEP=1（知らせが出たら［×Nのまま］を押す）  FLOW_RM=1（「動きを減らす」設定の端末として開く）
// 出すもの：
//   <ラベル>_timeline.json  0.5秒ごとの 計算の時計・選ばれている速さ・実際の速さ・知らせの文・fps
//   <ラベル>_note.jpg       知らせ（ゆっくりにしました）が出た瞬間の画面
//   <ラベル>_seq_1〜6.jpg   水が地点に着くころの、0.3秒おきの6コマ（流れの印の動き）
//   <ラベル>_over_*.jpg など  決めた時刻の静止画
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'docs/fable52/flow');
const LABEL = process.argv[3] || 'flow';
const SP = process.argv[4] === 'sp';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const QUERY = process.env.FLOW_QUERY || (SP ? '&lat=35.0905&lon=136.8844&n=512' : '&lat=35.0905&lon=136.8844&n=768');
const END = Number(process.env.FLOW_END || 1150);
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 900000,
  args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const page = await browser.newPage();
await page.setViewport(SP ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 1 });
if (process.env.FLOW_RM) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 300)); });
await page.goto(`${BASE}/?manual=1${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
await sleep(1500);
await page.evaluate(() => document.getElementById('go').click());
await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
await sleep(2500);
const shot = (name) => page.screenshot({ path: path.join(OUT, `${LABEL}_${name}.jpg`), type: 'jpeg', quality: 84 });
const read = () => page.evaluate(() => {
  const a = window.__t.app, note = document.getElementById('auto-note');
  return {
    t: Math.round(a.lead.time * 10) / 10, speed: a.st.speed, eff: Math.round((a.st.eff ?? 0) * 10) / 10, hl: a.st.hl?.kind ?? null,
    on: document.querySelector('#speeds button.on')?.textContent ?? null,
    note: note && !note.hidden ? note.textContent.trim() : null,
    marks: !!document.getElementById('tg-marks')?.checked, marksVisible: a.world?.marks?.visible ?? null,
    perf: document.getElementById('perf').textContent.trim().slice(0, 48), playing: a.st.playing,
    h: a.solver.probe.q?.[0] ?? null, front: a.solver.coast.front,
  };
});
// FLOW_SPEED=20 … その速さのボタンを押す（おまかせを外す）。FLOW_NOSHOT=1 … 画面を撮らない（fps を比べる時）
const NOSHOT = !!process.env.FLOW_NOSHOT;
if (process.env.FLOW_SPEED) await page.evaluate((sp) => { [...document.querySelectorAll('#speeds button')].find((b) => b.dataset.s === sp)?.click(); }, process.env.FLOW_SPEED);
const first = await read();
if (!NOSHOT) await shot('start');
await page.evaluate(() => { if (!window.__t.app.st.playing) document.getElementById('play').click(); });
const timeline = [first];
let noteShot = false, kept = false, seqDone = false;
const stills = (process.env.FLOW_STILLS || '700,1100').split(',').map(Number);
const t0 = Date.now();
while (Date.now() - t0 < 600000) {
  await sleep(500);
  const r = await read();
  r.wall = Math.round((Date.now() - t0) / 100) / 10;
  timeline.push(r);
  if (r.note && !noteShot) { noteShot = true; if (!NOSHOT) await shot('note'); if (process.env.FLOW_KEEP) { await sleep(600); await page.evaluate(() => document.getElementById('auto-keep').click()); kept = true; } }
  // the water is about to reach the point: six frames 0.3 s apart (do the flow marks read as moving water?)
  if (!seqDone && !NOSHOT && r.front < 60) {
    seqDone = true;
    await page.evaluate(() => window.__t.app.setView('pin', true));
    await sleep(1200);
    for (let i = 1; i <= 6; i++) { await shot(`seq_${i}`); await sleep(300); }
    await page.evaluate(() => window.__t.app.setView('over', true));
  }
  while (!NOSHOT && stills.length && r.t >= stills[0]) {
    const at = stills.shift();
    await page.evaluate(() => { if (window.__t.app.st.playing) document.getElementById('play').click(); });
    await sleep(500);
    for (const v of ['over', 'pin', 'eye']) { await page.evaluate((view) => window.__t.app.setView(view, true), v); await sleep(700); await shot(`${v}_${at}s`); }
    await page.evaluate(() => { window.__t.app.setView('over', true); if (!window.__t.app.st.playing) document.getElementById('play').click(); });
  }
  if (r.t >= END) break;
}
await browser.close();
// summary: how long each speed was on, in simulated seconds and in real seconds
const sum = {};
for (let i = 1; i < timeline.length; i++) {
  const a = timeline[i - 1], b = timeline[i];
  const key = `${b.speed}${b.hl ? '+' + b.hl : ''}`;
  sum[key] ??= { sim: 0, wall: 0 };
  sum[key].sim += b.t - a.t; sum[key].wall += (b.wall ?? 0) - (a.wall ?? 0);
}
const fps = timeline.map((r) => Number(/^(\d+) fps/.exec(r.perf)?.[1])).filter((x) => x > 0);
const notes = [...new Set(timeline.map((r) => r.note).filter(Boolean))];
const out = {
  label: LABEL, base: BASE, query: QUERY, phone: SP, reducedMotion: !!process.env.FLOW_RM, kept,
  marksAtStart: first.marks, notes, bySpeed: sum,
  fps: fps.length ? { min: Math.min(...fps), median: fps.sort((a, b) => a - b)[fps.length >> 1], max: Math.max(...fps), n: fps.length } : null,
  errors, timeline,
};
fs.writeFileSync(path.join(OUT, `${LABEL}_timeline.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, timeline: undefined }, null, 1));
for (const r of timeline.filter((x, i) => i % 8 === 0 || x.note)) console.log(`  wall=${r.wall ?? 0}s t=${r.t} speed=${r.speed} eff=×${r.eff} hl=${r.hl} on="${r.on}" ${r.perf}${r.note ? '  NOTE: ' + r.note : ''}`);
