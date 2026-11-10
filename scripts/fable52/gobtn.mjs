// 「この地点で、3Dで再現する」ボタンが、カードをスクロールしても常に見えているかを実測する。
//   node scripts/fable52/gobtn.mjs <出力フォルダ> <ラベル>
// 各画面幅で、地点を選んだあと、カードのスクロールを 最上部・途中・最下部 にして：
//   ・ボタンが画面内にあり、実際にその位置でいちばん手前にある（ほかの要素に隠れていない）
//   ・「揺れたら逃げる」の帯や、逃げる場所の項目と重なっていない
//   ・スクロール位置が勝手に引き戻されない（置いた位置のまま。ホイール操作でも確かめる）
//   ・WebGPU なしでは、押せないボタンが出ていない
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = path.resolve(process.argv[2] || 'docs/fable52/gobtn');
const LABEL = process.argv[3] || 'run';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { label: LABEL, at: new Date().toISOString(), runs: [] };

// the element that scrolls inside the pick card (the card itself before the change, the inner scroller after)
const SCROLLER = `(() => { const c = document.querySelector('.pick-card'); return [...c.querySelectorAll('*'), c].find((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)) || c; })()`;

async function measure(page) {
  return page.evaluate(`(() => {
    const go = document.getElementById('go');
    const vis = (e) => e && !e.hidden && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
    const R = (e) => { const r = e.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
    const out = { scrollTop: Math.round(${SCROLLER}.scrollTop), goShown: vis(go), goDisabled: !!go?.disabled };
    if (!vis(go)) return out;
    const g = R(go);
    out.go = { x: Math.round(g.x0), y: Math.round(g.y0), w: Math.round(g.x1 - g.x0), h: Math.round(g.y1 - g.y0) };
    out.inView = g.y0 >= 0 && g.y1 <= innerHeight && g.x0 >= 0 && g.x1 <= innerWidth;
    const top = document.elementFromPoint((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2);
    out.onTop = !!top && (top === go || go.contains(top));
    const hit = (b) => Math.min(g.x1, b.x1) - Math.max(g.x0, b.x0) > 2 && Math.min(g.y1, b.y1) - Math.max(g.y0, b.y0) > 2;
    out.overlaps = [];
    for (const [name, sel] of [['揺れたら逃げるの帯', '.quake'], ['逃げる場所の項目', '.evac-item'], ['地図の出典', '.maplibregl-ctrl-attrib'], ['地図の注記', '#map-note'], ['公式想定の数字', '.brief-num']])
      for (const e of document.querySelectorAll(sel)) {
        if (!vis(e)) continue;
        const b = R(e);
        // an item scrolled under the fixed footer is clipped by its scroller, not covered: count only what is actually painted there
        const sc = e.closest('.pick-scroll');
        if (sc) { const s = R(sc); b.y0 = Math.max(b.y0, s.y0); b.y1 = Math.min(b.y1, s.y1); if (b.y1 - b.y0 < 2) continue; }
        if (hit(b)) out.overlaps.push(name);
      }
    out.overlaps = [...new Set(out.overlaps)];
    return out;
  })()`);
}

