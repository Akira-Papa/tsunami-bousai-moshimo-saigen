// 再現の四角の端で、陸に上がった水がどうなるかを、同じ時刻・同じ視点で撮る（直す前のサーバーと直した後のサーバー）。
//   node scripts/fable52/edge-shots.mjs <出力フォルダ>   BEFORE_BASE=http://127.0.0.1:5351  VERIFY_BASE=http://127.0.0.1:5341
// 名古屋港 ガーデンふ頭・深さで色分け・真上に近い引いた視点。あわせて、端から100m以内の陸の水の量と、端の流れの向きを数える。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const OUT = path.resolve(process.argv[2] || 'docs/fable52/edge');
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMES = (process.env.EDGE_TIMES || '1000,1300,1700').split(',').map(Number);
const report = {};
for (const [label, base] of [['before', process.env.BEFORE_BASE || 'http://127.0.0.1:5351'], ['after', process.env.VERIFY_BASE || 'http://127.0.0.1:5341']]) {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${base}/?manual=1&lat=35.0905&lon=136.8844&n=768`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
  await sleep(1500);
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
  await sleep(2500);
  await page.evaluate(() => { const c = document.getElementById('tg-depth'); if (!c.checked) c.click(); document.getElementById('nav-hint').hidden = true; });
  report[label] = [];
  for (const T of TIMES) {
    await page.evaluate(async (T) => { const a = window.__t.app; a.st.speed = 20; while (a.lead.time < T) await window.__t.advance(4); }, T);
    // from above, pulled back until the whole square is in the picture
    await page.evaluate(async () => { const a = window.__t.app; a.setView('over', true); a.rig.zoom(3.2); for (let i = 0; i < 40; i++) { a.frame(0.016); await new Promise((r) => setTimeout(r, 25)); } document.getElementById('toast').hidden = true; });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `${label}_t${T}.png`) });
    // the water on land within 100 m of the edge, and the share of it that flows back INTO the square
    report[label].push(await page.evaluate(async (T) => {
      const a = window.__t.app, s = a.solver, N = s.N, dx = s.dx;
      const A = new Float32Array(await window.__t.renderer.getArrayBufferAsync(s.buffers.A.value));
      const S = new Float32Array(await window.__t.renderer.getArrayBufferAsync(s.buffers.S.value));
      const band = Math.round(100 / dx);
      let vol = 0, inward = 0, cells = 0, deep = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const e = Math.min(i, j, N - 1 - i, N - 1 - j);
        if (e >= band) continue;
        const k = (j * N + i) * 4;
        if (S[k + 3] < 0.5 || A[k] < 0.05) continue; // land that started dry, with water on it now
        cells++; vol += A[k] * dx * dx; deep = Math.max(deep, A[k]);
        // the unit vector pointing out of the square at this cell (towards the nearest edge)
        const ox = e === i ? -1 : e === N - 1 - i ? 1 : 0, oz = ox ? 0 : e === j ? -1 : 1;
        const out = (A[k + 1] * ox + A[k + 2] * oz) / A[k];
        if (out < -0.2) inward += A[k] * dx * dx; // flowing back into the square faster than 0.2 m/s
      }
      const p = s.probe;
      return { t: Math.round(a.lead.time), wetLandCellsNearEdge: cells, volNearEdge_m3: Math.round(vol), maxDepthNearEdge: Math.round(deep * 100) / 100, shareFlowingBackIn: vol ? Math.round((inward / vol) * 1000) / 1000 : 0, pointDepth: p.q ? Math.round(p.q[0] * 100) / 100 : null, pointMax: p.m ? Math.round(p.m[0] * 100) / 100 : null };
    }, T));
  }
  console.log(label, JSON.stringify(report[label]));
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'edge_report.json'), JSON.stringify(report, null, 2));
