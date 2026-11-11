// 「直す前｜直した後」を1枚に並べた画像を作る（uiux-shots.mjs の before_*.png と after_*.png から）。
//   node scripts/fable52/uiux-pairs.mjs <raw のフォルダ> <出力フォルダ>     PUPPETEER_CORE_DIR=…
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const RAW = path.resolve(process.argv[2] || 'docs/fable52/uiux/raw');
const OUT = path.resolve(process.argv[3] || 'docs/fable52/uiux');
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const SCENES = [
  ['1pick', '1_はじめの画面'], ['2card', '2_場所を選んだ直後'], ['3card_more', '3_カードの続き'], ['4sim_start', '4_3Dのはじめ（逃げ道Aを選んで）'],
  ['5sim_arrived', '5_3D_水が着いた後'], ['6sim_disp', '6_3D_表示を開く'], ['7result', '7_結果'],
];
const m = (label) => { try { return JSON.parse(fs.readFileSync(path.join(RAW, `uiux_${label}.json`), 'utf8')); } catch { return null; } };
const before = m('before'), after = m('after');
const stat = (rep, dev, tag) => { const r = rep?.runs.find((x) => x.dev === dev)?.m?.[tag]; return r ? `見えている文字 ${r.chars}字（うち14px未満 ${r.smallChars}字）` : ''; };
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--hide-scrollbars', '--allow-file-access-from-files'] });
const page = await browser.newPage();
const html = (dev, tag, title) => {
  const w = dev === 'PC' ? 860 : 390;
  const img = (label) => pathToFileURL(path.join(RAW, `${label}_${dev}_${tag}.png`)).href;
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:20px;background:#fff;font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#14191f;width:max-content}
    h1{font-size:22px;margin:0 0 12px} .row{display:flex;gap:20px;align-items:flex-start}
    figure{margin:0} figcaption{font-size:17px;font-weight:700;padding:6px 10px;margin-bottom:6px;border-radius:6px}
    .b figcaption{background:#e3e7eb} .a figcaption{background:#0b5cab;color:#fff} small{display:block;font-weight:400;font-size:14px}
    img{display:block;width:${w}px;border:1px solid #8996a2}
  </style><h1>${title.replace(/^\d_/, '')}（${dev === 'PC' ? 'PC幅 1440×900' : 'スマホ幅 390×844'}）</h1><div class="row">
    <figure class="b"><figcaption>直す前<small>${stat(before, dev, tag)}</small></figcaption><img src="${img('before')}"></figure>
    <figure class="a"><figcaption>直した後<small>${stat(after, dev, tag)}</small></figcaption><img src="${img('after')}"></figure>
  </div>`;
};
for (const dev of ['PC', 'SP']) for (const [tag, title] of SCENES) {
  if (!fs.existsSync(path.join(RAW, `after_${dev}_${tag}.png`)) || !fs.existsSync(path.join(RAW, `before_${dev}_${tag}.png`))) continue;
  const tmp = path.join(RAW, `_pair_${dev}_${tag}.html`);
  fs.writeFileSync(tmp, html(dev, tag, title));
  await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  const el = await page.$('body');
  await el.screenshot({ path: path.join(OUT, `${dev === 'PC' ? 'PC' : 'スマホ'}_${title}_直す前と後.jpg`), type: 'jpeg', quality: 84 });
  fs.unlinkSync(tmp);
}
await browser.close();
console.log('done');
