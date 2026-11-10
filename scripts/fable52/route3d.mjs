// 3Dの「逃げる道のり」の帯（設計 D5）の確認。
//   node scripts/fable52/route3d.mjs <出力フォルダ>     VERIFY_BASE=http://127.0.0.1:5341  PUPPETEER_CORE_DIR=…
// 確かめること（PC幅 1440×900・スマホ幅 390×844、名古屋港 ガーデンふ頭）：
//   ・カードで道のり（A）を選んでから3Dに入ると、「逃げる道のり」が自動でオンになり、凡例が出る
//   ・カードで何も選ばずに3Dに入ると、オフのまま（凡例も出ない）。「表示」から入れられる
//   ・行き先の札（A・B・C）が出る。地点が欄や操作に隠れない
//   ・スマホ幅で、凡例が出ている時も3Dの見える面積が55%以上
//   ・波が来る前は、道のどこも「水の下」と読まれない（橋の下の川・港の水を含む）
//   ・水が地点に着いた後は、道の一部が「水の下」と読まれる（読み戻した計算の値で数える）。その画面も撮る
//   ・コンソールエラー0（国土地理院の標高タイルの404＝海のタイルは想定内）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const OUT = path.resolve(process.argv[2] || 'docs/fable52/route3d');
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { at: new Date().toISOString(), runs: [] };

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
const pinFree = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('#stage3d .lbl.here')].find((e) => e.style.display !== 'none');
  if (!el) return false;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.bottom + 6;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit.tagName === 'CANVAS' || !!hit.closest('#stage3d'));
});