async function run(name, vp, { gpu = true } = {}) {
  const r = { name, vp, gpu, errors: [], steps: [] };
  report.runs.push(r);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: gpu ? ['--enable-unsafe-webgpu', '--hide-scrollbars'] : ['--disable-features=WebGPU', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  if (!gpu) await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'gpu', { get: () => undefined }); });
  page.on('pageerror', (e) => r.errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*404/.test(m.text())) r.errors.push('console.error: ' + m.text().slice(0, 200)); });
  page.on('response', (x) => { if (x.status() >= 400 && !/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem(5a)?_png\//.test(x.url())) r.errors.push(`http ${x.status()} ${x.url().slice(0, 120)}`); });
  await page.goto(`${BASE}/?manual=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#presets button', { timeout: 30000 });
  await sleep(2500);
  r.beforePick = await measure(page); // 地点を選ぶ前：ボタンは出ていないこと
  await page.evaluate(() => { [...document.querySelectorAll('#presets button')].find((b) => b.textContent.includes('ガーデンふ頭')).click(); });
  if (gpu) await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
  await page.waitForFunction(() => { const b = document.getElementById('brief'); return b && !b.hidden && !b.querySelector('.brief-wait'); }, { timeout: 40000 }).catch(() => {});
  await sleep(3000); // 選択直後の自動スクロール（scrollIntoView）が終わるまで
  const max = await page.evaluate(`(() => { const s = ${SCROLLER}; return s.scrollHeight - s.clientHeight; })()`);
  r.scrollMax = max;
  for (const [tag, pos] of [['1top', 0], ['2mid', Math.round(max / 2)], ['3bottom', max]]) {
    await page.evaluate(`${SCROLLER}.scrollTop = ${pos}`);
    await sleep(900);
    const m = await measure(page);
    m.tag = tag; m.want = pos;
    m.stayed = Math.abs(m.scrollTop - pos) <= 2; // 置いた位置のまま（引き戻されない）
    r.steps.push(m);
    await page.screenshot({ path: path.join(OUT, `${LABEL}_${name}_${tag}.png`) });
  }
  // 実際のホイール操作：上から少しずつ下げ、止めたあとに位置が戻らないこと
  await page.evaluate(`${SCROLLER}.scrollTop = 0`);
  await sleep(400);
  const box = await page.evaluate(() => { const c = document.querySelector('.pick-card').getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  const seen = [];
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 220 }); await sleep(350); seen.push(await page.evaluate(`Math.round(${SCROLLER}.scrollTop)`)); }
  await sleep(1200);
  const after = await page.evaluate(`Math.round(${SCROLLER}.scrollTop)`);
  r.wheel = { seen, after, monotonic: seen.every((v, i) => i === 0 || v >= seen[i - 1]), settled: Math.abs(after - seen.at(-1)) <= 2 };
  r.wheelGo = await measure(page);
  if (gpu) {
    // 途中の位置から押して、読み込み画面へ進むこと（押せる）
    const g = r.wheelGo.go;
    if (g) { await page.mouse.click(g.x + g.w / 2, g.y + g.h / 2); await sleep(1500); r.clickWorks = await page.evaluate(() => !document.getElementById('pick').classList.contains('active')); }
  }
  await browser.close();
  const ok = gpu
    ? r.steps.every((s) => s.goShown && s.inView && s.onTop && !s.overlaps.length && s.stayed) && r.wheel.monotonic && r.wheel.settled && r.wheelGo.inView && r.clickWorks && !r.beforePick.goShown
    : r.steps.every((s) => !s.goShown && s.stayed) && r.wheel.monotonic && r.wheel.settled;
  r.pass = ok && r.errors.length === 0;
  console.log(`${name}: ${r.pass ? '合格' : '不合格'} errors=${r.errors.length} ` + r.steps.map((s) => `${s.tag}[${s.goShown ? (s.inView && s.onTop ? '見える' : '見えない') : '出ていない'}${s.overlaps?.length ? ' 重なり:' + s.overlaps.join('・') : ''}${s.stayed ? '' : ' 引き戻し'}]`).join(' ') + ` wheel=${r.wheel.monotonic && r.wheel.settled ? 'OK' : 'NG'}${gpu ? ` 押せる=${r.clickWorks}` : ''}`);
}

const PC = { width: 1440, height: 900, deviceScaleFactor: 1 };
const SP = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
await run('pc1440', PC);
await run('sp390', SP);
await run('tab768', { width: 768, height: 1024, deviceScaleFactor: 1 });
await run('land1024', { width: 1024, height: 768, deviceScaleFactor: 1 });
await run('nogpu_sp390', SP, { gpu: false });
await run('nogpu_pc1440', PC, { gpu: false });
fs.writeFileSync(path.join(OUT, `${LABEL}_report.json`), JSON.stringify(report, null, 2));
