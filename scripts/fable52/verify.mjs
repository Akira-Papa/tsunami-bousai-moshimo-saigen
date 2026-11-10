// 検証用：ヘッドレス Chrome（WebGPU 有効）で実際の画面を開き、PC幅とスマホ幅の画面・コンソールエラー・fps・HUD値を記録する。
//   node scripts/fable52/verify.mjs <出力フォルダ> [ラベル]
// puppeteer-core はリポジトリの依存に入れない。PUPPETEER_CORE_DIR に npm install した場所を渡す。
// dev サーバー（npm run dev → http://127.0.0.1:5341）が動いていること。window.__t フックは dev のみ。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'shots/fable52');
const LABEL = process.argv[3] || 'run';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const ONLY = (process.env.VERIFY_ONLY || '').split(',').filter(Boolean); // e.g. pc,sp,nogpu,inland
fs.mkdirSync(OUT, { recursive: true });

function loadPuppeteer() {
  for (const d of [process.env.PUPPETEER_CORE_DIR, process.cwd()].filter(Boolean)) {
    try { return createRequire(path.join(d, 'package.json'))('puppeteer-core'); } catch { /* next */ }
  }
  throw new Error('puppeteer-core が見つかりません。PUPPETEER_CORE_DIR を指定してください');
}
const puppeteer = loadPuppeteer();
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { label: LABEL, base: BASE, at: new Date().toISOString(), runs: [] };

