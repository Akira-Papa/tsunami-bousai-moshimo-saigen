// 「逃げる道のり（目安）」の確認：地点ごと・画面幅ごとに、道のりの一覧と地図の線を撮り、数字のつじつまを確かめる。
//   node scripts/fable52/route.mjs <出力フォルダ> <ラベル>
// 確かめること：
//   ・道のりの一覧が出る（または「取得できませんでした」「見つかりませんでした」が文で出る）
//   ・道のり ≥ 直線距離（道のりが直線より短ければ計算の誤り）
//   ・海の高さを変えると、高い所の行き先が変わる
//   ・通信を切ると「取得できませんでした」と出て、直線距離の一覧は残り、「もう一度」で取れる
//   ・コンソールエラー0（国土地理院の標高タイルの404＝海のタイルは想定内）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'docs/fable52/route');
const LABEL = process.argv[3] || 'run';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const ONLY = (process.env.ROUTE_ONLY || '').split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { label: LABEL, base: BASE, at: new Date().toISOString(), runs: [] };

const PLACES = {
  nagoya: ['名古屋港 ガーデンふ頭', 35.0905, 136.8844],
  zenshin: ['名古屋市港区 善進本町（海抜ゼロメートル地帯）', 35.1008, 136.8560],
  kochi: ['高知市 種崎', 33.5061, 133.5693],
  owase: ['尾鷲市街', 34.0753, 136.1973],
  kushimoto: ['串本町', 33.4704, 135.7800],
};
const PC = { width: 1440, height: 900, deviceScaleFactor: 1 };
const SP = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TAB = { width: 768, height: 1024, deviceScaleFactor: 1 };

const readRoute = (page) => page.evaluate(() => {
  const el = document.getElementById('brief-route');
  if (!el) return null;
  const num = (t, re) => { const m = re.exec(t); if (!m) return null; return m[2] === 'km' ? Number(m[1]) * 1000 : Number(m[1]); };
  return {
    text: el.innerText.slice(0, 2500),
    waiting: !!el.querySelector('.brief-wait'), failed: !!el.querySelector('.brief-fail'), none: !!el.querySelector('.brief-none'),
    items: [...el.querySelectorAll('.route-item')].map((b) => ({
      id: b.dataset.route, kind: b.classList.contains('high') ? 'high' : 'site', title: b.querySelector('b')?.innerText ?? '',
      road: num(b.innerText, /道のり 約([\d.]+)(m|km)/), straight: num(b.innerText, /直線では約([\d.]+)(m|km)/), elev: num(b.innerText, /標高 約(-?[\d.]+)(m)/),
    })),
    miss: [...el.querySelectorAll('.route-miss')].map((n) => n.innerText.slice(0, 120)),
  };
});

