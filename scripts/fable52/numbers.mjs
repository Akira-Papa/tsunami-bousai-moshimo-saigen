// 計算の数字の記録：同じ地点・同じ条件で、ふつうに再生して（実時間・自動の描画ループのまま）、決めた時刻の数字を読む。
// 同じ条件を何回かくり返し、回ごとのばらつきも記録する（計算を変える前後の比較用）。
//   node scripts/fable52/numbers.mjs <出力フォルダ> <ラベル> [くり返し回数=3]
//   NUM_ONLY=nagoya,kochi,inland   NUM_SPEED=20（再生速度。指定しなければ画面の既定）
//   NUM_EXTRA='&xhold=300'（条件の追加。感度実験用の ?xl ?xhold ?xbreach は開発サーバーのみ）  NUM_TIMES=700,1100（読む時刻の差し替え）
//   NUM_N=512（格子の差し替え）  NUM_AT='緯度,経度'（表にない地点を1つ測る）
// 読む数字（GPU から読み戻した値そのもの。画面の丸めを通さない）：
//   h      ここの深さ（いま）m       max   ここの最大の深さ m      vmax  ここの最大の流速 m/s
//   arr    ここに水が着いた時刻（計算の時計・秒。着いていなければ null）
//   gain   沖の波の大きさを合わせる係数        mean  海岸の平均水位 m     front 水の先端までの距離 m
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'docs/fable52/calc');
const LABEL = process.argv[3] || 'run';
const REPEAT = Number(process.argv[4] || 3);
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const ONLY = (process.env.NUM_ONLY || '').split(',').filter(Boolean);
const SPEED = process.env.NUM_SPEED ? Number(process.env.NUM_SPEED) : null;
const EXTRA = process.env.NUM_EXTRA || '';
const TIMES = process.env.NUM_TIMES ? process.env.NUM_TIMES.split(',').map(Number) : null;
const NQ = process.env.NUM_N || null;
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = {
  // 名古屋港 ガーデンふ頭（海 → 防潮壁を越える → 市街地へ）。公式想定（内閣府2025 ケース01）は、この地点で 1.27m
  nagoya: { title: '名古屋港 ガーデンふ頭', query: '&lat=35.0905&lon=136.8844&n=768', times: [300, 700, 1100, 1750] },
  // 高知市 種崎（外海に面した砂州）
  kochi: { title: '高知市 種崎', query: '&lat=33.5061&lon=133.5693&n=768', times: [400, 800, 1500] },
  // 名古屋駅の近く（内陸・二段計算）
  inland: { title: '名古屋駅の近く（内陸・二段計算）', query: '&lat=35.1709&lon=136.8815&n=512', times: [1500, 3000] },
};
// NUM_AT='33.5672,133.5436'（緯度,経度）で、表にない地点を1つ測る（名前は custom。格子は画面の既定）
if (process.env.NUM_AT) { const [la, lo] = process.env.NUM_AT.split(','); CASES.custom = { title: `地点 ${la},${lo}`, query: `&lat=${la}&lon=${lo}`, times: [600, 1100, 1500] }; }
for (const c of Object.values(CASES)) { if (NQ) c.query = c.query.replace(/&n=\d+/, `&n=${NQ}`); c.query += EXTRA; if (TIMES) c.times = TIMES; }
const report = { label: LABEL, base: BASE, at: new Date().toISOString(), repeat: REPEAT, speed: SPEED ?? '画面の既定', extra: EXTRA, cases: {} };

async function once(name, c, rep) {
  const r = { rep, errors: [], rows: [] };
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 900000,
    args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => r.errors.push('pageerror: ' + e.message.slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) r.errors.push('console.error: ' + m.text().slice(0, 200)); });
    await page.goto(`${BASE}/?manual=1${c.query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
    await sleep(1500);
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
    await sleep(2500);
    r.conditions = await page.evaluate(() => { const a = window.__t.app; return { N: a.solver.N, dx: a.solver.dx, L: a.solver.L, H: a.lead.wave.H, tide: a.lead.wave.tide, nested: !!a.outerSolver, speed: a.st.speed }; });
    if (SPEED) await page.evaluate((s) => { [...document.querySelectorAll('#speeds button')].find((b) => Number(b.dataset.s) === s)?.click(); }, SPEED);
    r.conditions.speedUsed = await page.evaluate(() => window.__t.app.st.speed);
    await page.evaluate(() => { if (!window.__t.app.st.playing) document.getElementById('play').click(); });
    for (const target of c.times) {
      await page.waitForFunction((t) => window.__t.app.lead.time >= t, { timeout: 600000, polling: 100 }, target);
      await page.evaluate(() => { if (window.__t.app.st.playing) document.getElementById('play').click(); });
      await sleep(900); // 読み戻しが届くまで（止めたままでも描画ループは回り、地点の値を読み続ける）
      r.rows.push(await page.evaluate(() => {
        const a = window.__t.app, s = a.solver, p = s.probe, l = a.lead;
        const f = Math.min(s.coast.front, a.outerSolver ? a.outerSolver.coast.front : Infinity);
        const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
        return {
          t: r3(l.time), h: r3(p.q?.[0]), max: r3(p.m?.[0]), vmax: r3(p.m?.[2]),
          arr: p.m && p.m[1] >= 0 && p.m[1] < 1e8 ? r3(p.m[1]) : null,
          gain: r3(l.wave.gain), mean: r3(l.coast.mean), meanMax: r3(l.coast.meanMax), front: r3(f),
          breached: s.coast.breached, washed: s.coast.washed, fps: document.getElementById('perf').textContent.trim().slice(0, 40),
        };
      }));
      await page.evaluate(() => { if (!window.__t.app.st.playing) document.getElementById('play').click(); });
    }
  } catch (e) { r.errors.push('script: ' + e.message.slice(0, 200)); }
  await browser.close();
  return r;
}

for (const [name, c] of Object.entries(CASES)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const runs = [];
  for (let i = 0; i < REPEAT; i++) {
    const r = await once(name, c, i + 1);
    runs.push(r);
    console.log(`${name} #${i + 1}: errors=${r.errors.length} ` + r.rows.map((x) => `[t=${Math.round(x.t)} h=${x.h} max=${x.max} v=${x.vmax} arr=${x.arr} gain=${x.gain} front=${x.front}]`).join(' '));
    for (const e of r.errors.slice(0, 3)) console.log('   ' + e);
  }
  // 時刻ごとの幅（最小〜最大）
  const spread = c.times.map((t, k) => {
    const col = (key) => { const v = runs.map((r) => r.rows[k]?.[key]).filter((x) => x != null); return v.length ? { min: Math.min(...v), max: Math.max(...v), n: v.length } : null; };
    return { t, h: col('h'), max: col('max'), vmax: col('vmax'), arr: col('arr'), gain: col('gain'), meanMax: col('meanMax'), front: col('front') };
  });
  report.cases[name] = { title: c.title, query: c.query, runs, spread };
  const f = (s) => (s ? (s.min === s.max ? `${s.min}` : `${s.min}〜${s.max}`) : '—');
  for (const s of spread) console.log(`  ${name} t=${s.t}: 深さ ${f(s.h)} / 最大 ${f(s.max)} / 最大流速 ${f(s.vmax)} / 到達 ${f(s.arr)} / gain ${f(s.gain)} / 先端 ${f(s.front)}`);
}
fs.writeFileSync(path.join(OUT, `${LABEL}_numbers.json`), JSON.stringify(report, null, 2));
