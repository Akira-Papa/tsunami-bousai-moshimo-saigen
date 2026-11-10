// 再生中の1コマの重さ（計算＋描画）を、垂直同期や他の処理の混み具合に左右されにくい形で測る：
// 決めた時刻まで進めたあと、×20・1/60秒のコマを N 回、1コマごとに GPU の処理が終わるのを待ちながら回す。かかった時間 ÷ N ＝ 1コマの時間（ms）。
// 60fps を保つには 16.7ms 未満が必要。
//   node scripts/fable52/play-bench.mjs <ベースURL> [<ベースURL> ...]     BENCH_MARKS=0 … 流れの印を消して測る
import path from 'node:path';
import { createRequire } from 'node:module';
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASES = [
  ['nagoya_pc', { width: 1440, height: 900, deviceScaleFactor: 1 }, '&lat=35.0905&lon=136.8844&n=768', 1000],
  ['nagoya_sp', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '&lat=35.0905&lon=136.8844&n=512', 1000],
].filter((c) => !process.env.BENCH_ONLY || process.env.BENCH_ONLY.split(',').includes(c[0]));
for (const [name, vp, query, target] of CASES) {
  for (const base of process.argv.slice(2)) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    const page = await browser.newPage();
    await page.setViewport(vp);
    await page.goto(`${base}/?manual=1${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
    await sleep(1200);
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
    await sleep(2000);
    if (process.env.BENCH_MARKS === '0') await page.evaluate(() => { const m = document.getElementById('tg-marks'); if (m?.checked) m.click(); });
    const run = (frames, measure) => page.evaluate(async (frames, measure) => {
      const a = window.__t.app, rd = window.__t.renderer, dev = rd.backend.device;
      rd.setAnimationLoop(null);
      a.st.speed = 20; a.st.maxSteps = 28; a.st.playing = true;
      await dev.queue.onSubmittedWorkDone();
      const t0 = performance.now(), s0 = a.solver.subSteps ?? null, c0 = a.lead.time;
      // every frame waits for the GPU (and lets a control readback arrive): the same for every version measured
      for (let i = 0; i < frames; i++) { a.frame(1 / 60); await dev.queue.onSubmittedWorkDone(); }
      await dev.queue.onSubmittedWorkDone();
      const ms = performance.now() - t0;
      a.st.playing = false;
      await new Promise((r) => setTimeout(r, 4));
      return { t: a.lead.time, ms: ms / frames, simPerFrame: (a.lead.time - c0) / frames };
    }, frames, measure);
    let t = 0;
    while (t < target) t = (await run(64, false)).t;
    const res = [];
    for (let k = 0; k < 5; k++) res.push(await run(120, true));
    const ms = res.map((r) => r.ms).sort((a, b) => a - b);
    console.log(`${name} ${base} marks=${process.env.BENCH_MARKS ?? 1}  ms/frame median ${ms[2].toFixed(2)} (min ${ms[0].toFixed(2)}, max ${ms[4].toFixed(2)})  sim s/frame ${res[2].simPerFrame.toFixed(3)}  t=${res[4].t.toFixed(0)}`);
    await browser.close();
  }
}
