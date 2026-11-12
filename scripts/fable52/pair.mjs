// 2枚の画像を「直す前｜直した後」に並べた1枚にする。
//   node scripts/fable52/pair.mjs <出力.jpg> <題> <左の見出し> <左の画像> <右の見出し> <右の画像> [1枚の幅px=860]
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const [,, out, title, capA, a, capB, b, w = '860'] = process.argv;
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#fff;font-family:"Hiragino Sans",sans-serif;color:#14191f;width:max-content}h1{font-size:22px;margin:0 0 12px}.row{display:flex;gap:20px}figure{margin:0}figcaption{font-size:17px;font-weight:700;padding:6px 10px;margin-bottom:6px;border-radius:6px}.b figcaption{background:#e3e7eb}.a figcaption{background:#0b5cab;color:#fff}img{display:block;width:${w}px;border:1px solid #8996a2}</style><h1>${title}</h1><div class="row"><figure class="b"><figcaption>${capA}</figcaption><img src="${pathToFileURL(path.resolve(a)).href}"></figure><figure class="a"><figcaption>${capB}</figcaption><img src="${pathToFileURL(path.resolve(b)).href}"></figure></div>`;
const tmp = path.resolve(out + '.html'); fs.writeFileSync(tmp, html);
const br = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files'] });
const pg = await br.newPage(); await pg.setViewport({ width: 1000, height: 800 }); await pg.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
await (await pg.$('body')).screenshot({ path: out, type: 'jpeg', quality: 84 }); await br.close(); fs.unlinkSync(tmp);
