// 水の描画の重さを、垂直同期（60fps の上限）に左右されない形で測る：
// 同じ状態で止めたまま N コマ描き、GPU の処理が終わるまでの時間 ÷ N ＝ 1コマの描画時間（ms）。
//   node scripts/fable52/water-bench.mjs <ベースURL> [<ベースURL> ...]
import path from 'node:path';
import { createRequire } from 'node:module';
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASES = [
  ['kochi_pc', { width: 1440, height: 900, deviceScaleFactor: 1 }, '&lat=33.5061&lon=133.5693&n=768', 800, ['over', 'eye', 'impact']],
  ['nagoya_pc', { width: 1440, height: 900, deviceScaleFactor: 1 }, '&lat=35.0905&lon=136.8844&n=768', 1100, ['over', 'pin', 'eye']],
  ['nagoya_sp', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '&lat=35.0905&lon=136.8844&n=512', 1100, ['over', 'eye']],
];
for (const [name, vp, query, target, views] of CASES) {
  const out = {};
  for (const base of process.argv.slice(2)) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    const page = await browser.newPage();
    await page.setViewport(vp);
    await page.goto(`${base}/?manual=1${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
    await sleep(1200);
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
    await sleep(2000);
    let t = 0;
    while (t < target) t = await page.evaluate(async (frames) => {
      const a = window.__t.app, rd = window.__t.renderer;
      rd.setAnimationLoop(null);
      a.st.speed = 20; a.st.maxSteps = 28; a.st.playing = true;
      for (let i = 0; i < frames; i++) a.frame(1 / 30);
      a.st.playing = false;
      await rd.backend.device.queue.onSubmittedWorkDone();
      await new Promise((r) => setTimeout(r, 4));
      return a.lead.time;
    }, 8);
    const res = {};
    for (const v of views) {
      res[v] = await page.evaluate(async (view) => {
        const a = window.__t.app, rd = window.__t.renderer;
        a.setView(view, true);
        for (let i = 0; i < 10; i++) a.frame(0);                       // warm up
        await rd.backend.device.queue.onSubmittedWorkDone();
        const N = 90, t0 = performance.now();
        for (let i = 0; i < N; i++) a.frame(0);
        await rd.backend.device.queue.onSubmittedWorkDone();
        return Math.round(((performance.now() - t0) / N) * 100) / 100;
      }, v);
    }
    out[base.includes('5351') ? '変更前' : '変更後'] = res;
    await browser.close();
  }
  console.log(name, JSON.stringify(out));
}
