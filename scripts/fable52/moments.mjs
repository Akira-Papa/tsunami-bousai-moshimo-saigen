// 見どころの画面画像：水が防潮壁を越える時・地点に着いた時・最大の時（PC幅とスマホ幅）。
//   node scripts/fable52/moments.mjs <出力フォルダ>     VERIFY_BASE=http://127.0.0.1:5341
// 計算の時計を少しずつ進め、出来事（防潮壁が壊れ始めた12秒後／地点の深さが1cmを超えた25秒後／地点の深さが最大から下がり始めた時）で撮る。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const OUT = path.resolve(process.argv[2] || 'docs/fable52/見どころ');
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [dev, vp, n] of [['PC', { width: 1440, height: 900, deviceScaleFactor: 1 }, 768], ['スマホ', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 512]]) {
 let tPeak = null;
 for (const pass of [1, 2]) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto(`${BASE}/?manual=1&lat=35.0905&lon=136.8844&n=${n}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
  await sleep(1500);
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
  await sleep(2500);
  await page.evaluate(() => { document.getElementById('nav-hint').hidden = true; });
  const stepTo = async (cond, max = 4000) => {
    for (let k = 0; k < max; k++) {
      const s = await page.evaluate(async () => { const a = window.__t.app; await window.__t.advance(0.25, 30); await new Promise((r) => setTimeout(r, 30)); const q = a.solver.probe.q; return { t: a.lead.time, h: q ? q[0] : 0, max: a.solver.probe.m ? a.solver.probe.m[0] : 0, breached: a.solver.coast.breached, hold: a.lead.wave.pre + a.lead.wave.rise + a.lead.wave.hold }; });
      if (cond(s)) return s;
    }
    return null;
  };
  const shot = async (name, views) => {
    if (pass === 1) return; // the first pass only looks for the time of the deepest moment
    for (const v of views) {
      await page.evaluate(async (view) => { const a = window.__t.app; a.setView(view, true); for (let i = 0; i < 10; i++) { a.frame(0.016); await new Promise((r) => setTimeout(r, 30)); } }, v);
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, `${dev}_${name}_${v === 'over' ? '地点と海' : 'ここの近く'}.jpg`), type: 'jpeg', quality: 86 });
    }
    await page.evaluate(() => window.__t.app.setView('over', true));
  };
  const a = await stepTo((s) => s.breached > 0);
  await stepTo((s) => s.t >= a.t + 12); await shot('1_防潮壁を越えた時', ['over', 'pin']);
  const b = await stepTo((s) => s.h > 0.01);
  await stepTo((s) => s.t >= b.t + 25);
  // the one-time explanation would be long gone by now in a real run (14 s): close it, as its × does
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await shot('2_地点に着いた時', ['over', 'pin']);
  // the deepest moment at the point: pass 1 runs to the end of the high level and notes when the depth was
  // greatest; pass 2 stops there (the same computation gives the same result every time)
  let c;
  if (pass === 1) {
    let top = 0;
    await stepTo((s) => { if (s.h > top) { top = s.h; tPeak = s.t; } return s.t >= s.hold + 300; });
    await browser.close();
    continue;
  }
  c = await stepTo((s) => s.t >= tPeak - 2);
  await shot('3_最大の時', ['over', 'pin']);
  console.log(dev, JSON.stringify({ 防潮壁: Math.round(a.t), 着いた: Math.round(b.t), 最大の時刻: Math.round(c.t), その時の深さ: Math.round(c.h * 100) / 100, 最大の深さ: Math.round(c.max * 100) / 100 }));
  await browser.close();
 }
}
