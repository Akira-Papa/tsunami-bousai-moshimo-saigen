// 津波防災もしも再現 — app flow: pick a point → build the town → GPU tsunami → compare
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createPicker } from './picker.js';
import { planDomain, tsunamiHeightAt } from './data/plan.js';
import { buildRegion, buildOuterRegion } from './data/region.js';
import { syntheticRegion } from './data/synthetic.js';
import { officialAt } from './data/official.js';
import { makeFrame } from './data/geo.js';
import { createSolver } from './sim/swe.js';
import { createWorld } from './render/world.js';
import { createPin, createSeaMarker } from './render/markers.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const show = (id) => { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id)); };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmall = Math.min(innerWidth, innerHeight) < 700;
if (isSmall) $('quality').value = '512';

// ── WebGPU gate (D10) ──
let adapterOk = false;
try { adapterOk = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { adapterOk = false; }
if (!adapterOk) { show('nogpu'); throw new Error('WebGPU not available'); }

// ─────────────────────────────────────────────────────────────
//  1. pick
// ─────────────────────────────────────────────────────────────
const sel = { lat: null, lon: null, plan: null, info: null, token: 0 };
const picker = createPicker({ onPick });
async function onPick(lat, lon) {
  const token = ++sel.token;
  Object.assign(sel, { lat, lon, plan: null, info: null });
  $('sel').hidden = false;
  $('sel-name').textContent = '地点を調べています…';
  $('sel-sub').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $('sel-warn').hidden = true;
  $('sel-warn').className = 'warn';
  $('sel-zero').hidden = true;
  $('go').disabled = true;
  $('Hsrc').textContent = '';
  const [info, plan] = await Promise.all([
    tsunamiHeightAt(lat, lon).catch(() => null),
    planDomain(lat, lon).catch((e) => ({ ok: false, reason: 'error', error: e })),
  ]);
  if (token !== sel.token) return;
  sel.info = info; sel.plan = plan;
  applyDefaults(regionDefaults(lat, lon, info?.code));
  $('sel-name').textContent = info?.name ? `${info.name}${info.place ? ' ' + info.place : ''}` : '選んだ地点';
  const elev = plan?.here;
  $('sel-sub').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}${Number.isFinite(elev) ? `　地盤の標高 約${elev.toFixed(1)}m（10mメッシュの目安）` : ''}`;
  if (info?.H != null && info.borrowed) {
    setH(info.H);
    $('Hsrc').textContent = `この地点の市区町村は内閣府（2025）の津波高一覧にないため、近くの「${info.borrowed}」の海岸最大津波高 ${info.H}m を初期値にしています（代用値）。スライダーで変えられます。`;
  } else if (info?.H != null) {
    setH(info.H);
    $('Hsrc').textContent = `初期値は内閣府（2025）南海トラフ巨大地震の「${info.name}」海岸最大津波高 ${info.H}m（11ケースの最大・満潮位と地殻変動を考慮）。スライダーで変えられます。`;
  } else {
    setH(5);
    $('Hsrc').textContent = 'この市区町村は内閣府（2025）の南海トラフ津波高一覧に含まれていません。仮に 5m で試せます（公式の値ではありません）。';
  }
  const zero = $('sel-zero');
  if (Number.isFinite(elev) && elev < 0.5) {
    zero.hidden = false;
    zero.innerHTML = elev < 0 ? `この土地は海面より <b>${Math.abs(elev).toFixed(1)}m 低い</b> 海抜ゼロメートル地帯です。堤防を越えた水は、低い土地へ流れ込み、自然には引きません。` : `この土地の標高は <b>${elev.toFixed(1)}m</b>。ほぼ海面と同じ高さです。`;
  } else zero.hidden = true;
  const w = $('sel-warn');
  if (!plan?.ok) {
    w.hidden = false;
    w.textContent = plan?.reason === 'far'
      ? `開けた海から約${(plan.distance / 1000).toFixed(1)}km離れています。広域の計算範囲（最大20km四方）にも海が入らないため、この地点には今回の仮定の津波は届きません。`
      : plan?.reason === 'no-sea' ? '周囲16km以内に開けた海が見つかりませんでした。この地点に海からの津波が届くことは考えにくい場所です。'
        : '地形データを取得できませんでした。通信を確認するか、URLに ?demo=1 を付けると合成の街で試せます。';
    return;
  }
  $('go').disabled = false;
  // outline of the simulated square(s)
  const sq = (c, L) => { const f = makeFrame(c.lat, c.lon), h = L / 2; return [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, z]) => { const p = f.toLatLon(x, z); return [p.lon, p.lat]; }); };
  try { picker.showSquare(sq(plan.center, plan.L), plan.mode === 'nest' ? sq(plan.outer.center, plan.outer.L) : null); } catch (e) { console.warn(e); }
  if (plan.mode === 'nest') {
    w.hidden = false;
    w.className = 'info';
    w.textContent = `開けた海から約${(plan.distance / 1000).toFixed(1)}km。海から街への津波の広がりを広域（${(plan.outer.L / 1000).toFixed(1)}km四方・約${Math.round(plan.outer.L / 1024)}m格子）で計算し、この地点の周り1.5km四方を建物ごと（約2m格子）詳しく計算します。`;
  } else w.className = 'warn';
}
// initial tide / seawall defaults by region (primary sources, see docs/04):
//  名古屋港: 朔望平均満潮位 N.P.+2.61m = T.P.+1.20m（名古屋港管理組合「名古屋港の潮位」、愛知県 解説書 表-2）
//            防潮壁 天白川河口〜庄内川河口 26.4km、天端 N.P.+6.0〜6.5m = T.P.+4.6〜5.1m（名古屋港管理組合「名古屋港の防災」）
//  愛知県の他港: 初期潮位 T.P.+1.0m（愛知県 解説書 表-2, 6港平均）
function regionDefaults(lat, lon, code) {
  // the 26.4 km seawall runs 天白川河口〜庄内川河口 = the coastal wards of Nagoya city only
  // (東海市・知多市 are also in the port area but outside that line → no confirmed crest there)
  const c = String(code ?? '');
  // inland Nagoya wards (中村区の名古屋駅 など) are reached only across that same port seawall → same defaults
  const nagoyaPort = c.startsWith('231') || (!c && lat > 35.055 && lat < 35.20 && lon > 136.80 && lon < 136.98);
  if (nagoyaPort) return {
    tide: 1.2, levee: true, crest: 4.6,
    tideSrc: '名古屋港の朔望平均満潮位 N.P.+2.61m＝T.P.+1.2m（名古屋港管理組合・愛知県の津波浸水想定と同じ初期潮位）。',
    crestSrc: '名古屋港の防潮壁（天白川河口〜庄内川河口 26.4km）の天端 N.P.+6.0〜6.5m＝T.P.+4.6〜5.1m のうち低いほう（名古屋港管理組合）。',
  };
  if (String(code ?? '').startsWith('23')) return {
    tide: 1.0, levee: false, crest: 4.0,
    tideSrc: '愛知県の津波浸水想定で名古屋港以外に使われた初期潮位 T.P.+1.0m（6港平均）。',
    crestSrc: 'この地域の防潮壁の高さは確認できていません。入れる場合は仮の値です。',
  };
  return {
    tide: 0, levee: false, crest: 4.0,
    tideSrc: 'この地域の満潮位は確認できていません（T.P.0mから開始）。公式想定は満潮位から計算しています。',
    crestSrc: 'この地域の防潮壁の高さは確認できていません。入れる場合は仮の値です。',
  };
}
function applyDefaults(d) {
  $('tide').value = d.tide; $('tideOut').textContent = `T.P.+${d.tide.toFixed(1)}m`; $('tideSrc').textContent = d.tideSrc;
  $('levee').checked = d.levee; $('crest').value = d.crest; $('crestOut').textContent = `T.P.+${d.crest.toFixed(1)}m`; $('crestSrc').textContent = d.crestSrc;
  syncLevee();
}
function syncLevee() { const on = $('levee').checked; $('crest').disabled = !on; $('breach').disabled = !on; }
$('tide').addEventListener('input', (e) => { $('tideOut').textContent = `T.P.+${Number(e.target.value).toFixed(1)}m`; });
$('crest').addEventListener('input', (e) => { $('crestOut').textContent = `T.P.+${Number(e.target.value).toFixed(1)}m`; });
$('levee').addEventListener('change', syncLevee);

function setH(v) { $('H').value = v; $('Hout').textContent = Number(v).toFixed(1); }
$('H').addEventListener('input', (e) => { $('Hout').textContent = Number(e.target.value).toFixed(1); });

// ─────────────────────────────────────────────────────────────
//  2. renderer (created once, reused per town)
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGPURenderer({ antialias: true });
const MAX_PIXELS = 3.6e6;
let prScale = 1;
const basePR = () => Math.max(0.75, Math.min(devicePixelRatio, 2, Math.sqrt(MAX_PIXELS / (innerWidth * innerHeight))));
renderer.setPixelRatio(basePR());
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('stage3d').appendChild(renderer.domElement);
await renderer.init();
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
$('stage3d').appendChild(labels.domElement);

let app = null; // current town

$('go').addEventListener('click', () => start({
  lat: sel.lat, lon: sel.lon, plan: sel.plan, info: sel.info, H: Number($('H').value), N: Number($('quality').value),
  tide: Number($('tide').value), levee: { enabled: $('levee').checked, crest: Number($('crest').value) }, breach: $('breach').checked,
}));
$('load-cancel').addEventListener('click', () => { loadAbort = true; gen++; show('pick'); picker.resize(); });
$('back').addEventListener('click', () => { stopApp(); show('pick'); picker.resize(); });
let loadAbort = false;
let gen = 0; // bumps on every start/cancel so a stale loader never installs its town

function stage(k, msg, frac) {
  const order = ['plan', 'data', 'grid', 'gpu'];
  const idx = order.indexOf(k);
  document.querySelectorAll('#stages li').forEach((li, i) => { li.classList.toggle('on', i === idx); li.classList.toggle('done', i < idx); });
  if (msg) $('load-msg').textContent = msg;
  if (frac !== undefined) $('load-bar').style.width = `${Math.round(frac * 100)}%`;
}

async function start(o) {
  const my = ++gen;
  stopApp();
  loadAbort = false;
  show('load');
  $('load-title').textContent = o.demo ? '合成の港町（オフライン用）' : (o.info?.name || '選んだ地点');
  let region;
  try {
    if (o.demo) {
      stage('grid', '合成の港町を作っています…', 0.5);
      region = syntheticRegion(o.N >= 768 ? 640 : 512, 1200);
      o.pointLocal = { x: -60, z: 60 };
      o.H = o.H || 8;
    } else {
      stage('data', '地形・建物・航空写真を読み込んでいます…', 0.05);
      // keep the chosen cell size when the square has to grow (inland points): N ∝ L, capped for the GPU
      const dx0 = 1500 / o.N;
      o.N = Math.min(1280, Math.max(o.N, Math.ceil(o.plan.L / dx0 / 64) * 64));
      const nested = o.plan.mode === 'nest';
      let fi = 0, fo = 0;
      const upd = (m) => stage('data', m, 0.05 + (nested ? (fi + fo) / 2 : fi) * 0.7);
      const innerP = buildRegion({
        N: o.N, L: o.plan.L, center: o.plan.center, photoSize: o.N >= 1024 ? 4096 : 3072, levee: o.levee, noSurroundings: nested,
        onProgress: (m, f) => { fi = f; upd(m); },
      });
      // wide square: ~10 m cells, one-way nested around the detailed square
      const outerP = nested ? buildOuterRegion({
        N: o.N >= 768 ? 1024 : 768, L: o.plan.outer.L, center: o.plan.outer.center, levee: o.levee,
        onProgress: (f) => { fo = f; upd('海から街までの広域の地形を読み込んでいます…'); },
      }) : null;
      [region, o.outerRegion] = await Promise.all([innerP, outerP]);
      o.pointLocal = o.plan.pointLocal;
    }
    if (loadAbort || my !== gen) return;
    stage('gpu', 'GPUの計算とシェーダーを準備しています…（初回は十数秒かかることがあります）', 0.8);
    await new Promise((r) => setTimeout(r, 30));
    const made = await createApp(region, o);
    if (loadAbort || my !== gen) { made.dispose(); return; }
    app = made;
    stage('gpu', 'まもなく始まります…', 1);
    show('sim');
    onResize();
    app.begin();
  } catch (e) {
    console.error(e);
    $('load-msg').textContent = `読み込みに失敗しました：${e.message}。?demo=1 を付けると合成の街で試せます。`;
  }
}

function stopApp() {
  if (!app) return;
  renderer.setAnimationLoop(null);
  app.dispose();
  app = null;
}

// ─────────────────────────────────────────────────────────────
//  3. simulation app
// ─────────────────────────────────────────────────────────────
async function createApp(region, o) {
  const { N, L, dx } = region;
  const H = o.H;
  // nested run: the wide solver makes the wave; the detailed one follows it along all four edges
  const oreg = o.outerRegion ?? null;
  const outerSolver = oreg ? createSolver(renderer, oreg, { H, tide: o.tide ?? 0, breach: o.breach ?? true }) : null;
  if (outerSolver) outerSolver.wave.hold = 3600; // inland points: the flood keeps spreading while the sea stays high (≈ 90 min run)
  const innerOffset = o.plan?.outer?.innerOffset ?? { x: 0, z: 0 };
  const solver = createSolver(renderer, region, {
    H, tide: o.tide ?? 0, breach: o.breach ?? true,
    ...(outerSolver ? { nest: { solver: outerSolver, offset: innerOffset }, calibrate: false } : {}),
  });
  if (outerSolver) solver.wave.hold = outerSolver.wave.hold;
  const world = createWorld(renderer, region, solver, outerSolver ? { outer: { region: oreg, solver: outerSolver, offset: { x: -innerOffset.x, z: -innerOffset.z } } } : {});
  // the wide solver watches for its flood front around the detailed square (sleep the fine grid until then)
  if (outerSolver) outerSolver.setPin((innerOffset.x + oreg.L / 2) / oreg.dx - 0.5, (innerOffset.z + oreg.L / 2) / oreg.dx - 0.5);
  const lead = outerSolver ?? solver; // the solver whose clock and wave drive the run
  const { scene, camera } = world;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 3;
  controls.maxDistance = Math.max(L * 3, (oreg?.L ?? 0) * 1.5);

  // the point: nearest open (non-wall) cell to what was picked
  const cellOf = (x, z) => [Math.min(N - 1, Math.max(0, Math.floor((x + L / 2) / dx))), Math.min(N - 1, Math.max(0, Math.floor((z + L / 2) / dx)))];
  let [pi, pj] = cellOf(o.pointLocal.x, o.pointLocal.z);
  const isWall = (i, j) => region.bldH[j * N + i] > 0;
  outer: for (let r = 0; r < 40 && isWall(pi, pj); r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const a = pi + di, b = pj + dj;
      if (a >= 0 && b >= 0 && a < N && b < N && !isWall(a, b)) { pi = a; pj = b; break outer; }
    }
  }
  const pinK = pj * N + pi;
  const [pi0, pj0] = cellOf(o.pointLocal.x, o.pointLocal.z);
  const moved = Math.hypot(pi - pi0, pj - pj0) * dx;
  const pinX = -L / 2 + (pi + 0.5) * dx, pinZ = -L / 2 + (pj + 0.5) * dx;
  const pinGround = region.bed[pinK];
  const pin = createPin(pinGround, Math.max(6, H * 1.1 - Math.max(0, pinGround)), H);
  pin.group.position.set(pinX, pinGround, pinZ);
  scene.add(pin.group);

  // sea direction & coastal marker: walk from the point toward the nearest sea cell
  let seaK = -1, best = Infinity;
  for (let k = 0; k < N * N; k++) {
    if (!region.sea[k] || region.dist[k] < 25) continue;
    const x = -L / 2 + ((k % N) + 0.5) * dx, z = -L / 2 + (((k / N) | 0) + 0.5) * dx;
    const d = Math.hypot(x - pinX, z - pinZ);
    if (d < best) { best = d; seaK = k; }
  }
  // nested: the open sea is outside the detailed square — use the planner's direction and distance
  const far = o.plan?.mode === 'nest';
  const seaX = far ? pinX + o.plan.dir.x * o.plan.distance : seaK >= 0 ? -L / 2 + ((seaK % N) + 0.5) * dx : pinX;
  const seaZ = far ? pinZ + o.plan.dir.z * o.plan.distance : seaK >= 0 ? -L / 2 + (((seaK / N) | 0) + 0.5) * dx : pinZ + 200;
  const dir = new THREE.Vector2(seaX - pinX, seaZ - pinZ).normalize();
  const seaMk = createSeaMarker(far ? -8 : seaK >= 0 ? region.bed[seaK] : -3, H);
  seaMk.group.position.set(seaX, 0, seaZ);
  scene.add(seaMk.group);

  // building for the "衝突" view: tall enough and closest to the coast marker
  let impactBuilding = null, ib = Infinity;
  for (const b of region.buildings) {
    if (b.height < 5 || b.cells < 20) continue;
    const d = Math.hypot(b.cx - seaX, b.cz - seaZ);
    if (d < ib) { ib = d; impactBuilding = b; }
  }
  const official = region.official;
  const offCell = officialAt(official, pinX, pinZ);

  // HUD static bits
  $('t-name').textContent = o.demo ? '合成の港町（デモ）' : (o.info?.name ? `${o.info.name}${o.info.place ? ' ' + o.info.place : ''}` : '選んだ地点');
  $('t-h').textContent = `海の高さ${H.toFixed(1)}m（仮定）${(o.tide ?? 0) > 0 ? `・満潮+${o.tide.toFixed(1)}` : ''}${region.leveeCells ? `・防潮壁${o.levee.crest.toFixed(1)}m` : ''}`;
  $('t-h').title = `海の高さ ${H.toFixed(1)}m（T.P.・仮定）／はじめの潮位 T.P.+${(o.tide ?? 0).toFixed(1)}m${region.leveeCells ? `／防潮壁 天端 T.P.+${o.levee.crest.toFixed(1)}m・${o.breach ? '越流したら破壊' : '壊れない'}` : '／防潮壁なし'}`;
  solver.setPin(pi, pj);
  $('h-gnd').textContent = `${pinGround >= 0 ? '' : '−'}${Math.abs(pinGround).toFixed(1)}m${pinGround < 0 ? '（海面より低い）' : ''}`;
  $('h-gnd').title = moved > 3 ? `建物を避けて約${Math.round(moved)}m先の地面に柱を立てました（5mメッシュの標高）` : '5mメッシュの標高';
  $('h-note').textContent = moved > 3 ? `建物の中を避け、約${Math.round(moved)}m先の地面に柱を立てています（標高は5mメッシュ）。` : '';
  $('h-rel').textContent = H > pinGround ? `${(H - pinGround).toFixed(1)}m上` : `${(pinGround - H).toFixed(1)}m下`;
  $('h-off').textContent = !official?.covered && !official?.cells?.length
    ? '未確認（収録外）'
    : offCell ? `${offCell.depth.toFixed(1)}m` : '浸水セルなし';

  // warm up every pipeline so the first frame does not stall
  if (outerSolver) { await outerSolver.compileAll(); outerSolver.pack(); }
  await solver.compileAll();
  solver.pack();
  await renderer.compileAsync(world.causticScene, world.causticCam);
  await renderer.compileAsync(scene, camera);

  // ── cameras ──
  const up = new THREE.Vector3(0, 1, 0);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const views = {
    // whole approach: sea → port → rivers → the point, seen from high above the land side
    wide: () => {
      const span = Math.hypot(seaX - pinX, seaZ - pinZ);
      const tgt = V(pinX + (seaX - pinX) * 0.45, 0, pinZ + (seaZ - pinZ) * 0.45);
      const back = span * 0.55 + 900;
      return { pos: V(tgt.x - dir.x * back, span * 0.75 + 800, tgt.z - dir.y * back), target: tgt };
    },
    over: () => {
      // frame both the point and the coast (nested: the near edge of the detailed square toward the sea)
      const span = Math.min(Math.hypot(seaX - pinX, seaZ - pinZ), far ? 700 : Infinity);
      const sx = pinX + dir.x * span, sz = pinZ + dir.y * span;
      const tgt = V(pinX + (sx - pinX) * 0.35, 5, pinZ + (sz - pinZ) * 0.35);
      const back = Math.max(380, span * 0.75);
      return { pos: V(tgt.x - dir.x * back, Math.max(260, back * 0.75) + Math.max(0, pinGround), tgt.z - dir.y * back), target: tgt };
    },
    pin: () => ({ pos: V(pinX - dir.x * 55 - dir.y * 25, pinGround + 30, pinZ - dir.y * 55 + dir.x * 25), target: V(pinX + dir.x * 20, pinGround + 2, pinZ + dir.y * 20) }),
    // standing 9 m behind the pole and a little to the side: the pole and the 170 cm person stay in view
    eye: () => {
      // stand ~9 m from the pole on open ground (not inside a building), preferring to face the sea
      let best = null;
      for (let a = 0; a < 16; a++) {
        const ang = Math.atan2(-dir.y, -dir.x) + ((a % 2 ? 1 : -1) * Math.ceil(a / 2) * Math.PI) / 8;
        const ex = pinX + Math.cos(ang) * 9, ez = pinZ + Math.sin(ang) * 9;
        const [ci, cj] = cellOf(ex, ez);
        let clear = true;
        for (let t = 0.1; t <= 1.0 && clear; t += 0.1) { const [ai, aj] = cellOf(ex + (pinX - ex) * t, ez + (pinZ - ez) * t); if (region.bldH[aj * N + ai] > 0) clear = false; }
        if (region.bldH[cj * N + ci] <= 0 && clear) { best = { ex, ez, g: region.bed[cj * N + ci] }; break; }
      }
      const e = best ?? { ex: pinX - dir.x * 9, ez: pinZ - dir.y * 9, g: pinGround };
      const fx = pinX - e.ex, fz = pinZ - e.ez, fl = Math.hypot(fx, fz) || 1;
      return { pos: V(e.ex, Math.max(e.g, pinGround) + 1.6, e.ez), target: V(pinX + (fx / fl) * 60, pinGround + 2.2, pinZ + (fz / fl) * 60) };
    },
    impact: () => {
      // the building nearest to the coast point, seen obliquely from the land side
      const b = impactBuilding;
      const cx = b ? b.cx : seaX - dir.x * 60, cz = b ? b.cz : seaZ - dir.y * 60;
      const ty = b ? b.base + 2 : 3;
      return { pos: V(cx - dir.x * 45 + dir.y * 55, ty + 32, cz - dir.y * 45 - dir.x * 55), target: V(cx + dir.x * 10, ty, cz + dir.y * 10) };
    },
  };
  let camAnim = null;
  function setView(name, instant = false) {
    const v = views[name]();
    document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
    controls.minDistance = name === 'eye' ? 0.5 : 3;
    if (instant || reduceMotion) { camera.position.copy(v.pos); controls.target.copy(v.target); controls.update(); return; }
    camAnim = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos, t1: v.target };
  }
  // portrait screens: wider lens so the point and the coast both fit
  camera.fov = innerWidth < innerHeight ? 62 : 45;
  camera.updateProjectionMatrix();
  setView(far ? 'wide' : 'over', true);
  $('views').querySelector('[data-v="wide"]').hidden = !far;

  // ── state ──
  const st = { playing: false, speed: 20, maxSteps: N >= 1024 ? 14 : N >= 768 ? 28 : 48, frames: 0, ft: 0, lastT: performance.now(), shownResult: false, arrived: null };
  // inland runs cover ~55 min of flood travel: start at ×60
  if (far) { st.speed = 60; document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', b.dataset.s === '60')); }
  const total = lead.wave.pre + lead.wave.rise + lead.wave.hold + lead.wave.fall + 240;
  const calm = () => $('tg-calm').checked;

  const ui = {
    play: () => { st.playing = !st.playing; $('play').textContent = st.playing ? '❚❚' : '▶'; $('play').setAttribute('aria-label', st.playing ? '一時停止' : '再生'); },
  };
  const on = (id, ev, fn) => { const el = $(id); el.addEventListener(ev, fn); cleanups.push(() => el.removeEventListener(ev, fn)); };
  const cleanups = [];
  on('play', 'click', ui.play);
  const speedsClick = (e) => { const b = e.target.closest('button'); if (!b) return; st.speed = Number(b.dataset.s); document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', x === b)); };
  on('speeds', 'click', speedsClick);
  on('views', 'click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });
  const applyToggles = () => {
    if ($('tg-depth').checked) $('toast').hidden = true;
    const depth = $('tg-depth').checked || calm();
    world.uEnv.value.w = depth ? 1 : 0;
    $('legend').hidden = !(depth || $('tg-off').checked);
    world.uShowOfficial.value = $('tg-off').checked ? 1 : 0;
    world.spray.visible = $('tg-spray').checked && !calm();
  };
  ['tg-depth', 'tg-off', 'tg-spray', 'tg-calm'].forEach((id) => on(id, 'change', applyToggles));
  applyToggles();
  on('result-btn', 'click', () => openResult());
  on('r-close', 'click', () => { $('result').hidden = true; labels.domElement.style.visibility = ''; });
  on('toast-yes', 'click', () => { $('tg-depth').checked = true; applyToggles(); $('toast').hidden = true; });
  on('toast-no', 'click', () => { $('toast').hidden = true; });
  const keyFn = (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); ui.play(); } };
  window.addEventListener('keydown', keyFn);
  cleanups.push(() => window.removeEventListener('keydown', keyFn));

  // ── HUD ──
  const fmt = (s) => { const m = Math.floor(Math.max(0, s) / 60), r = Math.floor(Math.max(0, s) % 60); return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; };
  function phase(t) {
    const w = lead.wave, tt = t - w.pre;
    if (tt < 0) return '静かな海';
    if (tt < w.rise) return '押し波が来ています';
    if (tt < w.rise + w.hold) return '高い水位が続いています';
    const trapped = pinGround < 0.3 && st.arrived != null;
    if (tt < w.rise + w.hold + w.fall) return trapped ? '引き波：海は下がっても、この土地の水は引きません' : '引き波（水が海へ戻る）';
    return trapped ? '水が引かない土地です（ポンプで排水するまで残ります）' : '終息に向かっています';
  }
  function say(h) {
    if (h < 0.01) {
      const f = solver.coast.front;
      return [Number.isFinite(f) ? `この地点にはまだ届いていません（周りでは浸水が進んでいます）` : 'この地点にはまだ届いていません', ''];
    }
    if (h < 0.3) return ['浅くても流れは強い力になります', 'lv1'];
    if (h < 1) return ['0.3m以上：避難行動が難しくなる深さです', 'lv1'];
    if (h < 2) return ['1m以上：命の危険が急激に高まる深さです', 'lv2'];
    if (h < 3) return ['2m以上：木造家屋が全面破壊されうる深さです', 'lv3'];
    return ['2階の床を超えています。2m以上は木造家屋が全面破壊されうる深さです', 'lv3'];
  }
  function updateHud() {
    const t = lead.time;
    $('clock').textContent = fmt(t - lead.wave.pre);
    $('phase').textContent = st.playing || t > 0 ? phase(t) : '待機（▶で開始）';
    const p = solver.probe;
    if (p.q && p.k === pinK) {
      const h = p.q[0];
      const sp = h > 0.01 ? Math.hypot(p.q[1], p.q[2]) / h : 0;
      $('h-now').textContent = h.toFixed(2);
      const [txt, lv] = say(h);
      $('h-say').textContent = txt;
      $('h-say').className = `say ${lv}`;
      $('gauge-fill').style.width = `${Math.min(100, (h / 3) * 100)}%`;
      $('h-max').textContent = `${p.m[0].toFixed(2)}m`;
      $('h-v').textContent = h > 0.01 ? `${sp.toFixed(1)}m/s` : '—';
      if (p.m[1] >= 0 && p.m[1] < 1e8) { $('h-arr-k').textContent = '押し波開始から到達'; $('h-arr').textContent = `${Math.max(0, (p.m[1] - solver.wave.pre) / 60).toFixed(0)}分後`; st.arrived = p.m[1]; }
      else {
        const f = Math.min(solver.coast.front, outerSolver ? outerSolver.coast.front : Infinity);
        st.closest = Math.min(st.closest ?? Infinity, f);
        $('h-arr-k').textContent = '水の先端まで';
        $('h-arr').textContent = Number.isFinite(f) ? `約${f < 1000 ? Math.round(f / 10) * 10 + 'm' : (f / 1000).toFixed(1) + 'km'}` : '陸にはまだ';
      }
      // first seawall overtopped → say it (the official scenario assumes the same collapse)
      if (!st.breachSaid && (solver.coast.breached > 0 || (outerSolver?.coast.breached ?? 0) > 0)) {
        st.breachSaid = true;
        $('toast-t').textContent = '津波が防潮壁を越え、越えた所から壊れ始めました（内閣府・愛知県の想定と同じ条件）。';
        $('toast-yes').hidden = true;
        $('toast').hidden = false;
        const t = setTimeout(() => { $('toast').hidden = true; $('toast-yes').hidden = false; }, 9000);
        cleanups.push(() => clearTimeout(t));
      }
      // first water on land → offer the hazard-map colouring (日向 #5)
      if (!st.toasted && $('toast').hidden && Number.isFinite(Math.min(solver.coast.front, outerSolver ? outerSolver.coast.front : Infinity)) && !$('tg-depth').checked) {
        st.toasted = true;
        $('toast-t').textContent = '陸に水が上がり始めました。深さで色分けすると、どこが何mか分かりやすくなります。';
        $('toast').hidden = false;
        const t = setTimeout(() => { $('toast').hidden = true; }, 8000);
        cleanups.push(() => clearTimeout(t));
      }
      pin.set(h, h > 0.01 ? `ここの深さ ${h.toFixed(1)}m` : 'ここ');
    }
  }

  // ── result (D8/D9) ──
  async function openResult() {
    labels.domElement.style.visibility = 'hidden'; // 3-D tags must never sit on top of the table
    const m = await solver.readAll();
    let flooded = 0;
    for (let k = 0; k < N * N; k++) {
      const land = !region.water[k] && region.bldH[k] <= 0;
      if (land && m[k * 4] > 0.05) flooded++;
    }
    const km2 = (flooded * dx * dx) / 1e6;
    const pm = [m[pinK * 4], m[pinK * 4 + 1], m[pinK * 4 + 2]];
    const reached = pm[1] >= 0 && pm[1] < 1e8;
    // same yardstick as the official value: the maximum depth inside the ~100 m cell around the point
    const cx = offCell ? offCell.x : pinX, cz = offCell ? offCell.z : pinZ;
    // official meshes are 10 m: average our 2 m maxima over 10 m blocks first, then take the 100 m max (汐見 r2 #1)
    let cell100 = 0;
    const B = Math.max(1, Math.round(10 / dx));
    for (let j = Math.max(0, Math.floor((cz - 50 + L / 2) / dx)); j + B <= Math.min(N, Math.floor((cz + 50 + L / 2) / dx) + 1); j += B)
      for (let i = Math.max(0, Math.floor((cx - 50 + L / 2) / dx)); i + B <= Math.min(N, Math.floor((cx + 50 + L / 2) / dx) + 1); i += B) {
        let sum = 0, n = 0;
        for (let b = 0; b < B; b++) for (let a = 0; a < B; a++) {
          const k = (j + b) * N + i + a;
          if (!region.water[k] && region.bldH[k] <= 0) { sum += m[k * 4]; n++; }
        }
        if (n >= (B * B) / 2) cell100 = Math.max(cell100, sum / n);
      }
    const done = solver.time > solver.wave.pre + solver.wave.rise + solver.wave.hold + solver.wave.fall;
    $('r-sub').textContent = `${$('t-name').textContent}　計算範囲 ${outerSolver ? `広域 ${(outerSolver.L / 1000).toFixed(1)}km四方（約${outerSolver.dx.toFixed(0)}m）＋地点周り ` : ''}${(L / 1000).toFixed(1)}km四方・格子 ${N}²（約${dx.toFixed(1)}m）・押し波開始から ${fmt(solver.time - solver.wave.pre)}${done ? '' : '（まだ途中の値です）'}`;
    $('r-sim').innerHTML = `
      <div><dt>ここの深さ（最大）</dt><dd>${reached ? pm[0].toFixed(2) + 'm' : `<small>今回の仮定では到達せず${Number.isFinite(st.closest) ? `（水の先端は最も近くて約${st.closest < 1000 ? Math.round(st.closest / 10) * 10 + 'm' : (st.closest / 1000).toFixed(1) + 'km'}まで）` : ''}</small>`}</dd></div>
      <div><dt>周辺100m四方の最大（10m平均・公式と同じ物差し）</dt><dd>${cell100 > 0.01 ? cell100.toFixed(2) + 'm' : '<small>浸水なし</small>'}</dd></div>
      <div><dt>水が来たのは</dt><dd>${reached ? `押し波開始から約${Math.max(0, (pm[1] - solver.wave.pre) / 60).toFixed(0)}分後` : '—'}</dd></div>
      <div><dt>最大の流れの速さ</dt><dd>${reached ? pm[2].toFixed(1) + 'm/s' : '—'}</dd></div>
      <div><dt>計算範囲内で水に浸かった陸地</dt><dd>${km2.toFixed(2)}km²</dd></div>
      <div><dt>条件</dt><dd><small>はじめの潮位 T.P.+${(o.tide ?? 0).toFixed(1)}m／${region.leveeCells ? `防潮壁 T.P.+${o.levee.crest.toFixed(1)}m・${o.breach ? '越流したら破壊' : '壊れない'}（壊れたセル ${solver.coast.breached}）` : '防潮壁なし'}</small></dd></div>`;
    const offCells = official?.cells ?? [];
    const inDom = offCells.filter((c) => Math.abs(c.x) < L / 2 && Math.abs(c.z) < L / 2);
    const covered = official?.covered || offCells.length > 0;
    $('r-off').innerHTML = !covered
      ? '<div><dt>この範囲</dt><dd><small>未確認（公式データの収録範囲外）。「浸水しない」という意味ではありません。</small></dd></div>'
      : `<div><dt>周辺100m四方の最大浸水深</dt><dd>${offCell ? offCell.depth.toFixed(2) + 'm' : '<small>浸水セルなし（100m集約）</small>'}</dd></div>
         <div><dt>最早到達（1cm）</dt><dd>${offCell?.arrival != null ? '地震から約' + Math.round(offCell.arrival / 60) + '分' : '—'}</dd></div>
         <div><dt>計算範囲内の浸水セル（100m集約）</dt><dd>${inDom.length}個</dd></div>`;
    const hi = Math.max(cell100, offCell?.depth ?? 0);
    const arr = offCell?.arrival != null ? Math.round(offCell.arrival / 60) : null;
    $('r-note').innerHTML = `時刻の物差しが違います：この再現は<b>押し波が計算範囲に入ってから</b>、公式は<b>地震が起きてから</b>の時間です。` +
      (arr != null ? `公式想定では、この付近に水が来るのは<b>地震から約${arr}分後</b>です。ただし堤防が壊れたり、川を水がさかのぼったりすると、もっと早く来ることがあります。揺れがおさまったら、すぐ高い所へ。` : '揺れがおさまったら、すぐ高い所へ。') + '<br>' +
      (pinGround < 0.3 ? '<b>海抜ゼロメートル地帯では、入った水は自然には引きません。</b>伊勢湾台風（1959年）では、水が数か月引かなかった地域があります。2階以上か、近くの津波避難ビルへ。<br>' : '') +
      `この再現は、海岸に「海の高さ」の波を入れ、地形・建物${region.leveeCells ? '・防潮壁' : ''}で水の動きを計算した仮定の再現です。${region.leveeCells ? '防潮壁は地理院の「堤防等に接する海岸線」の位置に置いた近似です。' : '防潮壁・水門は含みません。'}沖の高潮防波堤・地盤沈下・漂流物・建物の破壊は含みません。条件が違うので、公式の値とは一致しません。` +
      (hi > 0.01 ? `<br><b>備えは高いほう（${hi.toFixed(1)}m）で考えてください。</b>` : '');
    $('r-read').textContent = `読み上げ用：選んだ地点では、${reached ? `最大で${pm[0].toFixed(1)}メートルの深さになりました` : '今回の仮定では水は到達しませんでした'}。周辺100メートル四方では最大${cell100.toFixed(1)}メートル。公式想定は${covered ? (offCell ? `${offCell.depth.toFixed(1)}メートル` : '浸水セルなし') : '未確認'}です。`;
    $('result').hidden = false;
  }

  // ── frame loop ──
  let probeTick = 0;
  let fpsAcc = 0, fpsN = 0;
  function frame(fixedDt) {
    const now = performance.now();
    const rdt = fixedDt ?? Math.min((now - st.lastT) / 1000, 1 / 20);
    st.lastT = now;
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + rdt / 1.4);
      const e = camAnim.t * camAnim.t * (3 - 2 * camAnim.t);
      camera.position.lerpVectors(camAnim.p0, camAnim.p1, e);
      controls.target.lerpVectors(camAnim.t0, camAnim.t1, e);
      if (camAnim.t >= 1) camAnim = null;
    }
    controls.update();
    // near plane follows the viewing distance: a fixed 0.5 m near with a 50 km far plane leaves no depth
    // precision and the wide square z-fights into stripes
    {
      const want = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.0025, 0.3, 40);
      if (Math.abs(want - camera.near) / camera.near > 0.15) { camera.near = want; camera.updateProjectionMatrix(); }
    }
    pin.setDetail(camera.position.distanceTo(pin.group.position) < 140);
    if (st.playing) {
      if (!outerSolver) {
        const want = Math.ceil((st.speed * rdt) / solver.dt);
        const steps = Math.max(1, Math.min(want, st.maxSteps));
        solver.step(steps, calm() ? 0 : 1);
      } else {
        // advance both squares to the same time; the fine one only once the flood is near it
        const active = st.innerActive || outerSolver.coast.front < L * 0.75 + 600;
        if (active && !st.innerActive) st.innerActive = true;
        const budget = active ? Math.min(st.maxSteps * solver.dt, st.speed * rdt) : Math.min(st.speed * rdt, st.maxSteps * 6 * outerSolver.dt);
        const T = outerSolver.time + budget;
        outerSolver.step(Math.max(1, Math.round((T - outerSolver.time) / outerSolver.dt)), 0);
        if (active) solver.step(Math.max(0, Math.round((outerSolver.time - solver.time) / solver.dt)), calm() ? 0 : 1);
        else solver.idle(outerSolver.time);
      }
      if (lead.time > total && !st.shownResult) { st.shownResult = true; ui.play(); openResult(); }
    }
    if (outerSolver) { outerSolver.pack(0); world.outerLayer.update(); }
    solver.pack(st.playing ? rdt : 0);
    world.uOuterEta.value = lead.etaTarget(lead.time);
    world.uEnv.value.y = now / 1000;
    world.renderCaustics();
    world.pipeline.render();
    labels.render(scene, camera);
    if (++probeTick % 4 === 0) solver.requestProbe(pinK);
    if (probeTick % 6 === 0) updateHud();
    // adaptive sub-step budget: keep the frame ≥ ~30 fps
    if (fixedDt === undefined) {
      fpsAcc += rdt; fpsN++;
      if (fpsAcc > 1) {
        const fps = fpsN / fpsAcc;
        if (fps < 40 && prScale > 0.6) { prScale *= 0.85; onResize(); }
        else if (fps > 70 && prScale < 1) { prScale = Math.min(1, prScale * 1.1); onResize(); }
        if (st.playing) {
          if (fps < 28 && st.maxSteps > 2) st.maxSteps = Math.max(2, Math.floor(st.maxSteps * 0.8));
          else if (fps > 50 && st.maxSteps < 120) st.maxSteps = Math.ceil(st.maxSteps * 1.15);
        }
        const eff = st.playing ? (lead.time - (st.lastSimT ?? lead.time)) / fpsAcc : 0;
        st.lastSimT = lead.time;
        $('perf').textContent = `${fps.toFixed(0)} fps · 格子 ${N}²${outerSolver ? ` ＋広域 ${outerSolver.N}²${st.innerActive ? '' : '（詳細は待機中）'}` : ''} · 実効 ×${eff.toFixed(0)}`;
        fpsAcc = 0; fpsN = 0;
      }
    }
  }

  return {
    region, solver, world,
    begin() {
      renderer.setAnimationLoop(() => frame());
      if (!reduceMotion && !qs.has('manual')) { const t = setTimeout(() => { if (!st.playing) ui.play(); }, 1500); cleanups.push(() => clearTimeout(t)); }
    },
    dispose() {
      cleanups.forEach((f) => f());
      controls.dispose();
      world.dispose();
      solver.dispose();
      outerSolver?.dispose();
      labels.domElement.style.visibility = '';
      $('result').hidden = true;
      labels.domElement.replaceChildren();
    },
    // debug / verification hooks
    frame, st, setView, openResult, camera, controls, outerSolver, lead, pin: { x: pinX, z: pinZ, k: pinK, ground: pinGround }, dir,
  };
}

function onResize() {
  if (!innerWidth || !innerHeight) return;
  renderer.setPixelRatio(basePR() * prScale);
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
  if (app) { app.camera.aspect = innerWidth / innerHeight; app.camera.updateProjectionMatrix(); }
}
addEventListener('resize', onResize);
document.addEventListener('visibilitychange', () => {
  if (!app) return;
  if (document.hidden) renderer.setAnimationLoop(null);
  else { app.st.lastT = performance.now(); renderer.setAnimationLoop(() => app.frame()); }
});

// ── deep links & verification hooks ──
if (qs.has('demo')) start({ demo: true, N: Number(qs.get('n') || 512), H: Number(qs.get('h') || 8) });
else if (qs.has('lat') && qs.has('lon')) {
  const lat = Number(qs.get('lat')), lon = Number(qs.get('lon'));
  picker.setPoint(lat, lon);
  if (qs.has('auto')) {
    const wait = setInterval(() => {
      if (sel.plan?.ok) {
        clearInterval(wait);
        if (qs.has('h')) setH(Number(qs.get('h')));
        if (qs.has('n')) $('quality').value = qs.get('n');
        if (qs.has('tide')) $('tide').value = qs.get('tide');
        if (qs.has('levee')) $('levee').checked = qs.get('levee') === '1';
        if (qs.has('crest')) $('crest').value = qs.get('crest');
        if (qs.has('breach')) $('breach').checked = qs.get('breach') === '1';
        $('go').click();
      }
    }, 300);
  }
}
// verification hooks exist only in the dev server (headless checks); the published build has none
if (import.meta.env.DEV) window.__t = {
  get app() { return app; }, renderer, start, THREE, picker,
  // advance the simulation deterministically (headless checks)
  advance(seconds, fps = 30) { if (!app) return; const was = app.st.playing; app.st.playing = true; for (let i = 0; i < Math.round(seconds * fps); i++) app.frame(1 / fps); app.st.playing = was; },
  async shot(name) {
    if (!app) return 0;
    renderer.setAnimationLoop(null);
    app.frame(0);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.RenderTarget(size.x, size.y);
    renderer.setRenderTarget(rt);
    app.world.pipeline.render();
    renderer.setRenderTarget(null);
    const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, size.x, size.y);
    rt.dispose();
    const cv = new OffscreenCanvas(size.x, size.y);
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, size.x * size.y * 4), size.x, size.y), 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    await fetch('/__shot?name=' + name, { method: 'POST', body: blob });
    renderer.setAnimationLoop(() => app.frame());
    return blob.size;
  },
};