for (const [dev, vp, n] of [['PC', { width: 1440, height: 900, deviceScaleFactor: 1 }, 768], ['スマホ', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 512]]) {
  for (const pick of [true, false]) {
    const run = { dev, pick, errors: [], checks: {} };
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    const page = await browser.newPage();
    await page.setViewport(vp);
    page.on('pageerror', (e) => run.errors.push('pageerror: ' + e.message.slice(0, 300)));
    // a 404 is expected only for the GSI elevation tiles over the sea (no data there); any other 404 is an error
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) run.errors.push('console: ' + m.text().slice(0, 300)); });
    page.on('response', (res) => { if (res.status() === 404 && !/cyberjapandata\.gsi\.go\.jp\/xyz\/dem/.test(res.url())) run.errors.push('404: ' + res.url().slice(0, 200)); });
    await page.goto(`${BASE}/?manual=1&lat=35.0905&lon=136.8844&n=${n}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 90000 });
    // the ways are worked out a moment after the card
    await page.waitForFunction(() => document.querySelector('[data-route="s0"]'), { timeout: 60000 });
    if (pick) await page.evaluate(() => document.querySelector('[data-route="s0"]').click());
    await sleep(800);
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForFunction(() => document.getElementById('sim').classList.contains('active'), { timeout: 240000 });
    await sleep(2500);
    await page.evaluate(() => { document.getElementById('nav-hint').hidden = true; document.getElementById('toast').hidden = true; });
    const state = () => page.evaluate(() => ({
      on: document.getElementById('tg-route').checked, disabled: document.getElementById('tg-route').disabled,
      legend: !document.getElementById('route-legend').hidden,
      // only the end labels that are really shown, inside the window
      ends: [...document.querySelectorAll('#stage3d .lbl.route-end')].filter((e) => { if (e.style.display === 'none') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }).map((e) => e.textContent),
    }));
    // how many points of the band read "under water" (the same 5-tap rule as the shader: any w > 5 cm)
    const wetPoints = () => page.evaluate(async () => {
      const a = window.__t.app, rt = a.routes3d;
      if (!rt || !rt.ready) return null;
      const buf = await window.__t.renderer.getArrayBufferAsync(a.solver.buffers.R.value);
      const R = new Float32Array(buf.buffer ?? buf, buf.byteOffset ?? 0, (buf.byteLength) / 4);
      const N = Math.round(Math.sqrt(R.length / 4));
      let wet = 0;
      for (let v = 0; v < rt.cells.length; v += 2) {
        const k = rt.cells[v];
        const w = Math.max(...[k, k + 1, k - 1, k + N, k - N].map((q) => R[q * 4 + 3] || 0));
        if (w - rt.base[v] > 0.05) wet++; // the water already there at the start does not count (as in the shader)
      }
      return { wet, all: rt.cells.length / 2 };
    });
    // the band waits for one reading of the starting water (a couple of frames)
    await page.waitForFunction(() => window.__t.app?.routes3d?.ready, { timeout: 30000 }).catch(() => run.errors.push('routes3d not ready'));
    run.first = await state();
    if (pick) {
      run.checks.autoOn = run.first.on && run.first.legend;
      // before the wave: nothing of the way may read as under water (rivers / harbour basins under bridges included)
      run.wetBefore = await wetPoints();
      run.checks.dryBeforeWave = !!run.wetBefore && run.wetBefore.wet === 0;
    } else {
      run.checks.offByDefault = !run.first.on && !run.first.legend && !run.first.disabled;
      await page.evaluate(() => { const c = document.getElementById('tg-route'); c.checked = true; c.dispatchEvent(new Event('change')); });
      await sleep(300);
      run.after = await state();
      run.checks.canTurnOn = run.after.on && run.after.legend;
    }
    // PC: the end label must be on screen. Phone (narrow view): the end may lie outside the first view — then the
    // label must at least exist (it shows when the view turns there); the 【指定】 sign on the building stays visible
    run.endsInDom = await page.evaluate(() => document.querySelectorAll('#stage3d .lbl.route-end').length);
    run.checks.endLabels = dev === 'PC' ? (run.after ?? run.first).ends.length >= 1 : run.endsInDom >= 1;
    run.free = await freeArea(page);
    run.pinFree = await pinFree(page);
    run.checks.pinVisible = run.pinFree;
    if (dev === 'スマホ') run.checks.free55 = run.free >= 55;
    await page.screenshot({ path: path.join(OUT, `${dev}_${pick ? 'Aを選んで' : '選ばずに'}_はじめ.jpg`), type: 'jpeg', quality: 86 });
    if (pick) {
      // run the same computation forward until the water has reached the point, then look at the ways
      const stepTo = async (cond, max = 4000) => {
        for (let k = 0; k < max; k++) {
          const s = await page.evaluate(async () => { const a = window.__t.app; await window.__t.advance(0.25, 30); await new Promise((r) => setTimeout(r, 30)); const q = a.solver.probe.q; return { t: a.lead.time, h: q ? q[0] : 0 }; });
          if (cond(s)) return s;
        }
        return null;
      };
      const b = await stepTo((s) => s.h > 0.01);
      await stepTo((s) => s.t >= (b?.t ?? 0) + 60);
      for (const v of ['over', 'pin']) {
        await page.evaluate(async (view) => { const a = window.__t.app; a.setView(view, true); for (let i = 0; i < 10; i++) { a.frame(0.016); await new Promise((r) => setTimeout(r, 30)); } }, v);
        await sleep(400);
        await page.screenshot({ path: path.join(OUT, `${dev}_Aを選んで_水が着いた後_${v === 'over' ? '地点と海' : 'ここの近く'}.jpg`), type: 'jpeg', quality: 86 });
      }
      run.arrivedAt = b ? Math.round(b.t) : null;
      run.checks.waterArrived = !!b;
      run.wetAfter = await wetPoints();
      run.checks.wetAfterArrival = !!run.wetAfter && run.wetAfter.wet > 0;
    }
    run.checks.noErrors = run.errors.length === 0;
    run.pass = Object.values(run.checks).every(Boolean);
    report.runs.push(run);
    console.log(dev, pick ? 'Aを選んで' : '選ばずに', run.pass ? '合格' : '不合格', JSON.stringify({ checks: run.checks, free: run.free, ends: (run.after ?? run.first).ends, endsInDom: run.endsInDom, wetBefore: run.wetBefore, wetAfter: run.wetAfter, arrivedAt: run.arrivedAt, errors: run.errors }));
    await browser.close();
  }
}
fs.writeFileSync(path.join(OUT, 'route3d_report.json'), JSON.stringify(report, null, 2));
process.exit(report.runs.every((r) => r.pass) ? 0 : 1);
