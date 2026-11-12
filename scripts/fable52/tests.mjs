// ソルバーの試験（/test.html・src/test/tests.js の T1〜T7）を、ヘッドレス Chrome（WebGPU）で走らせて結果を出す。
//   node scripts/fable52/tests.mjs [出力のJSON]      VERIFY_BASE=http://127.0.0.1:5341  PUPPETEER_CORE_DIR=…
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5341';
const puppeteer = createRequire(path.join(process.env.PUPPETEER_CORE_DIR || process.cwd(), 'package.json'))('puppeteer-core');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 900000, args: ['--enable-unsafe-webgpu', '--hide-scrollbars'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
await page.goto(`${BASE}/test.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__results, { timeout: 900000 });
const res = await page.evaluate(() => window.__results);
await browser.close();
if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(res, null, 2));
let ok = !res.error && !errors.length;
for (const [k, v] of Object.entries(res)) { if (v && typeof v === 'object' && 'pass' in v) { console.log(k, v.pass ? '合格' : '不合格', k === 'T7_openEdge' ? JSON.stringify(v) : ''); ok &&= v.pass; } else console.log(k, JSON.stringify(v).slice(0, 300)); }
if (errors.length) console.log('errors', errors);
process.exit(ok ? 0 : 1);