async function open(browser, vp, url, run) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  page.on('pageerror', (e) => run.errors.push('pageerror: ' + e.message.slice(0, 300)));
  page.on('console', async (m) => {
    if (m.type() === 'warning') run.warnings.push(m.text().slice(0, 200));
    if (m.type() !== 'error') return;
    let t = m.text();
    if (t.includes('JSHandle')) t = (await Promise.all(m.args().map((a) => a.evaluate((v) => (v instanceof Error ? `${v.name}: ${v.message} ${String(v.stack).split('\n').slice(1, 4).join(' | ')}` : v?.error ? `${v.error.name}: ${v.error.message} ${String(v.error.stack).split('\n').slice(1, 4).join(' | ')}` : typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v))).catch(() => m.text() + ' @' + JSON.stringify(m.location()))))).join(' ');
    // 国土地理院の標高タイルは、海のタイルに 404 を返す（仕様）。ブラウザが出すその行は「想定内」に分ける
    if (/Failed to load resource.*404/.test(t)) { (run.expected404 ??= []).push(t.slice(0, 120)); return; }
    run.errors.push('console.error: ' + t.slice(0, 300));
  });
  page.on('requestfailed', (r) => run.failed.push(r.url().slice(0, 160)));
  page.on('response', (r) => { if (r.status() >= 400) (run.http4xx ??= []).push(`${r.status()} ${r.url().slice(0, 160)}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page;
}
const shot = async (page, run, name) => { const f = path.join(OUT, `${LABEL}_${run.name}_${name}.png`); await page.screenshot({ path: f }); run.shots.push(path.basename(f)); };
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null);

/** 地点選択 → 再現 → 結果 の一連（1段計算：ガーデンふ頭） */
async function flow(browser, name, vp, { preset = 'ガーデンふ頭', query = '', simSeconds = [240, 660, 1080], extra } = {}) {
  const run = { name, vp, errors: [], warnings: [], failed: [], shots: [], hud: [] };
  report.runs.push(run);
  const page = await open(browser, vp, `${BASE}/?manual=1${query}`, run);
  try {
    await page.waitForSelector('#presets button', { timeout: 30000 });
    await sleep(3500);
    await shot(page, run, '1pick');
    // query に lat/lon があれば、その地点が自動で選ばれる（共有リンクと同じ経路）
    if (!query) await page.evaluate((p) => { [...document.querySelectorAll('#presets button')].find((b) => b.textContent.includes(p)).click(); }, preset);
    await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 60000 });
    await sleep(2500);
    await page.waitForFunction(() => { const b = document.getElementById('brief'); return !b || (b.querySelector('.brief-off') && !b.querySelector('.brief-wait')); }, { timeout: 30000 }).catch(() => {});
    await shot(page, run, '2selected');
    run.brief = (await page.evaluate(() => document.getElementById('brief')?.innerText ?? '')).slice(0, 1500);
    if (await page.$('#sim-setup')) {
      await page.evaluate(() => document.getElementById('sim-setup').scrollIntoView({ block: 'start' }));
      await sleep(600);
      await shot(page, run, '2b_setup');
    }
    run.sel = { name: await text(page, '#sel-name'), H: await text(page, '#Hout'), cond: await text(page, '#cond-line'), condWarn: await text(page, '#cond-warn'), warn: await text(page, '#sel-warn') };
    const t0 = Date.now();
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
    run.loadMs = Date.now() - t0;
    await sleep(2500);
    await shot(page, run, '3ready');
    // 実時間で数秒まわして fps を読む
    await page.evaluate(() => document.getElementById('play').click());
    await sleep(9000);
    run.perfText = await text(page, '#perf');
    await page.evaluate(() => { if (window.__t.app.st.playing) document.getElementById('play').click(); });
    let done = await page.evaluate(() => window.__t.app.lead.time);
    for (const [n, target] of simSeconds.entries()) {
      // 決定的に進める（1コマ=1/30秒、×20）
      while (done < target) {
        done = await page.evaluate((chunk) => { const a = window.__t.app; a.st.speed = 20; window.__t.advance(chunk); return a.lead.time; }, 4);
      }
      await sleep(1200);
      if (n === 1) await page.evaluate(() => { const c = document.getElementById('tg-depth'); if (!c.checked) c.click(); });
      await sleep(800);
      await shot(page, run, `4sim_${target}s`);
      // 重なりの実測：常設の札・上の帯・右の欄（HUD）・下のドック・通知が、互いに重ならず、画面内にあること
      (run.overlaps ??= []).push(await page.evaluate(() => {
        const R = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return { s, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
        const list = ['.badge', '.topbar', '.hud', '.dock', '#toast'].map(R).filter(Boolean);
        const out = [];
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (a.y1 > innerHeight + 1 || a.x1 > innerWidth + 1 || a.x0 < -1 || a.y0 < -1) out.push(`${a.s} 画面外`);
          for (let j = i + 1; j < list.length; j++) { const b = list[j]; const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); if (w > 2 && h > 2) out.push(`${a.s}×${b.s} ${Math.round(w)}×${Math.round(h)}`); }
        }
        return out;
      }));
      run.hud.push({ t: Math.round(done), clock: await text(page, '#clock'), phase: await text(page, '#phase'), now: await text(page, '#h-now'), say: await text(page, '#h-say'), max: await text(page, '#h-max'), arr: await text(page, '#h-arr'), off: await text(page, '#h-off') });
    }
    if (extra) await extra(page, run);
    await page.evaluate(() => document.getElementById('result-btn').click());
    await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 60000 });
    await sleep(1200);
    await shot(page, run, '5result');
    run.result = { sim: await text(page, '#r-sim'), off: await text(page, '#r-off'), note: await text(page, '#r-note') };
    // 結果の下まで
    await page.evaluate(() => { const c = document.querySelector('.result-card'); c.scrollTop = c.scrollHeight; });
    await sleep(500);
    await shot(page, run, '6result_bottom');
    if (await page.$('#r-memo')) {
      run.resultKey = await text(page, '#r-key');
      run.resultEvac = (await text(page, '#r-evac') ?? '').slice(0, 600);
      // Esc closes the result and focus returns; then the memo dialog
      await page.keyboard.press('Escape');
      await sleep(300);
      run.escClosed = await page.evaluate(() => document.getElementById('result').hidden);
      run.focusAfterEsc = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
      await page.evaluate(() => document.getElementById('result-btn').click());
      await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 60000 });
      await sleep(800);
      await page.evaluate(() => document.getElementById('r-memo').click());
      await sleep(600);
      await page.type('#m-where', '○○小学校の校舎 3階以上');
      await sleep(700);
      await shot(page, run, '7memo');
      run.memoSaved = await text(page, '#memo-saved');
      await page.evaluate(() => document.getElementById('memo-close').click());
    } else await page.evaluate(() => document.getElementById('r-close').click());
    // 選び直し → もう一度選択画面が出る（回帰）
    await page.evaluate(() => document.getElementById('back').click());
    await sleep(1500);
    run.backToPick = await page.evaluate(() => document.getElementById('pick').classList.contains('active'));
  } catch (e) {
    run.errors.push('script: ' + e.message.slice(0, 300));
    await shot(page, run, 'error').catch(() => {});
  }
  await page.close();
  return run;
}

async function nogpu(name, vp, gl = true) {
  const run = { name, vp, errors: [], warnings: [], failed: [], shots: [] };
  report.runs.push(run);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: gl ? ['--disable-features=WebGPU', '--enable-unsafe-swiftshader', '--hide-scrollbars'] : ['--disable-gpu', '--disable-features=WebGPU', '--hide-scrollbars'] });
  const page = await open(browser, vp, `${BASE}/`, run);
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'gpu', { get: () => undefined }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await shot(page, run, 'nogpu');
  run.active = await page.evaluate(() => document.querySelector('.screen.active')?.id);
  run.text = (await page.evaluate(() => document.querySelector('.screen.active')?.innerText ?? '')).slice(0, 600);
  // 修正後：WebGPU がなくても、地点を選べば公式想定と逃げる場所が出る
  if (run.active === 'pick') {
    for (const [tag, preset] of [['nagoya', 'ガーデンふ頭'], ['kochi', '高知市 種崎']]) {
      await page.evaluate((p) => { [...document.querySelectorAll('#presets button')].find((b) => b.textContent.includes(p)).click(); }, preset);
      await page.waitForFunction(() => { const b = document.getElementById('brief'); return b && !b.hidden && !b.querySelector('.brief-wait'); }, { timeout: 40000 }).catch(() => {});
      await sleep(3500);
      await shot(page, run, `nogpu_${tag}`);
      (run.briefs ??= {})[tag] = (await page.evaluate(() => document.getElementById('brief')?.innerText ?? '')).slice(0, 1200);
    }
    run.simSetupHidden = await page.evaluate(() => document.getElementById('sim-setup').hidden);
    run.gpuNote = await page.evaluate(() => document.getElementById('gpu-note').innerText);
  }
  // 「WebGPU not available」は意図した停止なので、エラー件数からは除く
  run.errors = run.errors.filter((e) => !/WebGPU not available/.test(e));
  await browser.close();
}

const PC = { width: 1440, height: 900, deviceScaleFactor: 1 };
const SP = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const want = (k) => !ONLY.length || ONLY.includes(k);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 900000,
  args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
if (want('pc')) await flow(browser, 'pc1440', PC, { simSeconds: [240, 660, 1080, 2360] });
// 届かない条件（海の高さ2m・防潮壁4.6m）を共有リンクの形で開き、最後まで：「届かなかった」の書き方を確かめる
if (want('noreach')) await flow(browser, 'noreach_pc1440', PC, { query: '&lat=35.0905&lon=136.8844&h=2&n=512', simSeconds: [600, 2360] });
if (want('noreach')) await flow(browser, 'noreach_sp390', SP, { query: '&lat=35.0905&lon=136.8844&h=2&n=512', simSeconds: [2360] });
// タブレット幅と横長：右の欄と下のドックが重ならないこと
if (want('tablet')) await flow(browser, 'tab768', { width: 768, height: 1024, deviceScaleFactor: 1 }, { simSeconds: [700, 1080] });
if (want('tablet')) await flow(browser, 'land1024', { width: 1024, height: 768, deviceScaleFactor: 1 }, { simSeconds: [700, 1080] });
// 内陸（名古屋駅・二段ネスト計算）が今までどおり動くこと（回帰）
if (want('inland')) await flow(browser, 'inland_pc1440', PC, { query: '&lat=35.1709&lon=136.8815&n=512', simSeconds: [300, 1500] });
// 名古屋以外（高知市種崎）：全国の逃げる場所と、ケース01が最大でない地域の注意
if (want('kochi')) await flow(browser, 'kochi_sp390', SP, { query: '&lat=33.5061&lon=133.5693&n=512', simSeconds: [600] });
if (want('sp')) await flow(browser, 'sp390', SP, { simSeconds: [240, 660] });
await browser.close();
if (want('nogpu')) { await nogpu('nogpu_pc1440', PC); await nogpu('nogpu_sp390', SP); }
// WebGL2 もない端末（地図も出せない）：文字だけで公式想定と逃げる場所が出ること
if (want('nogl')) await nogpu('nogl_sp390', SP, false);

// 404 は「国土地理院の標高タイル（海）」だけであることを確かめる。それ以外の 4xx/5xx はエラーに数える
for (const r of report.runs) for (const h of r.http4xx ?? []) if (!/^404 https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem(5a)?_png\//.test(h)) r.errors.push('http: ' + h);
fs.writeFileSync(path.join(OUT, `${LABEL}_report.json`), JSON.stringify(report, null, 2));
for (const r of report.runs) if (r.overlaps?.flat().length) console.log(`  [${r.name}] 重なり: ${[...new Set(r.overlaps.flat())].join(' / ')}`);
for (const r of report.runs) console.log(`${r.name}: errors=${r.errors.length} failed=${r.failed.length} shots=${r.shots.length} perf=${r.perfText ?? '-'} load=${r.loadMs ?? '-'}ms`);
for (const r of report.runs) for (const e of r.errors) console.log(`  [${r.name}] ${e}`);
