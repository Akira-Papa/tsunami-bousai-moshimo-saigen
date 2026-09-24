// PLATEAU AWARD 2026 応募動画の素材を、実際の画面から撮影する（A7）
//
//   前提：dev サーバー（window.__t フックは dev 時のみ）
//     npx vite --host 127.0.0.1 --port 5361 --strictPort
//   撮影専用の puppeteer-core（リポジトリの依存には入れない）
//     npm i --prefix /path/to/dir puppeteer-core
//   実行
//     PUPPETEER_CORE_DIR=/path/to/dir node scripts/capture/run.mjs            # 全カット
//     PUPPETEER_CORE_DIR=/path/to/dir node scripts/capture/run.mjs 2 3 7      # 指定カットだけ撮り直す
//     … --hmr=block   # 最初から Vite のホットリロードを止めて撮る（既定は retake：リロードを検知して撮り直し、2回続いたら block）
//   その後、仮編集：node scripts/capture/assemble.mjs
//
//   出力：docs/award/video/footage/cutNN_*.mp4、cuts.json（撮影条件の記録）、カット一覧.md
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as L from './lib.mjs';

const args = process.argv.slice(2);
const only = new Set(args.filter((a) => /^\d+$/.test(a)).map(Number));
const hmrArg = (args.find((a) => a.startsWith('--hmr=')) ?? '--hmr=retake').slice(6);
const want = (n) => only.size === 0 || only.has(n);
const log = (...m) => console.log(...m);
const FPS_ = L.FPS;

const MANIFEST = path.join(L.OUT_DIR, 'cuts.json');
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
let gitHead = '';
try { gitHead = execSync('git rev-parse --short HEAD', { cwd: L.ROOT }).toString().trim() + (execSync('git status --porcelain src', { cwd: L.ROOT }).toString().trim() ? '（src に未コミットの変更あり）' : ''); } catch { /* no git */ }
const stamp = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

const PLACES = {
  garden: { name: '名古屋港 ガーデンふ頭（港区 港町）', q: 'lat=35.0905&lon=136.8844&auto=1&n=768&manual=1' },
  zenshin: { name: '港区 善進本町（海抜ゼロメートル地帯）', q: 'lat=35.1008&lon=136.8560&auto=1&n=768&manual=1' },
  station: { name: '名古屋駅（中村区 名駅一丁目・ネスト計算）', q: 'lat=35.1709&lon=136.8815&auto=1&n=768&manual=1' },
};

function save(n, file, enc, info) {
  // 別プロセスで並行して撮っていても消し合わないよう、書く直前に読み直す
  if (fs.existsSync(MANIFEST)) Object.assign(manifest, JSON.parse(fs.readFileSync(MANIFEST, 'utf8')));
  manifest[n] = { n, file: path.basename(file), seconds: Number(enc.seconds.toFixed(2)), frames: enc.frames, shotAt: stamp(), git: gitHead, ...info };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  writeList();
  log(`  → ${path.basename(file)}（${enc.seconds.toFixed(1)}秒）`);
}

