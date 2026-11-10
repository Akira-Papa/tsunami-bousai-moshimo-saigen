// 遅い端末・裏のタブ（描画が1秒に20回ほどに間引かれる）で、再現の時計がちゃんと進むかの確認。
//   node scripts/fable52/slow.mjs      VERIFY_BASE=http://127.0.0.1:5341   SLOW_FPS=20
// 描画ループを止め、決めた間隔（既定 1秒に20回）で frame() を呼ぶ（＝裏のタブで rAF が間引かれた状態）。
// 速さごとに、実時間 SECONDS 秒の間に再現の時計が何秒進んだかを出す。あわせて、読み込めなかったファイル（404）を出す。
import path from 'node:path';
import { createRequire } from 'node:module';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const FPS = Number(process.env.SLOW_FPS || 20), SECONDS = Number(process.env.SLOW_SECONDS || 20);
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const notFound = [], errors = [];
page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await page.goto(`${BASE}/?manual=1&lat=35.0905&lon=136.8844`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
await sleep(1500);
await page.evaluate(() => document.getElementById('go').click());
await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
await sleep(2500);
const rows = [];
for (const sp of ['auto', '60', '999', '5']) {
  const r = await page.evaluate(async (sp, FPS, SECONDS) => {
    const a = window.__t.app, rd = window.__t.renderer;
    rd.setAnimationLoop(null);
    [...document.querySelectorAll('#speeds button')].find((b) => b.dataset.s === sp)?.click();
    if (!a.st.playing) document.getElementById('play').click();
    const t0 = a.lead.time, w0 = performance.now();
    await new Promise((done) => { const h = setInterval(() => { a.frame(); if (performance.now() - w0 > SECONDS * 1000) { clearInterval(h); done(); } }, 1000 / FPS); });
    return { speed: sp, wall: Math.round((performance.now() - w0) / 100) / 10, sim: Math.round((a.lead.time - t0) * 10) / 10, maxSteps: a.st.maxSteps, perf: document.getElementById('perf').textContent.trim(), now: document.getElementById('now-line').textContent, slow: document.getElementById('slow-note')?.hidden === false ? document.getElementById('slow-note').textContent : null, clock: a.lead.time.toFixed(0) };
  }, sp, FPS, SECONDS);
  r.rate = Math.round((r.sim / r.wall) * 10) / 10;
  rows.push(r);
  console.log(JSON.stringify(r));
}
console.log('404:', [...new Set(notFound)].join(' ') || 'なし', ' errors:', errors.length);
await browser.close();
