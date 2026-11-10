// 3D再現の「水の見た目」を、同じ時刻・同じ視点で撮る（変更前後の比較用）。あわせて fps と、画面の数字が変わっていないことを記録する。
//   node scripts/fable52/water.mjs <出力フォルダ> <ラベル>
// 画面の部品（右の欄・ドックなど）は隠して、水だけを見る。色分け（深さの塗り）は別に1枚撮る。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'docs/fable52/water');
const LABEL = process.argv[3] || 'run';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const ONLY = (process.env.WATER_ONLY || '').split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { label: LABEL, at: new Date().toISOString(), runs: [] };

async function run(name, vp, query, times, views) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const r = { name, vp, errors: [], shots: [], numbers: [], fps: {} };
  report.runs.push(r);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 900000,
    args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const page = await browser.newPage();
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  page.on('pageerror', (e) => r.errors.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*404/.test(m.text())) r.errors.push('console.error: ' + m.text().slice(0, 300)); });
  await page.goto(`${BASE}/?manual=1${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
  await sleep(1500);
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
  await sleep(2500);
  // 水だけを見る：画面の部品を隠す（3Dの札は残す）
  const hide = await page.addStyleTag({ content: '.hud,.dock,.badge,.topbar,.toast,.credit,.perf{visibility:hidden !important}' });
  let t = 0;
  for (const target of times) {
    // 計算の進み方を、描画の重さや実時間に左右されない形にそろえる（変更前後で同じ数字になることを確かめるため）：
    //  ・自動の描画ループを止め、8コマずつ手で進める
    //  ・進めるたびに GPU の処理が終わるのを待つ（海岸の水位を合わせる制御は GPU からの読み戻しを使うので、
    //    読み戻しが届く時点を「計算の何コマ目か」にそろえる）
    while (t < target) {
      t = await page.evaluate(async (frames) => {
        const a = window.__t.app, rd = window.__t.renderer;
        rd.setAnimationLoop(null);
        a.st.speed = 20; a.st.maxSteps = 28; a.st.playing = true;
        for (let i = 0; i < frames; i++) a.frame(1 / 30);
        a.st.playing = false;
        await rd.backend.device.queue.onSubmittedWorkDone();
        await new Promise((r) => setTimeout(r, 4)); await new Promise((r) => setTimeout(r, 4));
        return a.lead.time;
      }, 8);
    }
    // 数字（計算の結果）：見た目を変えても同じであること
    await page.evaluate(async () => { const a = window.__t.app; for (let i = 0; i < 12; i++) { a.frame(0); await new Promise((r) => setTimeout(r, 20)); } }); // HUD の読み戻しが届くまで
    r.numbers.push(await page.evaluate(() => ({ t: Math.round(window.__t.app.lead.time * 100) / 100, now: document.getElementById('h-now').textContent, max: document.getElementById('h-max').textContent, v: document.getElementById('h-v').textContent, arr: document.getElementById('h-arr').textContent })));
    for (const v of views) {
      // 止めたまま（計算は進めずに）数コマ描く（影・コースティクスの更新）
      await page.evaluate(async (view) => { const a = window.__t.app; a.setView(view, true); for (let i = 0; i < 6; i++) { a.frame(0); await new Promise((r) => setTimeout(r, 30)); } }, v);
      await sleep(300);
      const f = `${LABEL}_${name}_${v}_${target}s.png`;
      await page.screenshot({ path: path.join(OUT, f) });
      r.shots.push(f);
    }
  }
  // 深さの色分けを重ねた状態（読み取りやすさが落ちていないこと）
  await page.evaluate(async () => { const c = document.getElementById('tg-depth'); if (!c.checked) c.click(); const a = window.__t.app; a.setView('over', true); for (let i = 0; i < 6; i++) { a.frame(0); await new Promise((r) => setTimeout(r, 30)); } });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `${LABEL}_${name}_over_depthcolor.png`) });
  await page.evaluate(() => { const c = document.getElementById('tg-depth'); if (c.checked) c.click(); });
  // fps：視点ごとに実時間で6秒再生して、表示の値を読む（ここで自動の描画ループに戻す）
  await page.evaluate(() => { const a = window.__t.app; a.st.lastT = performance.now(); window.__t.renderer.setAnimationLoop(() => a.frame()); });
  // 再生を再開した直後の数秒は、計算の歩数と解像度の自動調整が落ち着くまで fps が低く出る → 先に8秒まわしてから測る
  await page.evaluate(() => { if (!window.__t.app.st.playing) document.getElementById('play').click(); });
  await sleep(8000);
  for (const v of views) {
    await page.evaluate((view) => { window.__t.app.setView(view, true); if (!window.__t.app.st.playing) document.getElementById('play').click(); }, v);
    await sleep(6500);
    r.fps[v] = await page.$eval('#perf', (e) => e.textContent.trim());
    await page.evaluate(() => { if (window.__t.app.st.playing) document.getElementById('play').click(); });
  }
  r.pixelRatio = await page.evaluate(() => window.__t.renderer.getPixelRatio());
  await hide.evaluate((n) => n.remove());
  await browser.close();
  console.log(`${name}: errors=${r.errors.length} shots=${r.shots.length} fps=${JSON.stringify(r.fps)} pr=${r.pixelRatio}`);
  for (const e of r.errors) console.log('  ' + e);
}

const PC = { width: 1440, height: 900, deviceScaleFactor: 1 };
const SP = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
// 名古屋港 ガーデンふ頭（海 → 防潮壁を越える → 市街地へ）
await run('nagoya_pc', PC, '&lat=35.0905&lon=136.8844&n=768', [300, 700, 1100, 1750], ['over', 'pin', 'eye', 'impact']);
await run('nagoya_sp', SP, '&lat=35.0905&lon=136.8844&n=512', [700, 1100], ['over', 'eye']);
// 高知市 種崎（外海に面した砂州・深い浸水）
await run('kochi_pc', PC, '&lat=33.5061&lon=133.5693&n=768', [400, 800], ['over', 'eye', 'impact']);
fs.writeFileSync(path.join(OUT, `${LABEL}_report.json`), JSON.stringify(report, null, 2));