function writeList() {
  const rows = Object.values(manifest).sort((a, b) => a.n - b.n);
  const md = [
    '# 動画素材 カット一覧（PLATEAU AWARD 2026 応募動画・A7）',
    '',
    '実際のアプリ画面（dev サーバー）をヘッドレス Chrome（WebGPU）で開き、`app.frame(1/30)` を1コマずつ回しながら `page.screenshot` で撮影した連番を、ffmpeg で 30fps の mp4（1920×1080・H.264・無音）にしたものです。',
    '地点選択（カット1）は地図のアニメーションが実時間で動く画面なので、ページの時計（performance.now・Date.now・requestAnimationFrame）を0.08倍に遅くして撮り、ページ時計のタイムスタンプで 30fps に並べ直しています（ヘッドレスではスクリーンショット1枚に0.2〜0.4秒かかり、実時間の録画では数fpsしか出ないため）。',
    'シミュレーションの早送り倍率は「動画1秒＝シミュレーション○秒」で、画面の時計（押し波の開始から）はシミュレーション時刻です。',
    '',
    '撮り直し：`PUPPETEER_CORE_DIR=<puppeteer-coreを入れた場所> node scripts/capture/run.mjs [カット番号…]` → `node scripts/capture/assemble.mjs`（詳細は `scripts/capture/README.md`）。',
    '',
    '| # | ファイル | 秒数 | 内容 | 撮影条件 |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.n} | \`${r.file}\` | ${r.seconds.toFixed(1)} | ${r.content} | ${r.cond}（撮影 ${r.shotAt}・コード ${r.git || '—'}） |`),
    '',
  ];
  const ef = path.join(L.OUT_DIR, 'cuts_edit.json');
  if (fs.existsSync(ef)) {
    const e = JSON.parse(fs.readFileSync(ef, 'utf8'));
    md.push(`仮編集版：\`${e.file}\`（${e.seconds.toFixed(1)}秒・無音。カットの間は${e.crossfade}秒のクロスフェード。順番と使った秒数は下の表）`, '', '| 順 | カット | 使った秒数 |', '|---|---|---|', ...e.parts.map((p, i) => `| ${i + 1} | ${p.n} | ${p.seconds.toFixed(1)} |`), '');
  }
  md.push(
    '## 撮影で気づいたこと・注意',
    '- UI の通知（トースト）は撮影時に非表示にしている（DOM の表示だけ切り替え。src は変更していない）。右下の fps 表示も隠している。',
    '- 早送りボタンの強調は、撮影に使った実際の倍率に最も近いボタンへ合わせている（×60 を超える倍率は「最速」を強調）。',
    '- `__t.shot` は広域表示で縞が出る既知の問題があるため使わず、ページのスクリーンショットで撮っている。',
    '- 撮影中に Vite のホットリロードが起きた場合は、そのカットを含む地点の撮影を最初からやり直す（2回続いたら HMR を止めて撮る）。',
    '- カット8の画面上端には、計算範囲の外（遠景）の青白いまだら模様が映る。気になる場合は編集で上を少しトリミングする。',
    '- 木造家屋の流失（カット9）と防潮壁の越流（カット3）の時刻は、GPUの非同期読み戻し（潮位の自動調整）の影響で撮るたびに数十秒〜1分ほど前後する。撮り直したら中身を確認する。',
    '- カット5の「線路の盛土で止まる」は docs/03 の検証結果に基づく説明。映像では水の先端が地点の約370m手前で止まる様子として見える（地点には届かない）。',
    '- カット6では駅の地点（ここ）は画面下の操作パネル付近にあり、水は届かない（公式の100m集約でも浸水セルなし）。',
    '',
  );
  fs.writeFileSync(path.join(L.OUT_DIR, 'カット一覧.md'), md.join('\n'));
}

const cam = {
  async orbit(page, view, i, n, opt) {
    if (!cam.base || cam.baseView !== view || i === 0) { cam.base = await L.viewPose(page, view); cam.baseView = view; }
    const p = L.orbitPose(cam.base, L.ease(n > 1 ? i / (n - 1) : 0), opt);
    await L.setPose(page, p.pos, p.target);
  },
};

async function tallHighlight(page, on) {
  await page.evaluate((on) => { const c = document.getElementById('tg-tall'); if (c && c.checked !== on) { c.checked = on; c.dispatchEvent(new Event('change')); } }, on);
}

async function depthColors(page, on) {
  await page.evaluate((on) => { const c = document.getElementById('tg-depth'); if (c.checked !== on) { c.checked = on; c.dispatchEvent(new Event('change')); } }, on);
}

