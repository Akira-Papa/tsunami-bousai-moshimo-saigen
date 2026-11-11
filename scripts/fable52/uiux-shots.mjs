// UI/UX見直し（docs/fable52/15）の「直す前｜直した後」を撮る。
//   node scripts/fable52/uiux-shots.mjs <出力フォルダ> <ラベル（before / after）>
//   VERIFY_BASE=http://127.0.0.1:5341  PUPPETEER_CORE_DIR=…
// PC幅 1440×900・スマホ幅 390×844、名古屋港 ガーデンふ頭。撮る場面：
//   1 はじめの画面／2 地点を選んだ直後／3 カードの続き／4 3Dのはじめ（道のりAを選んで）／5 水が着いた後／6 「表示」を開く／7 結果
// あわせて、画面に見えている文字の数・押す所の小さいもの・小さい文字の数を数える（uiux_<ラベル>.json）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const OUT = path.resolve(process.argv[2] || 'docs/fable52/uiux/raw');
const LABEL = process.argv[3] || 'after';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { label: LABEL, at: new Date().toISOString(), runs: [] };

// what a person sees right now: characters on screen, small tap targets, small text
const measure = (page) => page.evaluate(() => {
  const W = innerWidth, H = innerHeight;
  const vis = (e) => { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W; };
  let chars = 0, small = 0, smallest = 99;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s+/g, '');
    const p = n.parentElement;
    if (!t || !p || p.closest('script,style,.sr-only,[hidden],[aria-hidden="true"],#map canvas,.maplibregl-ctrl,#perf,#print-sheet')) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W)) continue;
    const cs = getComputedStyle(p);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    // only the part of the text that is really on top (not scrolled under another layer)
    const hit = document.elementFromPoint(Math.min(W - 1, Math.max(0, r.left + Math.min(r.width / 2, 6))), Math.min(H - 1, Math.max(0, r.top + r.height / 2)));
    if (hit && !(hit === p || p.contains(hit) || hit.contains(p))) continue;
    chars += t.length;
    const fs = parseFloat(cs.fontSize);
    if (fs < 14) small += t.length;
    if (fs < smallest) smallest = fs;
  }
  const taps = [...document.querySelectorAll('button,a,select,input,summary,label.chk,.toggles label')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), t: (e.innerText || e.id || e.tagName).trim().slice(0, 14) }; });
  return { chars, smallChars: small, smallestFont: smallest, taps: taps.length, tapsUnder44: taps.filter((t) => t.h < 44 || t.w < 44).map((t) => `${t.t}(${t.w}×${t.h})`) };
});
const freeArea = (page) => page.evaluate(() => {
  const W = innerWidth, H = innerHeight, step = 10, sim = document.getElementById('sim');
  let free = 0, all = 0;
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
    all++;
    const el = document.elementFromPoint(x, y);
    if (el && (el.tagName === 'CANVAS' || el.id === 'stage3d' || el.closest('#stage3d') || el === sim)) free++;
  }
  return Math.round((free / all) * 1000) / 10;
});

for (const [dev, vp, n] of [['PC', { width: 1440, height: 900, deviceScaleFactor: 1 }, 768], ['SP', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 512]]) {
  const run = { dev, errors: [], m: {} };
  report.runs.push(run);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage();
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  page.on('pageerror', (e) => run.errors.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) run.errors.push('console: ' + m.text().slice(0, 300)); });
  const shot = async (tag) => { await page.screenshot({ path: path.join(OUT, `${LABEL}_${dev}_${tag}.png`) }); run.m[tag] = await measure(page); };
  try {
    await page.goto(`${BASE}/?manual=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#presets button', { timeout: 30000 });
    await sleep(4000);
    await shot('1pick');
    await page.evaluate(() => { [...document.querySelectorAll('#presets button')].find((b) => b.textContent.includes('ガーデンふ頭')).click(); });
    await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('[data-route="s0"]'), { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    await shot('2card');
    // the rest of the card (one screen further down)
    await page.evaluate(() => { const s = document.getElementById('pick-scroll'); const sc = [s, document.querySelector('.pick-card'), document.scrollingElement].find((e) => e && e.scrollHeight > e.clientHeight + 4) || s; sc.scrollTop += sc.clientHeight * 0.9; });
    await sleep(700);
    await shot('3card_more');
    run.cardChars = await page.evaluate(() => document.getElementById('pick-scroll').innerText.replace(/\s+/g, '').length);
    await page.evaluate(() => document.querySelector('[data-route="s0"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
    await sleep(3000);
    await shot('4sim_start');
    run.freeStart = await freeArea(page);
    // run the same computation forward until the water has reached the point (+60 s)
    const stepTo = async (cond, max = 4000) => { for (let k = 0; k < max; k++) { const s = await page.evaluate(async () => { const a = window.__t.app; await window.__t.advance(0.25, 30); await new Promise((r) => setTimeout(r, 30)); const q = a.solver.probe.q; return { t: a.lead.time, h: q ? q[0] : 0 }; }); if (cond(s)) return s; } return null; };
    const b = await stepTo((s) => s.h > 0.01);
    await stepTo((s) => s.t >= (b?.t ?? 0) + 60);
    await page.evaluate(async () => { const a = window.__t.app; for (let i = 0; i < 10; i++) { a.frame(0.016); await new Promise((r) => setTimeout(r, 30)); } });
    await sleep(600);
    await shot('5sim_arrived');
    run.freeArrived = await freeArea(page);
    await page.evaluate(() => document.getElementById('disp-btn').click());
    await sleep(500);
    await shot('6sim_disp');
    await page.evaluate(() => document.getElementById('disp-btn').click());
    await page.evaluate(() => document.getElementById('result-btn').click());
    await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 60000 });
    await sleep(1200);
    await shot('7result');
    run.resultChars = await page.evaluate(() => document.querySelector('#result .result-card').innerText.replace(/\s+/g, '').length);
  } catch (e) {
    run.errors.push('script: ' + e.message.slice(0, 300));
    await page.screenshot({ path: path.join(OUT, `${LABEL}_${dev}_error.png`) }).catch(() => {});
  }
  console.log(dev, JSON.stringify({ errors: run.errors, cardChars: run.cardChars, resultChars: run.resultChars, freeStart: run.freeStart, freeArrived: run.freeArrived, m: Object.fromEntries(Object.entries(run.m).map(([k, v]) => [k, `${v.chars}字 小${v.smallChars} 最小${v.smallestFont}px 44未満${v.tapsUnder44.length}`])) }));
  await browser.close();
}
fs.writeFileSync(path.join(OUT, `uiux_${LABEL}.json`), JSON.stringify(report, null, 2));