async function run(name, vp, place, { gpu = true, wave = false, offline = false, base = BASE } = {}) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const [title, lat, lon] = PLACES[place];
  const r = { name, place: title, vp, gpu, errors: [], checks: {} };
  report.runs.push(r);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: gpu ? ['--enable-unsafe-webgpu', '--hide-scrollbars'] : ['--disable-features=WebGPU', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  if (!gpu) await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'gpu', { get: () => undefined }); });
  let offlineNow = false;
  page.on('pageerror', (e) => r.errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) r.errors.push('console.error: ' + m.text().slice(0, 200)); });
  page.on('response', (x) => { if (x.status() >= 400 && !/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem(5a)?_png\//.test(x.url())) r.errors.push(`http ${x.status()} ${x.url().slice(0, 120)}`); });
  const shot = (tag) => page.screenshot({ path: path.join(OUT, `${LABEL}_${name}_${tag}.png`) });
  const waitRoute = () => page.waitForFunction(() => { const e = document.getElementById('brief-route'); return !document.getElementById('brief') || document.getElementById('brief').hidden ? false : !e || !e.querySelector('.brief-wait'); }, { timeout: 60000 }).catch(() => {});
  try {
    if (offline) {
      // 先にページと地図を読み込み、地点を選ぶ直前に通信を切る
      await page.goto(`${base}/?manual=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#presets button', { timeout: 30000 });
      await sleep(3000);
      await page.setOfflineMode(true); offlineNow = true;
      await page.evaluate(() => { [...document.querySelectorAll('#presets button')].find((b) => b.textContent.includes('ガーデンふ頭')).click(); });
      await sleep(9000);
      await waitRoute();
      r.offline = await readRoute(page);
      r.offlineEvac = (await page.evaluate(() => document.getElementById('brief-evac')?.innerText ?? '')).slice(0, 120);
      await shot('offline');
      await page.setOfflineMode(false); offlineNow = false;
      // 逃げる場所を取り直すと、道のりも続けて取れる
      await page.evaluate(() => document.querySelector('#brief-evac [data-retry]')?.click());
      await sleep(1500);
      await page.evaluate(() => document.querySelector('#brief-route [data-retry]')?.click());
      await sleep(6000);
      await waitRoute();
      r.afterRetry = await readRoute(page);
      r.checks.offlineSaysFailed = !!r.offline?.failed || /取得できません/.test(r.offlineEvac);
      r.checks.retryWorks = (r.afterRetry?.items?.length ?? 0) > 0;
    } else {
      await page.goto(`${base}/?manual=1&lat=${lat}&lon=${lon}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => { const b = document.getElementById('brief'); return b && !b.hidden && !b.querySelector('.brief-wait'); }, { timeout: 60000 }).catch(() => {});
      await waitRoute();
      await sleep(2500);
      r.route = await readRoute(page);
      await shot('1card_top');
      if (r.route) {
        // 一覧が見える位置までカードをスクロール
        await page.evaluate(() => document.getElementById('brief-route').scrollIntoView({ block: 'start' }));
        await sleep(700);
        await shot('2route_list');
        // 行き先を1つずつ選んで、線を強調した地図を撮る（最大3つ）
        for (const it of r.route.items.slice(0, 3)) {
          await page.evaluate((id) => document.querySelector(`[data-route="${id}"]`)?.click(), it.id);
          await sleep(1800);
          await shot(`3line_${it.id}`);
        }
        const high = r.route.items.find((i) => i.kind === 'high');
        if (high) { await page.evaluate((id) => document.querySelector(`[data-route="${id}"]`)?.click(), high.id); await sleep(1800); await shot(`3line_${high.id}`); }
        r.checks.listed = r.route.items.length > 0 || r.route.miss.length > 0 || r.route.none;
        r.checks.roadNotShorterThanStraight = r.route.items.filter((i) => i.kind === 'site' && i.straight != null).every((i) => i.road >= i.straight - 15);
        r.lines = await page.evaluate(() => window.__t?.picker?.map?.querySourceFeatures ? window.__t.picker.map.querySourceFeatures('routes').length : null);
        if (wave && gpu) {
          // 海の高さを下げる → 高い所の行き先が変わる（または見つかる）こと
          const before = JSON.stringify(r.route.items.filter((i) => i.kind === 'high').concat(r.route.miss));
          const H0 = await page.evaluate(() => Number(document.getElementById('H').value));
          const H1 = Math.max(1, Math.round(H0 / 3));
          await page.evaluate((v) => { const s = document.getElementById('H'); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }, H1);
          await sleep(1500);
          r.waveRoute = await readRoute(page);
          r.wave = { H0, H1 };
          r.checks.waveChangesHigh = JSON.stringify(r.waveRoute.items.filter((i) => i.kind === 'high').concat(r.waveRoute.miss)) !== before;
          await page.evaluate(() => document.getElementById('brief-route').scrollIntoView({ block: 'start' }));
          await sleep(600);
          await shot(`4wave_H${H1}`);
        }
      }
    }
  } catch (e) { r.errors.push('script: ' + e.message.slice(0, 200)); }
  if (offlineNow) await page.setOfflineMode(false).catch(() => {});
  await browser.close();
  const c = r.checks;
  r.pass = r.errors.length === 0 && Object.values(c).every((v) => v !== false);
  const sum = r.route ? `${r.route.items.map((i) => `${i.kind === 'high' ? '高' : '指'}:${i.road}m${i.straight != null ? `(直線${i.straight})` : ''}${i.elev != null ? `標高${i.elev}` : ''}`).join(' ')} | なし:${r.route.miss.length}${r.route.failed ? ' 取得失敗' : ''}${r.route.none ? ' 道なし' : ''}` : r.offline ? `offline:${r.offline.failed ? '取得失敗の文あり' : '?'} retry→${r.afterRetry?.items?.length ?? 0}件` : '道のりの欄なし（変更前）';
  console.log(`${name}: ${r.pass ? '合格' : '不合格'} errors=${r.errors.length} ${JSON.stringify(c)} ${sum}`);
  for (const e of r.errors.slice(0, 4)) console.log('   ' + e);
}

await run('nagoya_pc', PC, 'nagoya', { wave: true });
await run('nagoya_sp', SP, 'nagoya');
await run('nagoya_tab', TAB, 'nagoya');
await run('nagoya_nogpu_sp', SP, 'nagoya', { gpu: false });
await run('zenshin_pc', PC, 'zenshin');
await run('kochi_pc', PC, 'kochi', { wave: true });
await run('kochi_sp', SP, 'kochi');
await run('owase_pc', PC, 'owase', { wave: true });
await run('owase_sp', SP, 'owase');
await run('kushimoto_pc', PC, 'kushimoto');
await run('offline_pc', PC, 'nagoya', { offline: true });
fs.writeFileSync(path.join(OUT, `${LABEL}_report.json`), JSON.stringify(report, null, 2));