// ── セッション（地点ごと）──
const sessions = [
  {
    cuts: [1],
    async run(browser, hmr) {
      const page = await L.openPage(browser, L.BASE + '/', { hmr, log, slowClock: true });
      await page.waitForSelector('#presets button');
      await L.sleep(7000); // 地図タイルの読み込み
      await page.__guard();
      // 見えるカーソル（ヘッドレスではマウスが描かれないため、DOM の矢印を重ねる）
      await page.evaluate(() => {
        const c = document.createElement('div');
        c.id = '__cap_cursor';
        c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.5 21.5 L14.2 20.3 L11.3 13.8 L17.5 13.8 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, pointerEvents: 'none', transform: 'translate(1180px,620px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' });
        document.body.appendChild(c);
      });
      const center = async (sel, text) => page.evaluate(({ sel, text }) => {
        const el = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim() === text);
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, vis: r.bottom < innerHeight && r.top > 0 };
      }, { sel, text });
      // 台本（仮想時間の秒）：待つ → プリセットへ → 押す → 初期値が入る → 「この地点で再現する」へ → 押す → 読み込み画面
      const P0 = { x: 1180, y: 620 };
      const pPreset = await center('#presets button', 'ガーデンふ頭');
      let pGo = null;
      const done = new Set();
      const once = async (k, fn) => { if (!done.has(k)) { done.add(k); await fn(); } };
      const glideAt = (vt, t0, t1, a, b) => { const e = L.ease(Math.min(1, Math.max(0, (vt - t0) / (t1 - t0)))); return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }; };
      // ページの時計を 0.08 倍に遅くして撮る（マウスは本物の入力なので、ボタンのホバー表示も出る）
      await page.evaluate(() => addEventListener('mousemove', (e) => { document.getElementById('__cap_cursor').style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true));
      await page.mouse.move(P0.x, P0.y);
      const click = async (q) => { await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.up(); };
      const dir = await L.recordSlow(page, 'cut01', {
        duration: 12.6, log,
        async step(vt) {
          if (vt < 3.0) { const q = glideAt(vt, 1.5, 2.8, P0, pPreset); await page.mouse.move(q.x, q.y); }
          if (vt >= 3.1) await once('clickPreset', () => click(pPreset));
          // 選んだ地点の設定欄（海の高さ・潮位・防潮壁）が見えるところまでカードを滑らかにスクロール（ページ時計で進める）
          if (vt >= 7.2 && vt < 8.3) await page.evaluate((e) => { const c = document.querySelector('.pick-card'); c.__y0 ??= c.scrollTop; const s = document.getElementById('sel'); c.__y1 ??= Math.min(c.scrollHeight - c.clientHeight, s.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 24); c.scrollTop = c.__y0 + (c.__y1 - c.__y0) * e; }, L.ease(Math.min(1, (vt - 7.2) / 1.0)));
          if (vt >= 8.3) {
            await once('goPos', async () => { pGo = await center('#go'); });
            if (vt < 9.6) { const q = glideAt(vt, 8.4, 9.4, pPreset, pGo); await page.mouse.move(q.x, q.y); }
          }
          if (vt >= 9.8) await once('clickGo', () => click(pGo));
        },
      });
      await page.__guard();
      const out = path.join(L.OUT_DIR, 'cut01_地点選択.mp4');
      save(1, out, L.encode(dir, out), {
        content: '地点選択画面。名古屋港から始まる地図で、プリセット「ガーデンふ頭」を押す → 地図が飛び、海の高さ5.0m・満潮T.P.+1.2m・防潮壁T.P.+4.6mの初期値と出典が入る → 設定欄までカードをスクロール → 「この地点で再現する」を押す → 読み込み画面 → 最後の約1秒で再現画面が開いて再生が始まる',
        cond: '`/`（パラメータなし）・ページの時計を0.08倍に遅くして撮り、30fpsへ並べ直し（再生は実時間と同じ速さ）・カーソルはDOMで描画',
      });
      await page.close();
    },
  },
  {
    cuts: [10, 2, 3, 4, 7],
    async run(browser, hmr) {
      const P = PLACES.garden;
      const page = await L.openPage(browser, `${L.BASE}/?${P.q}`, { hmr, log });
      await L.waitApp(page);
      await L.setUi(page);
      // cut 10：避難候補のハイライト（橙＝堅ろう・高い建物、緑＝指定緊急避難場所）と、HUD の最寄り3棟（計算開始前）
      if (want(10)) {
        const g = await page.evaluate(() => { const a = window.__t.app; return { x: a.pin.x, z: a.pin.z, y: a.pin.ground, d: [a.dir.x, a.dir.y] }; });
        const a0 = Math.atan2(-g.d[1], -g.d[0]) - 1.25;
        const dir = await L.recordSim(page, 'cut10', { frames: 360, play: false, log, perFrame: async (i, n) => {
          const t = L.ease(i / (n - 1)), a = a0 + 0.75 * t, r = 330 - 50 * t, h = 235 - 35 * t;
          await L.setPose(page, [g.x + Math.cos(a) * r, g.y + h, g.z + Math.sin(a) * r], [g.x, g.y, g.z]);
        } });
        const out = path.join(L.OUT_DIR, 'cut10_ガーデンふ頭_避難候補ハイライト.mp4');
        save(10, out, L.encode(dir, out), { content: `${P.name}。計算を始める前に、地点（ここ）から300m以内の垂直避難の候補建物をハイライト（緑＝指定緊急避難場所〈津波〉、橙＝堅ろうで高さが水位＋2m以上の建物）。最寄り3棟に番号と距離のタグ、右のHUDに同じ3棟の一覧`, cond: '格子768²・計算開始前・地点のまわりを高い位置から約43°回り込みながら寄り' });
      }
      // cut 2：俯瞰、押し波が岸へ（4:30→9:30、×20）
      await L.fastForward(page, 270, { log });
      if (want(2)) {
        const dir = await L.recordSim(page, 'cut02', { frames: 450, speed: 20, maxSteps: 400, log, perFrame: (i, n) => cam.orbit(page, 'over', i, n, { dAz: 0.12, k0: 1.0, k1: 0.82 }) });
        const out = path.join(L.OUT_DIR, 'cut02_ガーデンふ頭_押し波_俯瞰.mp4');
        save(2, out, L.encode(dir, out), { content: `${P.name}。俯瞰視点で、海面が満潮から上がり、押し波が岸壁に寄せて左手の岸から陸へ越え始める（泡・流れの模様）`, cond: '格子768²・海の高さ5.0m・満潮+1.2m・防潮壁4.6m（越流で破壊）・押し波開始から 4:30→9:30・×20・俯瞰からゆっくり寄り＋回り込み（約7°）' });
      } else await L.fastForward(page, 570, { log });
      // cut 3：衝突視点、防潮壁を越えて壊れ始める（9:30→12:55、×20）
      if (want(3)) {
        const dir = await L.recordSim(page, 'cut03', { frames: 310, speed: 20, maxSteps: 400, log, perFrame: (i, n) => cam.orbit(page, 'impact', i, n, { dAz: -0.22, k0: 1.05, k1: 0.9 }) });
        const out = path.join(L.OUT_DIR, 'cut03_ガーデンふ頭_防潮壁越流_衝突視点.mp4');
        save(3, out, L.encode(dir, out), { content: `${P.name}。衝突視点で、防潮壁を越えた水が岸の建物の足もとへ流れ込み、越えられた防潮壁が壊れ始める（約12〜13分）`, cond: '同上・押し波開始から 9:30→12:55・×20・衝突視点から回り込み（約13°）' });
      } else await L.fastForward(page, 775, { log });
      // cut 4：目線視点、柱と人影、水位が上がる（12:55→17:25、×20）
      if (want(4)) {
        const dir = await L.recordSim(page, 'cut04', { frames: 405, speed: 20, maxSteps: 400, log, perFrame: (i) => (i === 0 ? L.viewPose(page, 'eye') : null) });
        const out = path.join(L.OUT_DIR, 'cut04_ガーデンふ頭_目線_水位上昇.mp4');
        save(4, out, L.encode(dir, out), { content: `${P.name}。目線（地面から1.6m）の視点で、1m目盛りの柱と170cmの人影のところへ水が来て、深さが0→約1mへ上がる（右上の「ここの深さ」も連動）`, cond: '同上・押し波開始から 12:55→17:25・×20・目線視点（固定）' });
      }
      // cut 7：最後まで進めると、アプリが自分で結果画面（公式想定との比較）を開く
      if (want(7)) {
        await L.fastForward(page, 99999, { log });
        await page.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 60000 });
        await L.sleep(800);
        // 結果カードを上から下までゆっくりスクロール（はじめ1.5秒と終わり2秒は止める）
        const H = await page.evaluate(() => { const c = document.querySelector('.result-card'); c.scrollTop = 0; return c.scrollHeight - c.clientHeight; });
        const frames = H > 40 ? 480 : 240;
        const dir = await L.recordSim(page, 'cut07', { frames, play: false, log, perFrame: async (i, n) => {
          await cam.orbit(page, 'over', i, n, { dAz: 0.1, k0: 1.0, k1: 0.95 });
          const t = Math.min(1, Math.max(0, (i / FPS_ - 1.5) / (n / FPS_ - 3.5)));
          await page.evaluate((y) => { document.querySelector('.result-card').scrollTop = y; }, Math.round(H * L.ease(t)));
        } });
        const out = path.join(L.OUT_DIR, 'cut07_結果画面_公式想定との比較.mp4');
        save(7, out, L.encode(dir, out), { content: `${P.name}の計算を最後（約39分）まで進めたときの結果画面。上から、「この再現（仮定）」と「内閣府2025想定（ケース01）」の比較（100m四方の最大・同じ物差し）→ 垂直避難の候補（最寄りの建物の一覧）→ 建物の位置での公式想定（100m集約）との比較 → 木造家屋の流失の棟数、の順にゆっくりスクロール`, cond: '同上・計算終了後に自動で開いた結果画面・はじめ1.5秒と終わり2秒は静止・背景は俯瞰でゆっくり回り込み' });
      }
      await page.close();
    },
  },
  {
    cuts: [9],
    async run(browser, hmr) {
      const P = PLACES.garden;
      const page = await L.openPage(browser, `${L.BASE}/?${P.q}`, { hmr, log });
      await L.waitApp(page);
      await L.setUi(page);
      // 木造家屋の流失：岸壁の南側（地点の南300m）から始まり西へ広がる。地点の南西約500mの住宅地では15〜19分に流される
      await L.fastForward(page, 900, { log });
      const C = [-560, 3, -390];
      const dir = await L.recordSim(page, 'cut09', { frames: 450, speed: 20, maxSteps: 400, log, perFrame: async (i, n) => {
        const t = L.ease(i / (n - 1)), k = 1.08 - 0.18 * t, a = -0.12 + 0.2 * t;
        const ox = 30 * Math.cos(a) - 150 * Math.sin(a), oz = 30 * Math.sin(a) + 150 * Math.cos(a);
        await L.setPose(page, [C[0] + ox * k, C[1] + 107 * k, C[2] + oz * k], C);
      } });
      const out = path.join(L.OUT_DIR, 'cut09_ガーデンふ頭_木造家屋の流失.mp4');
      save(9, out, L.encode(dir, out), { content: `${P.name}の南西約500mの住宅地。周りの浸水深が2mに達した木造（普通建物・構造は推定）の家が、次々に壁でなくなって消えていく（流失。低いがれきは水面の下）。高いRC造などは残る`, cond: '同上（別セッションで読み直し）・押し波開始から 15:00→20:00・×20・斜め上からゆっくり寄り＋回り込み' });
      await page.close();
    },
  },
  {
    cuts: [5],
    async run(browser, hmr) {
      const P = PLACES.zenshin;
      const page = await L.openPage(browser, `${L.BASE}/?${P.q}`, { hmr, log });
      await L.waitApp(page);
      await L.setUi(page);
      await depthColors(page, true);
      await L.fastForward(page, 630, { log });
      const dir = await L.recordSim(page, 'cut05', { frames: 570, speed: 60, maxSteps: 600, log, perFrame: (i, n) => cam.orbit(page, 'over', i, n, { dAz: 0.1, k0: 1.0, k1: 0.85 }) });
      const out = path.join(L.OUT_DIR, 'cut05_善進本町_ゼロメートル地帯_深さ色分け.mp4');
      const g = await page.evaluate(() => window.__t.app.solver.N);
      save(5, out, L.encode(dir, out), { content: `${P.name}。深さで色分けON。防潮壁を越えた水が運河をさかのぼって低い土地に広がり、線路の盛土のあたりで止まる（塗り＝この再現の深さ）`, cond: `格子${g}²・海の高さ5.0m・満潮+1.2m・防潮壁4.6m（越流で破壊）・押し波開始から 10:30→29:30・×60・俯瞰からゆっくり寄り` });
      await page.close();
    },
  },
  {
    cuts: [8, 6],
    async run(browser, hmr) {
      const P = PLACES.station;
      const page = await L.openPage(browser, `${L.BASE}/?${P.q}`, { hmr, log });
      await L.waitApp(page);
      // cut 8：PLATEAU 建物のクローズアップ（計算を始める前・UIを隠す）
      if (want(8)) {
        await L.setUi(page, { clean: true });
        await tallHighlight(page, false); // 建物そのものを見せる（避難候補のハイライトはカット10）
        const dir = await L.recordSim(page, 'cut08', { frames: 360, play: false, log, perFrame: (i, n) => cam.orbit(page, 'over', i, n, { dAz: 0.6, k0: 1.45, k1: 1.05, dy0: 90, dy1: 40 }) });
        await tallHighlight(page, true);
        const out = path.join(L.OUT_DIR, 'cut08_名古屋駅_PLATEAU建物_3D.mp4');
        save(8, out, L.encode(dir, out), { content: `${P.name}の周り1.5km四方。PLATEAU（LOD1・実測の高さ）の建物を航空写真の上に立てた3D表示を、駅前の高層ビル群のまわりを回りながら寄って見せる（UIと避難候補のハイライトは隠している）`, cond: '計算開始前（水は静止）・既定の光・俯瞰より引いた位置から約34°回り込みながら寄り・HUD/操作パネル/上部バーと「高い建物（避難候補）」は非表示' });
      }
      // cut 6：広域視点、港から街へ広がる（3:00→60:00、×190）
      if (want(6)) {
        await L.setUi(page);
        await depthColors(page, true);
        await L.fastForward(page, 180, { log });
        const dir = await L.recordSim(page, 'cut06', { frames: 540, speed: 190, maxSteps: 400, log, perFrame: (i, n) => cam.orbit(page, 'wide', i, n, { dAz: 0.18, k0: 1.0, k1: 0.86 }) });
        const out = path.join(L.OUT_DIR, 'cut06_名古屋駅_広域_港から街へ.mp4');
        save(6, out, L.encode(dir, out), { content: `${P.name}。広域視点（14km四方・約14m格子）で、名古屋港の防潮壁を越えた水が港周辺のゼロメートル地帯へ広がっていく（深さで色分けON）。駅の地点には届かない`, cond: '二段ネスト（広域1024²＋地点周り768²）・海の高さ5.0m・満潮+1.2m・防潮壁4.6m・押し波開始から 3:00→60:00・約×190（画面の強調は「最速」）・広域視点からゆっくり寄り＋回り込み' });
      }
      await page.close();
    },
  },
];

fs.mkdirSync(L.OUT_DIR, { recursive: true });
const browser = await L.launch();
try {
  for (const s of sessions) {
    if (!s.cuts.some(want)) continue;
    log(`■ カット ${s.cuts.filter(want).join(', ')} を撮影`);
    let hmr = hmrArg, retakes = 0;
    for (;;) {
      try { await s.run(browser, hmr); break; } catch (e) {
        if (!(e instanceof L.Retake)) throw e;
        retakes++;
        log(`  撮り直し（${retakes}回目）：${e.message}`);
        for (const p of await browser.pages()) if (p.url() !== 'about:blank') await p.close().catch(() => {});
        if (retakes >= 2) hmr = 'block';
        if (retakes >= 5) throw e;
        await L.sleep(15000);
      }
    }
  }
} finally {
  await browser.close();
}
writeList();
log('完了');
