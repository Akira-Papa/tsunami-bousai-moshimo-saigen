// 全カットをつないだ仮編集版（無音・2分50秒以内）を作る
//   node scripts/capture/assemble.mjs
// 順番と使う区間は ORDER で決める。カットの間は 0.4 秒のクロスフェード。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OUT_DIR, FPS } from './lib.mjs';

const LIMIT = 170; // 2分50秒
const XF = 0.4;
// 物語の順：地点を選ぶ → 街（PLATEAU建物）→ 避難候補 → 押し波 → 防潮壁を越える → 目線で水位上昇 → 木造家屋の流失
//            → ゼロメートル地帯 → 内陸（名古屋駅）→ 公式想定との比較（結果画面）
const ORDER = [
  { n: 1 },
  { n: 8 },
  { n: 10 },
  { n: 2 },
  { n: 3 },
  { n: 4 },
  { n: 9 },
  { n: 5 },
  { n: 6 },
  { n: 7 },
];

const manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'cuts.json'), 'utf8'));
const parts = ORDER.filter((o) => manifest[o.n]).map((o) => {
  const m = manifest[o.n];
  const start = o.start ?? 0;
  const seconds = Math.min(m.seconds - start, o.max ?? Infinity);
  return { n: o.n, file: path.join(OUT_DIR, m.file), start, seconds };
});
const missing = ORDER.filter((o) => !manifest[o.n]).map((o) => o.n);
if (missing.length) console.warn(`未撮影のカット：${missing.join(', ')}（つながずに進めます）`);
let total = parts.reduce((s, p) => s + p.seconds, 0) - XF * (parts.length - 1);
if (total > LIMIT) {
  // 長すぎるときは、各カットを同じ割合で後ろから詰める
  const k = (LIMIT - 0.5 + XF * (parts.length - 1)) / parts.reduce((s, p) => s + p.seconds, 0);
  for (const p of parts) p.seconds = Math.floor(p.seconds * k * FPS) / FPS;
  total = parts.reduce((s, p) => s + p.seconds, 0) - XF * (parts.length - 1);
}

const args = ['-y', '-loglevel', 'error'];
for (const p of parts) args.push('-ss', String(p.start), '-t', String(p.seconds), '-i', p.file);
const f = [];
parts.forEach((p, i) => f.push(`[${i}:v]fps=${FPS},settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[s${i}]`));
let last = 's0', acc = parts[0].seconds;
for (let i = 1; i < parts.length; i++) {
  const out = i === parts.length - 1 ? 'vx' : `x${i}`;
  f.push(`[${last}][s${i}]xfade=transition=fade:duration=${XF}:offset=${(acc - XF).toFixed(3)}[${out}]`);
  last = out; acc += parts[i].seconds - XF;
}
f.push(`[${last}]fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8[v]`);
const outFile = path.join(OUT_DIR, '仮編集_全カット_無音.mp4');
args.push('-filter_complex', f.join(';'), '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-r', String(FPS), '-movflags', '+faststart', outFile);
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (r.status !== 0) throw new Error('ffmpeg 失敗');
fs.writeFileSync(path.join(OUT_DIR, 'cuts_edit.json'), JSON.stringify({ file: path.basename(outFile), seconds: total, crossfade: XF, parts: parts.map(({ n, start, seconds }) => ({ n, start, seconds })) }, null, 2));
console.log(`→ ${path.basename(outFile)}（${total.toFixed(1)}秒・${parts.length}カット）`);
// カット一覧.md の仮編集欄を更新（run.mjs と同じ書式）
const md = path.join(OUT_DIR, 'カット一覧.md');
if (fs.existsSync(md)) {
  let s = fs.readFileSync(md, 'utf8');
  const block = [`仮編集版：\`${path.basename(outFile)}\`（${total.toFixed(1)}秒・無音。カットの間は${XF}秒のクロスフェード。順番と使った秒数は下の表）`, '', '| 順 | カット | 使った秒数 |', '|---|---|---|', ...parts.map((p, i) => `| ${i + 1} | ${p.n} | ${p.seconds.toFixed(1)} |`), ''].join('\n');
  s = s.replace(/(仮編集版：[\s\S]*?\n\n(\| 順[\s\S]*?\n\n)?)?(## 撮影で気づいたこと)/, `${block}\n$3`);
  fs.writeFileSync(md, s);
}
