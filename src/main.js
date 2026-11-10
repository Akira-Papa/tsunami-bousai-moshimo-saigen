// 津波防災もしも再現 — app flow: pick a point → build the town → GPU tsunami → compare
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createPicker } from './picker.js';
import { planDomain, tsunamiHeightAt } from './data/plan.js';
import { buildRegion, buildOuterRegion } from './data/region.js';
import { syntheticRegion } from './data/synthetic.js';
import { officialAt, officialState, officialAround, caseNote, cellHasLand } from './data/official.js';
import { createBrief, evacHtml, edgeJa } from './brief.js';
import { distJa } from './data/evac.js';
import { createMemo } from './memo.js';
import { $, esc, depthSay, hazardMapUrl, walkMin, arrivalJa, arrivalSentence, openDialog, closeDialog, isDialogOpen, anyDialogOpen } from './ui.js';
import { makeFrame } from './data/geo.js';
import { createSolver } from './sim/swe.js';
import { createWorld } from './render/world.js';
import { createPin, createSeaMarker } from './render/markers.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const qs = new URLSearchParams(location.search);
const show = (id) => { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id)); };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmall = Math.min(innerWidth, innerHeight) < 700;
if (isSmall) $('quality').value = '512';
// phones, tablets and short windows: the side panels start folded so the 3-D view (and the dock) stay clear
const compact = innerWidth <= 1100 || innerHeight <= 800;

// ── WebGPU gate ──
// No WebGPU is NOT a dead end: the map, the official inundation data and the evacuation sites need no GPU.
// Only the 3-D run is switched off (and says so in words).
let gpuOk = false;
try { gpuOk = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { gpuOk = false; }
/**
 * the "3Dで再現する" button lives in the card's fixed foot, so it stays in sight however far the card is scrolled.
 *   hidden      no point chosen yet, or no WebGPU (a button that can never be pressed is not shown)
 *   checking    the point is being looked up
 *   ready       press to start
 *   unavailable this point cannot be run in 3-D (the reason is in the card): a short note instead of a dead button
 */
function setGo(state) {
  const go = $('go'), why = $('go-why');
  $('pick-foot').hidden = state === 'hidden' || !gpuOk;
  go.hidden = state === 'unavailable';
  go.disabled = state !== 'ready';
  go.textContent = state === 'checking' ? '地点を調べています…' : 'この地点で、3Dで再現する';
  why.hidden = state !== 'unavailable';
  if (state === 'unavailable') why.innerHTML = 'この地点は、3Dでは再現できません（<a href="#sel-warn" id="go-why-link">理由を見る</a>）。公式想定と逃げる場所は、上で見られます。';
}
// links inside the card scroll the card (no "#…" left in the address bar, which would travel with a shared link)
document.addEventListener('click', (e) => {
  const a = e.target.closest('#jump-setup, #go-why-link');
  if (!a) return;
  e.preventDefault();
  document.querySelector(a.getAttribute('href'))?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
});
function setGpuUi(why = null) {
  $('gpu-note').hidden = gpuOk;
  $('sim-setup').hidden = !gpuOk;
  document.querySelectorAll('.sim-only').forEach((n) => { n.hidden = !gpuOk; });
  if (!gpuOk) $('pick-foot').hidden = true;
  if (why) $('gpu-note').firstChild.textContent = why;
}

// ─────────────────────────────────────────────────────────────
//  1. pick
// ─────────────────────────────────────────────────────────────
const sel = { lat: null, lon: null, plan: null, info: null, token: 0, briefP: null, defaults: null };
const picker = createPicker({ onPick });
const brief = createBrief({ map: picker.map, getH: () => Number($('H').value) || 5 });
const memo = createMemo({ getContext: () => ({ name: placeName(sel.info), lat: sel.lat, lon: sel.lon, info: sel.info, official: brief.current?.official, evac: brief.current?.evac }) });
document.addEventListener('memo', () => memo.open());
setGpuUi();
/** the place name as shown everywhere (pick card, 3-D top bar, memo, print): a guessed municipality is never shown as fact */
const placeName = (info) => (info?.guessed ? `選んだ地点（${info.name || '市区町村は不明'}の近く）` : info?.name ? `${info.name}${info.place ? ' ' + info.place : ''}` : '');

/** everything on the card that depends on the municipality (name, initial sea height, tide / seawall defaults) */
function showInfo(info, lat, lon) {
  sel.info = info;
  brief.setInfo(info ?? { failed: true });
  // a guessed municipality (the reverse geocoder did not answer) must not choose the tide / seawall defaults
  applyDefaults(regionDefaults(lat, lon, info?.code, !!info?.guessed));
  $('sel-name').textContent = placeName(info) || '選んだ地点';
  if (info?.H != null && info.guessed) {
    setH(info.H);
    $('Hsrc').textContent = `この地点の市区町村を特定できませんでした（通信）。近くの市区町村（15km以内）のうち、いちばん高い海岸最大津波高 ${info.H}m を仮の初期値にしています。潮位と防潮壁も、この地域の値を確かめられないため、仮の条件（防潮壁なし）です。分かりしだい、正しい値に差し替えます。`;
  } else if (info?.H != null && info.borrowed) {
    setH(info.H);
    $('Hsrc').textContent = `この地点の市区町村は内閣府（2025）の津波高一覧にないため、近くの「${info.borrowed}」の海岸最大津波高 ${info.H}m を初期値にしています（代用値）。スライダーで変えられます。`;
  } else if (info?.H != null) {
    setH(info.H);
    $('Hsrc').textContent = `初期値は内閣府（2025）南海トラフ巨大地震の「${info.name}」海岸最大津波高 ${info.H}m（11ケースの最大・満潮位と地殻変動を考慮）。スライダーで変えられます。`;
  } else if (!info) {
    setH(5);
    $('Hsrc').textContent = '津波高の一覧を取得できませんでした（通信）。仮に 5m で試せます（公式の値ではありません）。地点を選び直すと、もう一度取得します。';
  } else {
    setH(5);
    $('Hsrc').textContent = 'この市区町村は内閣府（2025）の南海トラフ津波高一覧に含まれていません。仮に 5m で試せます（公式の値ではありません）。';
  }
}
async function onPick(lat, lon) {
  const token = ++sel.token;
  Object.assign(sel, { lat, lon, plan: null, info: null, touched: false });
  // the official card never waits for (or fails with) the 3-D planning below
  sel.briefP = brief.update(lat, lon);
  $('sel').hidden = false;
  $('sel-name').textContent = '地点を調べています…';
  $('sel-sub').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $('sel-warn').hidden = true;
  $('sel-warn').className = 'warn';
  $('sel-zero').hidden = true;
  setGo('checking');
  $('Hsrc').textContent = '';
  requestAnimationFrame(() => $('sel').scrollIntoView({ block: 'start', behavior: 'smooth' }));
  // the per-case heights reach the official card as soon as they are known (not after the 3-D planning)
  const infoP = tsunamiHeightAt(lat, lon).catch(() => null);
  infoP.then((i) => { if (token === sel.token) brief.setInfo(i ?? { failed: true }); });
  const [info, plan] = await Promise.all([
    infoP,
    planDomain(lat, lon).catch((e) => ({ ok: false, reason: 'error', error: e })),
  ]);
  if (token !== sel.token) return;
  sel.plan = plan;
  showInfo(info, lat, lon);
  // the reverse geocoder is sometimes very slow (20 s): if the municipality was only guessed, keep asking in the
  // background and put the real one in when it arrives — unless the reader has already changed the conditions
  if (info?.guessed) tsunamiHeightAt(lat, lon, 30000).then((better) => {
    if (token !== sel.token || !better || better.guessed || app) return;
    if (sel.touched) {
      sel.info = better; brief.setInfo(better); $('sel-name').textContent = placeName(better);
      $('Hsrc').textContent = `市区町村は「${better.name}」と分かりました。条件はすでに変更されているので、そのままにしています（この地点の公式の値に戻すには、地点を選び直してください）。`;
      return;
    }
    showInfo(better, lat, lon); updateCond();
  }).catch(() => {});
  const elev = plan?.here;
  $('sel-sub').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}${Number.isFinite(elev) ? `　地盤の標高 約${elev.toFixed(1)}m（10mメッシュの目安）` : ''}`;
  applyUrlConditions();
  const zero = $('sel-zero');
  if (Number.isFinite(elev) && elev < 0.5) {
    zero.hidden = false;
    zero.innerHTML = elev < 0 ? `この土地は海面より <b>${Math.abs(elev).toFixed(1)}m 低い</b> 海抜ゼロメートル地帯です。堤防を越えた水が入ると、排水されるまで長く残ることがあります。水が来る前に、高い所（指定された逃げる場所や、丈夫な建物の上の階）へ。` : `この土地の標高は <b>${elev.toFixed(1)}m</b>。ほぼ海面と同じ高さです。入った水は引きにくく、長く残ることがあります。水が来る前に、高い所へ。`;
  } else zero.hidden = true;
  updateCond();
  if (!gpuOk) return; // no 3-D run on this device: nothing below applies
  const w = $('sel-warn');
  if (!plan?.ok) {
    w.hidden = false;
    w.textContent = plan?.reason === 'far'
      ? `開けた海から約${(plan.distance / 1000).toFixed(1)}km離れていて、このサイトの3Dの計算範囲（最大20km四方）に海が入らないため、ここでは再現できません。「津波が来ない」という意味ではありません。上の公式想定と、自治体のハザードマップで確かめてください。`
      : plan?.reason === 'no-sea' ? '周囲16km以内に、このサイトが「開けた海」と判定できる場所がなく、ここでは再現できません。「津波や高潮が来ない」という意味ではありません。上の公式想定と、自治体のハザードマップで確かめてください。'
        : '地形データを取得できませんでした。通信の状態を確かめて、もう一度地点を選んでください。';
    setGo('unavailable');
    return;
  }
  setGo('ready');
  // outline of the simulated square(s)
  const sq = (c, L) => { const f = makeFrame(c.lat, c.lon), h = L / 2; return [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, z]) => { const p = f.toLatLon(x, z); return [p.lon, p.lat]; }); };
  picker.showSquare(sq(plan.center, plan.L), plan.mode === 'nest' ? sq(plan.outer.center, plan.outer.L) : null).catch((e) => console.warn(e));
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
function regionDefaults(lat, lon, code, guessed = false) {
  // the municipality is only a guess (the reverse geocoder did not answer): no seawall — the side that lets MORE
  // water in — and the Nagoya-port tide inside the port area. Replaced when the real answer arrives.
  if (guessed) {
    const port = lat > 35.0 && lat < 35.20 && lon > 136.80 && lon < 136.98;
    return {
      tide: port ? 1.2 : 0, levee: false, crest: 4.6,
      tideSrc: `市区町村を特定できなかったため、仮の潮位（T.P.+${port ? '1.2' : '0.0'}m）です。`,
      crestSrc: '市区町村を特定できなかったため、防潮壁は入れていません（その分、水は多めに入ります）。',
    };
  }
  // the 26.4 km seawall runs 天白川河口〜庄内川河口 = the coastal wards of Nagoya city only
  // (東海市・知多市 are also in the port area but outside that line → no confirmed crest there)
  const c = String(code ?? '');
  // inland Nagoya wards (中村区の名古屋駅 など) are reached only across that same port seawall → same defaults
  const nagoyaPort = c.startsWith('231') || (!c && lat > 35.055 && lat < 35.20 && lon > 136.80 && lon < 136.98);
  if (nagoyaPort) return {
    confirmed: true,
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
  sel.defaults = d;
  $('tide').value = d.tide; $('tideOut').textContent = `T.P.+${d.tide.toFixed(1)}m`; $('tideSrc').textContent = d.tideSrc;
  $('levee').checked = d.levee; $('breach').checked = true; $('crest').value = d.crest; $('crestOut').textContent = `T.P.+${d.crest.toFixed(1)}m`; $('crestSrc').textContent = d.crestSrc;
  syncLevee();
}
function syncLevee() { const on = $('levee').checked; $('crest').disabled = !on; $('breach').disabled = !on; }
$('tide').addEventListener('input', (e) => { $('tideOut').textContent = `T.P.+${Number(e.target.value).toFixed(1)}m`; });
$('crest').addEventListener('input', (e) => { $('crestOut').textContent = `T.P.+${Number(e.target.value).toFixed(1)}m`; });
$('levee').addEventListener('change', syncLevee);
// the conditions stay readable outside the folded "くわしい条件" (the honesty of this site lives in them)
function updateCond() {
  const tide = Number($('tide').value), lev = $('levee').checked, crest = Number($('crest').value), br = $('breach').checked, H = Number($('H').value);
  const d = sel.defaults;
  $('cond-line').innerHTML = `<b>計算の条件</b>：はじめの潮位 T.P.+${tide.toFixed(1)}m／${lev ? `防潮壁あり（高さ T.P.+${crest.toFixed(1)}m・${br ? '越えられたら壊れる' : '壊れない'}）` : '防潮壁なし'}／木造家屋は${$('washaway')?.checked ? '浸水2mで流される' : '流されない'}。（T.P.＝標高と同じ基準の高さ）` +
    `<small>${d?.confirmed ? '潮位と防潮壁の高さは、名古屋港管理組合・愛知県の公表値です。' : `${esc(d?.tideSrc ?? '')}${esc(d?.crestSrc ?? '')}`}</small>`;
  const w = [];
  if (lev && !br) w.push('「壊れない防潮壁」は、公式の想定にはない条件です（内閣府・愛知県は、津波が越えた防潮壁は壊れると仮定しています）。この条件で水が届かなくても、安全という意味ではありません。');
  if (lev && H <= crest) w.push(`海の高さ（${H.toFixed(1)}m）が防潮壁（T.P.+${crest.toFixed(1)}m）より低いので、この条件では水はほとんど入りません。実際に防潮壁が想定どおり働くとは限りません。この結果は、安全の根拠になりません。`);
  $('cond-warn').hidden = !w.length;
  $('cond-warn').textContent = w.join(' ');
}
['tide', 'crest', 'H'].forEach((id) => $(id).addEventListener('input', () => { sel.touched = true; updateCond(); }));
['levee', 'breach'].forEach((id) => $(id).addEventListener('change', () => { sel.touched = true; updateCond(); }));

// ── PLATEAU AWARD additions: controls injected here so index.html stays untouched ──
// 木造家屋の流失（選択画面）
{
  const row = document.createElement('div');
  row.className = 'sel-row';
  row.innerHTML = '<label class="chk"><input type="checkbox" id="washaway" checked /> 浸水深2m以上で木造家屋が流される（気象庁の目安：2mで全面破壊）</label>' +
    '<p class="src">対象は PLATEAU の構造種別が木造の建物です。構造種別がないデータ（名古屋市など）では、建物区分「普通建物」（PLATEAU、なければ国土地理院）を<b>木造などの普通建物（構造は推定）</b>として扱います。普通建物には2階建てのRC造なども含まれます。周りの浸水深が2mに達した家は壁でなくなり、水が通り抜けます。漂流物は計算しません。</p>';
  $('crestSrc').closest('.sel-row').after(row);
  $('washaway').addEventListener('change', updateCond);
}
// 高い建物（避難候補）の表示切替・HUD欄・結果欄
{
  const lab = document.createElement('label');
  lab.innerHTML = '<input type="checkbox" id="tg-tall" checked /> 逃げる場所の候補を色で示す';
  document.querySelector('#disp .toggles').append(lab);
  const hud = document.createElement('div');
  hud.id = 'h-tall';
  hud.className = 'htall';
  $('h-note').before(hud);
  const ex = document.createElement('div');
  ex.id = 'r-extra';
  document.querySelector('#result .cols').after(ex);
}
// small screens: the details start folded (the 3-D view must stay visible); wide screens: open
if (compact) { $('disp').open = false; }
$('hud-more').addEventListener('click', () => {
  const open = !document.querySelector('.hud').classList.toggle('closed');
  $('hud-more').setAttribute('aria-expanded', String(open));
  $('hud-more').textContent = open ? 'たたむ' : 'くわしく';
});
if (compact) { document.querySelector('.hud').classList.add('closed'); } else { $('hud-more').setAttribute('aria-expanded', 'true'); $('hud-more').textContent = 'たたむ'; }


// the wave condition also decides which high ground the routes lead to (debounced: the slider fires continuously)
let waveT = 0;
const waveChanged = () => { clearTimeout(waveT); waveT = setTimeout(() => brief.setWave(), 350); };
function setH(v) { $('H').value = v; $('Hout').textContent = Number(v).toFixed(1); waveChanged(); }
// a shared link carries the point and the CONDITIONS only (never a result): apply them once, to the linked point
let urlCondPending = qs.has('lat') && qs.has('lon');
function applyUrlConditions() {
  if (!urlCondPending) return;
  urlCondPending = false;
  const num = (k, lo, hi) => { const v = Number(qs.get(k)); return qs.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
  const h = num('h', 1, 30), tide = num('tide', 0, 2), crest = num('crest', 1, 10);
  if (h != null) { setH(h); $('Hsrc').textContent += `（開いたリンクの条件に合わせて、海の高さを ${h.toFixed(1)}m にしています）`; }
  if (qs.has('n') && ['512', '768', '1024'].includes(qs.get('n'))) $('quality').value = qs.get('n');
  if (tide != null) { $('tide').value = tide; $('tideOut').textContent = `T.P.+${tide.toFixed(1)}m`; }
  if (qs.has('levee')) $('levee').checked = qs.get('levee') === '1';
  if (crest != null) { $('crest').value = crest; $('crestOut').textContent = `T.P.+${crest.toFixed(1)}m`; }
  if (qs.has('breach')) $('breach').checked = qs.get('breach') === '1';
  syncLevee();
  if (['h', 'tide', 'levee', 'crest', 'breach'].some((k) => qs.has(k))) sel.touched = true; // a late municipality answer must not undo the link's conditions
}
$('H').addEventListener('input', (e) => { $('Hout').textContent = Number(e.target.value).toFixed(1); waveChanged(); });

// ─────────────────────────────────────────────────────────────
//  2. renderer (created once, reused per town)
// ─────────────────────────────────────────────────────────────
const MAX_PIXELS = 3.6e6;
let prScale = 1;
const basePR = () => Math.max(0.75, Math.min(devicePixelRatio, 2, Math.sqrt(MAX_PIXELS / (innerWidth * innerHeight))));
let renderer = null, labels = null;
if (gpuOk) {
  try {
    renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(basePR());
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    await renderer.init();
    $('stage3d').appendChild(renderer.domElement);
    labels = new CSS2DRenderer();
    labels.setSize(innerWidth, innerHeight);
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' });
    $('stage3d').appendChild(labels.domElement);
    // the GPU device can be taken away (memory pressure, a long sleep, a driver reset): say so instead of a blank screen
    renderer.backend?.device?.lost?.then((info) => { if (info?.reason !== 'destroyed') onGpuLost(); });
  } catch (e) {
    console.warn('WebGPU renderer could not start', e);
    renderer = null; labels = null; gpuOk = false;
    setGpuUi();
  }
}
function onGpuLost() {
  try { renderer.setAnimationLoop(null); } catch { /* already gone */ }
  try { app?.dispose(); } catch { /* the device is gone; nothing left to free */ }
  app = null; gpuOk = false; gen++;
  closeDialog();
  setGpuUi('3Dの再現が止まりました（端末のグラフィックス機能との接続が切れました）。ページを読み込み直すと、もう一度再現できます。');
  show('pick'); picker.resize();
}

let app = null; // current town

$('go').addEventListener('click', () => start({
  lat: sel.lat, lon: sel.lon, plan: sel.plan, info: sel.info, H: Number($('H').value), N: Number($('quality').value),
  tide: Number($('tide').value), levee: { enabled: $('levee').checked, crest: Number($('crest').value) }, breach: $('breach').checked,
  washaway: $('washaway').checked,
}));
$('load-cancel').addEventListener('click', () => { loadAbort = true; gen++; show('pick'); picker.resize(); });
$('load-retry').addEventListener('click', () => { if (lastStart) start(lastStart); });
$('back').addEventListener('click', () => { closeDialog(); stopApp(); show('pick'); picker.resize(); });
let lastStart = null;
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
  if (!gpuOk) return;
  const my = ++gen;
  stopApp();
  loadAbort = false;
  lastStart = { ...o }; // a copy: the working object later carries the whole wide-area grid (never keep that for a retry)
  o.briefP ??= sel.briefP;
  $('load-retry').hidden = true;
  show('load');
  $('load-title').textContent = o.demo ? '合成の港町（オフライン用）' : (o.info?.name || '選んだ地点');
  let region;
  try {
    if (o.demo) {
      stage('grid', '合成の港町を作っています…', 0.5);
      region = syntheticRegion(o.N >= 768 ? 640 : 512, 1200);
      region.synthetic = true;
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
    stage('gpu', '3Dの計算と表示を準備しています…（初回は十数秒かかることがあります）', 0.8);
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
    if (my !== gen) return;
    $('load-msg').textContent = `読み込みに失敗しました（${e.message}）。通信の状態を確かめて、もう一度お試しください。地点選択に戻れば、公式想定と逃げる場所は見られます。`;
    $('load-retry').hidden = false;
  }
}

function stopApp() {
  if (!app) return;
  closeDialog();
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
    H, tide: o.tide ?? 0, breach: o.breach ?? true, washaway: o.washaway ?? true,
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
  // four states that must never be mixed up: hit / none (in ケース01) / outside the data / could not load
  const offState = region.synthetic ? 'outside' : officialState(official, offCell);
  // the deepest official value within 300 m, on land only (the official mesh also has cells over harbour water)
  // same rule as the 2-D card (cellHasLand): the centre or any point 30 m around it on land
  const landAt = (x, z) => { const i = Math.floor((x + L / 2) / dx), j = Math.floor((z + L / 2) / dx); return i < 0 || j < 0 || i >= N || j >= N || !region.water[j * N + i]; };
  const isLandCell = (c) => cellHasLand((ox, oz) => landAt(c.x + ox, c.z + oz));
  const offAround = officialAround(official, pinX, pinZ, 300, isLandCell);
  const offDeeper = offAround.n && offAround.max > (offCell?.depth ?? 0) + 0.05;
  // never a bare "no cell" / "outside" / "failed": the caveat is part of the text (a title attribute cannot be read on a phone)
  const OFF_SHORT = {
    hit: offCell ? `${offCell.depth.toFixed(1)}m${offDeeper ? `<small>周り300m以内は最大${offAround.max.toFixed(1)}m</small>` : ''}` : '',
    none: `<small class="off-txt">この100m四方は浸水セルなし。<b>安全という意味ではありません</b>${offAround.n ? `（${edgeJa(offAround.edge)}浸水の想定・最大${offAround.max.toFixed(1)}m）` : ''}</small>`,
    outside: '<small class="off-txt">収録範囲の外。<b>「浸水しない」という意味ではありません</b></small>',
    failed: '<small class="off-txt">取得できませんでした。<b>「浸水しない」という意味ではありません</b></small>',
  };

  // HUD static bits
  $('t-name').textContent = o.demo ? '合成の港町（デモ）' : (placeName(o.info) || '選んだ地点');
  $('t-h').textContent = `海の高さ${H.toFixed(1)}m（仮定）${(o.tide ?? 0) > 0 ? `・満潮+${o.tide.toFixed(1)}` : ''}${region.leveeCells ? `・防潮壁${o.levee.crest.toFixed(1)}m` : ''}`;
  $('t-h').title = `海の高さ ${H.toFixed(1)}m（T.P.・仮定）／はじめの潮位 T.P.+${(o.tide ?? 0).toFixed(1)}m${region.leveeCells ? `／防潮壁 天端 T.P.+${o.levee.crest.toFixed(1)}m・${o.breach ? '越流したら破壊' : '壊れない'}` : '／防潮壁なし'}` +
    (solver.washDepth > 0 ? `／木造家屋 ${solver.woodHouses}棟は浸水深${solver.washDepth}mで流失` : '／木造家屋の流失なし');
  solver.setPin(pi, pj);
  $('h-gnd').textContent = `${pinGround >= 0 ? '' : '−'}${Math.abs(pinGround).toFixed(1)}m${pinGround < 0 ? '（海面より低い）' : ''}`;
  $('h-gnd').title = moved > 3 ? `建物を避けて約${Math.round(moved)}m先の地面に柱を立てました（5mメッシュの標高）` : '5mメッシュの標高';
  $('h-note').textContent = moved > 3 ? `建物の中を避け、約${Math.round(moved)}m先の地面に柱を立てています（標高は5mメッシュ）。` : '';
  $('h-rel').innerHTML = H > pinGround ? `${(H - pinGround).toFixed(1)}m上${far ? `<small>海から約${(o.plan.distance / 1000).toFixed(1)}km。この高さの水が、そのまま来るわけではありません</small>` : ''}` : `地面が${(pinGround - H).toFixed(1)}m高い<small>安全という意味ではありません</small>`;
  $('h-off').innerHTML = OFF_SHORT[offState];
  $('h-off').title = { hit: '内閣府2025・ケース01 を100mに集約した最大浸水深', none: 'ケース01では、この100m四方に浸水のセルがありません。安全という意味ではありません', outside: 'このサイトが収録している公式データの範囲の外です。「浸水しない」という意味ではありません', failed: '公式想定を取得できませんでした（通信）。「浸水しない」という意味ではありません' }[offState];

  // ── credits: name the PLATEAU dataset actually used (A1 extract / community PMTiles), and the evac source ──
  {
    const bs = region.stats?.buildings ?? {};
    const PL = '<a href="https://www.mlit.go.jp/plateau/" target="_blank" rel="noopener">';
    const parts = [];
    if (bs.plateauLocal && region.plateau) {
      const name = /「([^」]+)」/.exec(region.plateau.source ?? '')?.[1] ?? '3D都市モデル（Project PLATEAU）';
      parts.push(`「${PL}${esc(name)}</a>」（国土交通省）を加工して作成`);
      if (region.buildings.some((b) => b.attrs?.evac)) parts.push('国土地理院「指定緊急避難場所データ」を加工して作成');
    }
    if (bs.plateau) parts.push(`${PL}3D都市モデル（Project PLATEAU）</a>（国土交通省）を加工して作成（有志変換のPMTiles経由）`);
    CREDIT0.a ??= $('credit-plateau').innerHTML; CREDIT0.b ??= $('r-credit-plateau').innerHTML;
    // no PLATEAU at all (mirror down / outside coverage): say so instead of crediting PLATEAU for GSI guesses (QA #4)
    const nB = region.buildings?.length ?? 0;
    const noPl = !bs.plateauLocal && !bs.plateau && !region.synthetic;
    const gsiB = '建物は国土地理院ベクトルタイル（高さは種別からの推定）';
    $('credit-plateau').innerHTML = parts.length ? parts.join('／') : noPl ? gsiB : CREDIT0.a;
    $('r-credit-plateau').innerHTML = parts.length ? parts.join('。') + '。' : noPl ? gsiB + '。' : CREDIT0.b;
    const srcNote = region.synthetic ? ''
      : nB === 0 ? '建物データを取得できませんでした。建物なしで計算しています（地点を選び直すと再取得します）。'
        : noPl ? 'PLATEAUの建物を取得できなかったため、国土地理院の建物（高さは推定）で計算しています。' : '';
    if (srcNote) $('h-note').textContent = [$('h-note').textContent, srcNote].filter(Boolean).join(' ');
  }

  // ── 垂直避難の見える化: tall RC/SRC/steel buildings around the point (PLATEAU attributes only) ──
  // Heights are only trusted when measured (PLATEAU h) or given as storeys; the GSI classes carry no
  // measured height, so without the PLATEAU extract nothing is judged (no guessed evacuation targets).
  const EVAC_R = 300;
  const RC_ST = new Set(['rc', 'src', 'steel']);
  const ST_JA = { wood: '木造', rc: 'RC造', src: 'SRC造', steel: '鉄骨造', other: 'その他', sturdy: '堅ろう建物' };
  // structure: PLATEAU 構造種別 when present; otherwise 建物区分 = 堅ろう建物（鉄筋コンクリート等・3階以上）stands in
  const structOf = (a) => a?.st ?? (a?.sc === 'sturdy' ? 'sturdy' : null);
  const EVAC_JA = '指定緊急避難場所（津波）';
  const nearB = [];
  region.buildings.forEach((b, id) => {
    if (Math.hypot(b.cx - pinX, b.cz - pinZ) > EVAC_R + 200) return;
    const d = distToRing(b.ring, pinX, pinZ);
    if (d <= EVAC_R) nearB.push({ b, id, d });
  });
  const hasStruct = nearB.some((e) => e.b.attrs && (e.b.attrs.st || e.b.attrs.sc || e.b.attrs.evac));
  const EVAC_SRC = '国土地理院「指定緊急避難場所データ」（津波）を PLATEAU の建物に位置で重ねたもの';
  const tall = { level: H, levelNote: `海の高さ ${H.toFixed(1)}m（T.P.・再現前の目安）`, levelShort: `海の高さ${H.toFixed(1)}m`, evac: [], cand: [], labels: [] };
  function judgeTall(level, levelNote, levelShort = levelNote) {
    const evac = [], cand = [];
    for (const e of nearB) {
      const a = e.b.attrs;
      if (!a) continue;
      const hEff = a.h ?? (a.s ? a.s * 3 : null);
      const need = Math.max(level - e.b.base, 0) + 2;
      // a designated site is listed whatever its height — but where the height IS known and falls short of
      // "water level + 2 m" in this run, say so (never the reverse: no "high enough" badge)
      if (a.evac) { evac.push({ ...e, hEff, need, low: hEff != null && hEff < need }); continue; }
      if (!(RC_ST.has(a.st) || structOf(a) === 'sturdy') || hEff == null) continue;
      if (hEff >= need) cand.push({ ...e, hEff, need });
    }
    evac.sort((a, b) => a.d - b.d); cand.sort((a, b) => a.d - b.d);
    Object.assign(tall, { level, levelNote, levelShort, evac, cand });
    const states = new Map();
    for (const e of cand) states.set(e.id, 1);
    for (const e of evac) states.set(e.id, 2);
    world.setHighlight(states);
    // 3-D tags only on DESIGNATED sites: an orange "tall building" sign reads as "run here", and nobody
    // knows whether that building is open (it stays as a colour, and as 【参考】 in the lists)
    for (const l of tall.labels) l.removeFromParent();
    tall.labels = evac.slice(0, 3).map((e) => {
      const el = document.createElement('div');
      el.className = 'lbl evacb';
      el.textContent = `【指定】津波の避難場所 約${mDist(e.d)}`;
      const l = new CSS2DObject(el);
      l.position.set(e.b.cx, e.b.top + 3, e.b.cz);
      l.center.set(0.5, 1);
      l.visible = $('tg-tall').checked;
      scene.add(l);
      return l;
    });
    renderTallHud();
  }
  const mDist = (d) => (d < 1000 ? `${Math.max(10, Math.round(d / 10) * 10)}m` : `${(d / 1000).toFixed(1)}km`);
  const TALL_NOTE = '逃げる場所として使えるか（指定・入口・開いている時間）は、市町村の情報で確かめてください。';
  function renderTallHud() {
    const el = $('h-tall');
    if (!hasStruct) {
      el.innerHTML = `<b>近くの建物</b><span>${nearB.length ? '建物の構造データ（PLATEAU）がない範囲のため、高い建物の判定はしていません。' : `地点から${EVAC_R}m以内に建物がありません。`}逃げる場所は「結果と、このあとすること」で確かめられます。</span><small class="must">${TALL_NOTE}</small>`;
      return;
    }
    const top = [...tall.evac, ...tall.cand].slice(0, 3);
    el.innerHTML = `<b>近くの建物<em>${EVAC_R}m以内・近い順</em></b>` +
      (top.length ? `<ul>${top.map((e) => (e.b.attrs.evac
        ? `<li class="evacb">【指定】${typeof e.b.attrs.evac === 'string' ? esc(e.b.attrs.evac.length > 14 ? e.b.attrs.evac.slice(0, 13) + '…' : e.b.attrs.evac) : '津波の避難場所'} 約${mDist(e.d)}<small>${e.hEff ? `高さ${e.hEff.toFixed(0)}m` : '高さ不明'}${e.low ? '・<b class="lowmark">水位に対して余裕が2m未満</b>' : ''}</small></li>`
        : `<li class="tallb">【参考】高い建物 約${mDist(e.d)}<small>${ST_JA[structOf(e.b.attrs)] ?? ''}・高さ${e.hEff.toFixed(0)}m・入れるかは不明</small></li>`)).join('')}</ul>`
        : '<span>条件に合う建物は見つかりませんでした（「逃げる場所がない」という意味ではありません）。</span>') +
      `<small class="crit">【指定】＝${EVAC_JA}（国土地理院データ）。【参考】＝鉄筋コンクリートなどの丈夫な造りで、高さが「水面の高さ＋2m」以上の建物（水面の高さ＝${tall.levelShort}。＋2mはこのサイトの仮の目安で、公式の基準ではありません）。</small><small class="must">【参考】の建物は、入れるか・上の階へ上がれるかは分かりません。<b>${TALL_NOTE}</b></small>`;
  }
  judgeTall(tall.level, tall.levelNote);

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
      const tgt = V(pinX + (sx - pinX) * 0.12, 5, pinZ + (sz - pinZ) * 0.12); // near the point: the dock covers the lower screen
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
  // nothing of the previous town may show for even a frame: its toast, its speed button, its numbers
  $('toast').hidden = true; $('toast-yes').hidden = false;
  document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === st.speed));
  $('play').textContent = '▶'; $('play').setAttribute('aria-label', '再生');
  $('h-now').textContent = '0.00'; $('h-max').textContent = '—'; $('h-v').textContent = '—'; $('h-arr-k').textContent = '水の先端まで'; $('h-arr').textContent = '—';
  $('h-say').textContent = '▶ を押すと、仮定の津波が動き出します'; $('h-say').className = 'say'; $('h-say-live').textContent = '';
  $('gauge-fill').style.width = '0%'; $('clock').textContent = '00:00'; $('phase').textContent = '待機（▶で開始）';
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
    world.uShowTall.value = $('tg-tall').checked ? 1 : 0;
    for (const l of tall.labels) l.visible = $('tg-tall').checked;
  };
  ['tg-depth', 'tg-off', 'tg-spray', 'tg-calm', 'tg-tall'].forEach((id) => on(id, 'change', applyToggles));
  applyToggles();
  on('result-btn', 'click', () => openResult());
  on('r-close', 'click', () => closeDialog($('result')));
  on('r-memo', 'click', () => memo.open());
  on('r-share', 'click', async () => {
    // the link carries the point and the conditions only — never this run's numbers (a bare "did not reach" travels badly)
    const u = new URL(location.href);
    u.search = ''; u.hash = '';
    const q = { lat: o.lat?.toFixed(5), lon: o.lon?.toFixed(5), h: H, tide: o.tide ?? 0, levee: o.levee?.enabled ? 1 : 0, crest: o.levee?.crest, breach: o.breach ? 1 : 0 };
    for (const [k, v] of Object.entries(q)) if (v != null) u.searchParams.set(k, String(v));
    const text = '津波の「もしも再現」です（予測ではありません）。この地点の公式想定と、逃げる場所を確かめられます。3Dの再現は条件しだいで結果が変わり、水が届かない結果が出ても、安全という意味ではありません。強い揺れや、弱くても長い揺れを感じたら、すぐ高い所へ。';
    const msg = $('r-share-msg');
    try {
      if (navigator.share) { await navigator.share({ title: '津波防災もしも再現', text, url: u.href }); msg.textContent = ''; }
      else { await navigator.clipboard.writeText(`${text}\n${u.href}`); msg.textContent = 'リンクをコピーしました。地点と条件だけを送ります（結果の数字は入りません）。'; }
    } catch (e) { if (e?.name !== 'AbortError') msg.textContent = `コピーできませんでした。このリンクを送ってください：${u.href}`; }
  });
  $('r-share').hidden = o.demo || o.lat == null;
  on('toast-yes', 'click', () => { $('tg-depth').checked = true; applyToggles(); $('toast').hidden = true; });
  on('toast-no', 'click', () => { $('toast').hidden = true; });
  const keyFn = (e) => { if (e.code === 'Space' && e.target === document.body && !anyDialogOpen()) { e.preventDefault(); ui.play(); } };
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
    if (tt < w.rise + w.hold + w.fall) return trapped ? '引き波：海は下がっても、この土地の水は引きにくいままです' : '引き波（水が海へ戻る）';
    return trapped ? '水が引きにくい土地です（排水されるまで残ることがあります）' : '終息に向かっています';
  }
  function say(h) {
    // not there yet: never a bare "not reached" — put the official figure (or the plain caveat) next to it
    if (h < 0.01) {
      const head = lead.time > total ? (st.arrived != null ? 'いまは水が引いています' : 'この仮定では、計算の間、ここに水は届きませんでした') : 'この仮定ではまだ届いていません';
      return [offState === 'hit' ? `${head}（安全という意味ではありません）。公式想定は、この付近で最大${Math.max(offCell.depth, offDeeper ? offAround.max : 0).toFixed(1)}m` : `${head}（安全という意味ではありません）`, ''];
    }
    return depthSay(h);
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
      // read out only when the band changes (0.3 / 1 / 2 m), never every frame
      const band = h < 0.01 ? 0 : h < 0.3 ? 1 : h < 1 ? 2 : h < 2 ? 3 : 4;
      if (band !== st.band) { if (st.band !== undefined && band > st.band) $('h-say-live').textContent = `ここの深さ ${h.toFixed(1)}メートル。${txt}`; st.band = band; }
      $('gauge-fill').style.width = `${Math.min(100, (h / 3) * 100)}%`;
      $('h-max').textContent = `${p.m[0].toFixed(2)}m`;
      $('h-v').textContent = h > 0.01 ? `${sp.toFixed(1)}m/s` : '—';
      // the arrival time of this run is NOT shown: it comes from the synthetic sea bed and the size of the
      // square, and any figure here is read as "minutes left". (st.arrived still drives the trapped-water text.)
      if (p.m[1] >= 0 && p.m[1] < 1e8) { $('h-arr-k').textContent = '水の先端'; $('h-arr').textContent = 'この地点に到達'; st.arrived = p.m[1]; }
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
      // first wooden house washed away (気象庁の目安: 浸水2mで木造家屋は全面破壊。首藤の津波強度階級による)
      if (!st.washSaid && solver.coast.washed > 0 && $('toast').hidden) {
        st.washSaid = true;
        $('toast-t').textContent = `周りの浸水深が2mに達し、${region.buildings.some((b) => b.woodEst) ? '木造などの普通建物（構造は推定）' : '木造家屋'}が流され始めました（気象庁の目安：2mで木造家屋は全面破壊）。`;
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

  // ── result: what to do comes first, the numbers after ──
  const OTHER = 'ほかのケースや、地震の揺れで堤防が早く壊れる場合、川をさかのぼる水では、';
  const OFF_SENT = () => {
    const arr = arrivalJa(offCell?.arrival);
    const cn = caseNote(o.info?.row);
    const tail = cn?.lower ? `<br><strong>ケース01は、この地域で津波が最も高くなるケースではありません</strong>（海岸の最大津波高：ケース01では${cn.c1}m、11ケースの最大は${cn.max}m）。浸水は、公式想定のこの値より深く・広くなることがあります。` : cn ? '' : '<br>この地域のケース別の津波高は確認できていません。ケース01より深く・広くなることがあります。';
    const s = {
      hit: offCell ? `公式想定（内閣府2025・ケース01）は、この100m四方で最大 <b class="num">${offCell.depth.toFixed(1)}m</b>${offDeeper ? `、周り300m以内では最大 <b class="num">${offAround.max.toFixed(1)}m</b>` : ''}。${arrivalSentence(offCell.arrival).replace(/<\/?b>/g, '')}<span class="notsafe">逃げるまでの猶予の時間ではありません</span>（${OTHER}もっと早く・深くなることがあります）。` : '',
      none: `公式想定（内閣府2025・ケース01）では、この100m四方に浸水のセルはありません。${offAround.n ? `<strong>ただし、${edgeJa(offAround.edge)}浸水の想定があります（周り300m以内の最大 <b class="num">${offAround.max.toFixed(1)}m</b>）。</strong>` : ''}<span class="notsafe">安全という意味ではありません</span>（${OTHER}浸水することがあります）。`,
      outside: 'この地点は、このサイトが収録している公式データの範囲の外です（<span class="notsafe">「浸水しない」という意味ではありません</span>）。自治体のハザードマップで確かめてください。',
      failed: '公式想定は取得できませんでした（通信）。<span class="notsafe">「浸水しない」という意味ではありません。</span>',
    }[offState];
    return s + (offState === 'hit' || offState === 'none' ? tail : '');
  };
  async function openResult() {
    labels.domElement.style.visibility = 'hidden'; // 3-D tags must never sit on top of the table
    // open at once: the call to act and the places to go do not wait for the GPU read-back
    $('r-key').innerHTML = '<p class="brief-wait">結果をまとめています…</p>';
    $('r-evac').innerHTML = o.demo ? '<p class="brief-none">合成の街（デモ）のため、逃げる場所のデータはありません。</p>' : evacHtml(null);
    $('r-hazard').href = o.lat != null ? hazardMapUrl(o.lat, o.lon) : 'https://disaportal.gsi.go.jp/';
    $('r-share-msg').textContent = '';
    // the nearest designated place goes right under the call to act: on a phone the full list can fall below the first screen
    $('r-near').hidden = true;
    o.briefP?.then(async (bf) => {
      const s = bf?.evac?.status === 'ok' ? bf.evac.sites[0] : null;
      if (!s) return;
      // the road distances usually arrive a moment after the places: wait briefly for them
      if (bf.routeP) await Promise.race([bf.routeP, new Promise((r) => setTimeout(r, 2500))]);
      if (!isDialogOpen($('result'))) return;
      // with road distances: the place nearest BY ROAD; without them: nearest in a straight line — and say which
      const rs = bf.route?.status === 'ok' ? bf.route.sites : null;
      let pick = 0;
      if (rs) { let best = Infinity; bf.evac.sites.forEach((_, k) => { if (rs[k]?.road != null && rs[k].road < best) { best = rs[k].road; pick = k; } }); }
      const sN = bf.evac.sites[pick];
      const road = rs?.[pick]?.road ?? null;
      const dWalk = road ?? sN.d;
      const w = walkMin(dWalk);
      $('r-near').innerHTML = `${road != null ? '道のりでいちばん近い' : '直線でいちばん近い'}、津波の指定緊急避難場所：<b>${esc(sN.name)}</b>　${road != null ? `道のり${distJa(road)}（目安・直線では${distJa(sN.d)}）` : `直線で${distJa(sN.d)}`}・${sN.bearing}の方向。歩く目安：約${w.fast}分（平均の速さでは約${w.real}分）${dWalk > 500 ? '<b class="lowmark">　500mを超えます</b>' : ''}<small>入口・開いている時間・何階まで上がれるかは、市町村の情報で確かめてください。ほかの場所は下の一覧に。</small>`;
      $('r-near').hidden = false;
    }).catch(() => {});
    if (!isDialogOpen($('result'))) {
      $('r-detail').open = !isSmall;
      openDialog($('result'), { opener: $('result-btn'), onClose: () => { labels.domElement.style.visibility = ''; } });
    }
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
    const done = lead.time > lead.wave.pre + lead.wave.rise + lead.wave.hold + lead.wave.fall;
    const mins = Math.max(1, Math.round((lead.time - lead.wave.pre) / 60));
    const washed = await solver.readWashed();
    if (washed) { world.markWashed(washed); st.washSeen = solver.coast.washed; }
    renderExtra(m, washed, done);
    if (!isDialogOpen($('result'))) return; // closed while the read-back was in flight

    // ── the key lines (never a bare "did not reach") ──
    // "prepare for the deepest" must use the deepest figure this screen itself shows: the run at the point, the run
    // within 100 m, the official cell, and the official cells within 300 m (land)
    const offTop = Math.max(offCell?.depth ?? 0, offAround.n ? offAround.max : 0);
    const simTop = Math.max(reached ? pm[0] : 0, cell100);
    const hi = Math.max(simTop, offTop);
    const hiFrom = offTop >= simTop ? (offDeeper || !offCell ? '公式想定・周り300m以内の最大' : '公式想定') : 'この再現';
    // a shallow figure is not something to "prepare for": below 0.3 m the line says so instead (善進本町: 0.2 m nearby,
    // on land below sea level, with a 5 m tsunami on its coast)
    const prep = hi >= 0.3 ? `<p class="r-prep">備えは、少なくとも、いちばん深い値（<b class="num">${hi.toFixed(1)}m</b>・${hiFrom}）で考えてください。${isSmall ? '' : `<small>${esc(depthSay(hi)[0])}</small>`}</p>`
      : hi > 0.01 ? `<p class="r-prep">ここに出ている浅い値（最大${hi.toFixed(1)}m）は、1つのケース・1つの条件だけの値で、備えの上限ではありません。<small>堤防を越えた水や、ほかのケースでは、もっと深く来ることがあります。水が来る前に、高い所へ。</small></p>` : '';
    const offP = `<p class="r-offline${offState === 'hit' || offAround.n ? ' strong' : ''}">${OFF_SENT()}</p>`;
    // conditions that no official scenario uses are named at the top, not only in the folded details
    const odd = [];
    if (region.leveeCells && !o.breach) odd.push('「壊れない防潮壁」（公式の想定にはない条件）');
    if (region.leveeCells && H <= o.levee.crest) odd.push(`海の高さ（${H.toFixed(1)}m）が防潮壁（T.P.+${o.levee.crest.toFixed(1)}m）より低い条件`);
    const oddP = odd.length ? `<p class="r-odd">この結果は、${odd.join('、')}で計算しています。安全の根拠にはなりません。</p>` : '';
    let key;
    if (!done) {
      key = `<p class="r-amber"><strong>まだ途中です（再現の時計 ${fmt(lead.time - lead.wave.pre)}）。</strong>途中の数字は結果ではありません。最後まで再生してから、もう一度開いてください。${reached ? `ここまでの最大は ${pm[0].toFixed(1)}m で、まだ増えることがあります。` : ''}</p>${oddP}${offP}${offTop > 0.01 ? prep : ''}`;
    } else if (reached) {
      key = `<p class="r-main">この仮定の波では、ここの深さは最大 <b class="num">${pm[0].toFixed(1)}m</b> になりました${cell100 > pm[0] + 0.05 ? `（周りの100m四方では最大${cell100.toFixed(1)}m）` : ''}。</p>${oddP}${offP}${prep}`;
    } else {
      key = `<p class="r-amber">この仮定の波では、計算した約${mins}分の間、ここに水は届きませんでした。<strong>安全という意味ではありません。</strong>計算したのは1つの波・1つの条件だけです。実際の津波は、長い時間くり返し来ます。</p>${oddP}${offP}${prep}`;
    }
    $('r-key').innerHTML = key;

    // ── where to go: designated sites only (the nationwide GSI data loaded on the pick screen) ──
    if (!o.demo) {
      const bf = o.briefP ? await o.briefP.catch(() => null) : null;
      if (!isDialogOpen($('result'))) return;
      // a note only where this run's water level can be compared with a known building height — and only the
      // unfavourable case is ever stated
      const notes = new Map();
      for (const s of bf?.evac?.sites ?? []) {
        const hit = tall.evac.find((e) => typeof e.b.attrs.evac === 'string' && (e.b.attrs.evac === s.name || e.b.attrs.evac.includes(s.name) || s.name.includes(e.b.attrs.evac)));
        if (hit?.low) notes.set(s.name, `<span class="evac-low">この再現では、建物の高さ（約${hit.hEff.toFixed(0)}m）が「水位＋2m」（地面から約${hit.need.toFixed(1)}m）に届きません。上の階まで水が来るおそれがあります。</span>`);
      }
      $('r-evac').innerHTML = bf?.evac ? evacHtml(bf.evac, { notes, letters: false, compact: true }) : evacHtml({ status: 'failed', sites: [] });
    }

    $('r-sub').textContent = `${$('t-name').textContent}　計算範囲 ${outerSolver ? `広域 ${(outerSolver.L / 1000).toFixed(1)}km四方（約${outerSolver.dx.toFixed(0)}m）＋地点周り ` : ''}${(L / 1000).toFixed(1)}km四方・格子 ${N}²（約${dx.toFixed(1)}m）・再現の時計 ${fmt(lead.time - lead.wave.pre)}（計算の始まりから）${done ? '' : '（まだ途中の値です）'}`;
    $('r-sim').innerHTML = `
      <div><dt>ここの深さ（最大）</dt><dd>${reached ? pm[0].toFixed(2) + 'm' : `<small>${done ? `この再現では、計算した約${mins}分の間は届かず` : 'ここまでは届いていません（途中）'}。安全という意味ではありません${Number.isFinite(st.closest) ? `（水の先端は最も近くて約${st.closest < 1000 ? Math.round(st.closest / 10) * 10 + 'm' : (st.closest / 1000).toFixed(1) + 'km'}まで）` : ''}</small>`}</dd></div>
      <div><dt>周辺100m四方の最大（10m平均・公式と同じ物差し）</dt><dd>${cell100 > 0.01 ? cell100.toFixed(2) + 'm' : `<small>${done ? 'この再現では、周りにも届かず' : 'ここまでは届いていません（途中）'}。安全という意味ではありません</small>`}</dd></div>
      <div><dt>最大の流れの速さ</dt><dd>${reached ? pm[2].toFixed(1) + 'm/s' : '—'}</dd></div>
      <div><dt>計算範囲内で水に浸かった陸地</dt><dd>${km2.toFixed(2)}km²</dd></div>
      <div><dt>条件</dt><dd><small>海の高さ ${H.toFixed(1)}m（仮定）／はじめの潮位 T.P.+${(o.tide ?? 0).toFixed(1)}m／${region.leveeCells ? `防潮壁 T.P.+${o.levee.crest.toFixed(1)}m・${o.breach ? '越流したら破壊' : '壊れない（公式の想定にはない条件）'}（壊れたセル ${solver.coast.breached}）` : '防潮壁なし'}／${solver.washDepth > 0 ? `木造家屋は浸水深${solver.washDepth}mで流失` : '木造家屋の流失なし'}</small></dd></div>`;
    const offCells = official?.cells ?? [];
    const inDom = offCells.filter((c) => Math.abs(c.x) < L / 2 && Math.abs(c.z) < L / 2);
    const arr = arrivalJa(offCell?.arrival);
    $('r-off').innerHTML = {
      hit: `<div><dt>周辺100m四方の最大浸水深</dt><dd>${offCell ? offCell.depth.toFixed(2) + 'm' : ''}</dd></div>
         <div><dt>最早到達（1cm・地震から）</dt><dd>${arr ? '最も早くて' + arr : '—'}<small>　猶予の時間ではありません</small></dd></div>
         ${offDeeper ? `<div><dt>周り300m以内の最大（陸のセル）</dt><dd>${offAround.max.toFixed(2)}m</dd></div>` : ''}
         <div><dt>計算範囲内の浸水セル（100m集約）</dt><dd>${inDom.length}個</dd></div>`,
      none: `<div><dt>周辺100m四方</dt><dd><small>このケースでは浸水セルなし（100m集約）。安全という意味ではありません。${offAround.n ? `${edgeJa(offAround.edge)}浸水の想定があります（周り300m以内の最大 ${offAround.max.toFixed(1)}m）。` : ''}</small></dd></div>
         <div><dt>計算範囲内の浸水セル（100m集約）</dt><dd>${inDom.length}個</dd></div>`,
      outside: '<div><dt>この範囲</dt><dd><small>収録している公式データの範囲の外。「浸水しない」という意味ではありません。</small></dd></div>',
      failed: '<div><dt>この範囲</dt><dd><small>公式想定を取得できませんでした（通信）。「浸水しない」という意味ではありません。地点を選び直すと、もう一度取得します。</small></dd></div>',
    }[offState];
    $('r-note').innerHTML = `<b>時刻について</b>：再現の時計は、計算の始まりからの時間で、実際の津波の時刻ではありません。公式想定の時刻は、地震が起きてからの、ケース01の最も早い到達です。どちらも、逃げるまでの猶予の時間ではありません。<br>` +
      (pinGround < 0.3 ? '<b>海面と同じか、海面より低い土地では、入った水は引きにくく、排水されるまで長く残ることがあります。</b>水が来る前に、高い所へ。水・食べ物・薬・トイレの備えも。<br>' : '') +
      `<b>再現と公式想定のちがい</b>：再現は、海岸に「海の高さ」（公式の11ケースの最大が初期値）の波を1つ入れた仮定の計算です。公式想定の枠は、ケース01だけの値です。${region.leveeCells ? '防潮壁は岸の線に置いた近似で、' : '防潮壁・水門、'}沖の高潮防波堤・地盤沈下・漂流物${solver.washDepth > 0 ? '' : '・建物の破壊'}は含みません${solver.washDepth > 0 ? '（建物の破壊は、木造家屋が浸水2mで流されることだけ）' : ''}。差は誤差ではなく、条件のちがいです。`;
    $('r-read').textContent = `文章で読む：${done ? (reached ? `この仮定の波では、選んだ地点は最大で${pm[0].toFixed(1)}メートルの深さになりました` : `この仮定の波では、計算した約${mins}分の間、選んだ地点に水は届きませんでした。安全という意味ではありません`) : 'まだ途中です'}。周辺100メートル四方では最大${cell100.toFixed(1)}メートル。公式想定は、${{ hit: offCell ? `最大${offCell.depth.toFixed(1)}メートル` : '', none: 'このケースでは浸水セルなし（安全という意味ではありません）', outside: '収録範囲の外', failed: '取得できませんでした' }[offState]}。強い揺れや、弱くても長い揺れを感じたら、すぐ高い所へ。`;
  }

  /** result extras: 垂直避難 / 建物ごとの公式比較 / 木造家屋の流失 */
  function renderExtra(m, washed, done) {
    // re-judge the tall buildings against this run's highest water level near the point
    let lv = -Infinity;
    const r2 = EVAC_R * EVAC_R;
    const ci0 = Math.max(0, Math.floor((pinX - EVAC_R + L / 2) / dx)), ci1 = Math.min(N - 1, Math.floor((pinX + EVAC_R + L / 2) / dx));
    const cj0 = Math.max(0, Math.floor((pinZ - EVAC_R + L / 2) / dx)), cj1 = Math.min(N - 1, Math.floor((pinZ + EVAC_R + L / 2) / dx));
    for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) {
      const x = -L / 2 + (i + 0.5) * dx - pinX, z = -L / 2 + (j + 0.5) * dx - pinZ;
      if (x * x + z * z > r2) continue;
      const k = j * N + i;
      if (region.water[k] || m[k * 4] < 0.05) continue;
      lv = Math.max(lv, m[k * 4 + 3]);
    }
    if (Number.isFinite(lv)) judgeTall(lv, `この再現で地点から${EVAC_R}m以内の最大水位 T.P.+${lv.toFixed(1)}m`, `この再現の最大 T.P.+${lv.toFixed(1)}m`);
    else judgeTall(H, `この再現では地点の周りに水が届かなかったため、海の高さ ${H.toFixed(1)}m（T.P.）を目安`, `海の高さ${H.toFixed(1)}m`);

    // max depth of this run just outside a building's footprint (its own cells are walls)
    const simAround = (id) => {
      const b = region.buildings[id];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of b.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      let best = 0;
      for (let j = Math.max(0, Math.floor((z0 + L / 2) / dx) - 2); j <= Math.min(N - 1, Math.floor((z1 + L / 2) / dx) + 2); j++)
        for (let i = Math.max(0, Math.floor((x0 + L / 2) / dx) - 2); i <= Math.min(N - 1, Math.floor((x1 + L / 2) / dx) + 2); i++) {
          const k = j * N + i;
          if (region.bldId[k] === id || region.water[k]) continue;
          best = Math.max(best, m[k * 4]);
        }
      return best;
    };
    let html = '';

    // 垂直避難
    const list = [...tall.evac, ...tall.cand].slice(0, 5);
    html += `<section class="rx"><h3>地点の周りの建物（${EVAC_R}m以内）：指定された避難場所と、参考の高い建物</h3>`;
    if (!hasStruct) html += `<p class="src">${nearB.length ? 'この範囲には建物の構造データ（PLATEAU）がないため、判定していません。' : `地点から${EVAC_R}m以内に建物がありません。`}</p>`;
    else if (!list.length) html += '<p class="src">条件に合う建物は見つかりませんでした。</p>';
    else html += `<table class="rtab"><thead><tr><th>種類</th><th>直線の距離</th><th>構造</th><th>高さ</th><th>用途</th><th>注記</th></tr></thead><tbody>${list.map((e) =>
      `<tr><td class="${e.b.attrs.evac ? 'evacb' : 'tallb'}">${e.b.attrs.evac ? `【指定】${EVAC_JA}${typeof e.b.attrs.evac === 'string' ? `<br><small>${esc(e.b.attrs.evac)}</small>` : ''}` : '【参考】高い建物'}</td><td>約${mDist(e.d)}</td><td>${ST_JA[structOf(e.b.attrs)] ?? '—'}</td><td>${e.hEff ? e.hEff.toFixed(1) + 'm' : '不明'}</td><td>${esc(e.b.attrs.u) || '—'}</td><td>${e.b.attrs.evac ? (e.low ? '<b class="lowmark">水位＋2mに届かない</b>' : e.hEff == null ? '高さ不明（水位と比べていません）' : '—') : '入れるか・上がれるかは不明'}</td></tr>`).join('')}</tbody></table>`;
    html += `<p class="src">【参考】の判定：RC・SRC・鉄骨造（構造種別がないデータでは、PLATEAU の建物区分「堅ろう建物」＝鉄筋コンクリート等・3階以上で代用）で、高さ（PLATEAU の計測高さ、なければ階数×3m）が「水位＋2m」以上（＋2mはこのサイトの仮の目安で、公式の基準ではありません）。水位＝${tall.levelNote}。【指定】は${EVAC_JA}の建物で、高さにかかわらず載せています。高さが分かり「水位＋2m」に届かないものだけ、注記しています（出典：${EVAC_SRC}。津波避難ビルの公式一覧との照合ではありません）。構造は PLATEAU の建物区分からの推定を含みます。距離は地点から建物の外周までの直線距離で、道のりではありません。</p>`;
    html += `<p class="note"><b>予測・推奨ではありません。${TALL_NOTE}</b>【参考】の建物は、高さと造りだけで機械的に選んだもので、入れるか、屋上や上の階へ上がれるかは分かりません。</p></section>`;

    // 建物ごとの比較: PLATEAU の建物別津波浸水想定 (td) があればそれ、なければ建物の中心で引いた内閣府の100m集約値。
    // 後者は「建物の位置での公式想定（100m集約）」であって建物ごとの公式値ではない — 見出しと列名で区別する
    const anyTd = region.buildings.some((b) => b.attrs?.td != null);
    const offOk = official?.covered || (official?.cells?.length ?? 0) > 0;
    const cand = [];
    region.buildings.forEach((b, id) => {
      if (b.kind === 'shed' || (anyTd && b.attrs?.td == null)) return;
      if (Math.hypot(b.cx - pinX, b.cz - pinZ) > 250) return;
      const d = distToRing(b.ring, pinX, pinZ);
      if (d <= 150) cand.push({ b, id, d });
    });
    cand.sort((a, b) => a.d - b.d);
    const rows = cand.slice(0, 8).map((e) => {
      const oc = anyTd ? null : officialAt(official, e.b.cx, e.b.cz);
      return { ...e, sim: simAround(e.id), off: anyTd ? e.b.attrs.td : oc ? oc.depth : offOk ? 0 : null, washedNow: !!washed?.[e.id] };
    });
    const offHead = anyTd ? '建物ごとの公式想定（PLATEAU）' : '建物の位置での公式想定（100m集約）';
    html += `<section class="rx"><h3>地点の近くの建物：${anyTd ? '建物ごとの公式想定' : '建物の位置での公式想定（100m集約）'} と この再現</h3>`;
    if (!rows.length) html += '<p class="src">地点から150m以内に比べられる建物がありません。</p>';
    else if (!anyTd && offState === 'failed') html += '<p class="src">公式想定を取得できなかった（通信）ため、比べられません。「浸水しない」という意味ではありません。</p>';
    else if (!anyTd && !offOk) html += '<p class="src">この範囲は内閣府の浸水データの収録範囲外（未確認）のため、比べられません。「浸水しない」という意味ではありません。</p>';
    else {
      const both = rows.filter((r) => r.off != null && r.off > 0.01);
      const mean = both.reduce((a, r) => a + (r.sim - r.off), 0) / Math.max(1, both.length);
      const f2 = (v) => (v > 0.01 ? v.toFixed(2) + 'm' : `<small>${done ? 'この再現では届かず' : 'ここまで届かず（途中）'}</small>`);
      const fOff = (r) => (r.off == null ? '—' : r.off > 0.01 ? r.off.toFixed(2) + 'm' : `<small>${anyTd ? '想定なし' : 'セルなし（ケース01）'}</small>`);
      html += `<table class="rtab"><thead><tr><th>距離</th><th>用途</th><th>構造</th><th>${offHead}</th><th>この再現（建物のすぐ外）</th><th>差</th></tr></thead><tbody>${rows.map((r) =>
        `<tr><td>約${mDist(r.d)}</td><td>${esc(r.b.attrs?.u) || '—'}</td><td>${r.b.attrs?.st ? ST_JA[r.b.attrs.st] : r.b.wood ? '普通建物<small>（木造など・推定）</small>' : ST_JA[structOf(r.b.attrs)] ?? '—'}${r.washedNow ? '<br><small>この再現で流失</small>' : ''}</td><td>${fOff(r)}</td><td>${f2(r.sim)}</td><td>${r.off == null || r.off <= 0.01 ? '—' : (r.sim - r.off >= 0 ? '+' : '−') + Math.abs(r.sim - r.off).toFixed(2) + 'm'}</td></tr>`).join('')}</tbody></table>
        <p class="src"><b>「セルなし」「届かず」は、安全という意味ではありません。</b>「セルなし」は、このケース（ケース01）の浸水データに、その100m四方が入っていないという意味です。</p>`;
      html += anyTd
        ? `<p class="src">公式想定＝PLATEAU の建物属性「津波浸水想定」の浸水深。この再現＝建物のすぐ外側の最大浸水深。`
        : `<p class="src"><b>公式想定の列は、建物の中心を含む100m四方の最大浸水深（内閣府 南海トラフの巨大地震モデル・被害想定手法検討会（2025）ケース01 を100mに集約）で、その建物ごとの公式値ではありません。</b>この地域の PLATEAU データには建物ごとの津波浸水想定の属性がないため、代わりに使っています。この再現＝建物のすぐ外側の最大浸水深（約${dx.toFixed(1)}m格子）。`;
      html += `${both.length ? `公式想定に値がある${both.length}棟の平均の差は ${(mean >= 0 ? '+' : '−') + Math.abs(mean).toFixed(2)}m。` : ''}津波の条件（波の形・潮位・堤防の扱い）と物差しが違うので、一致はしません。${done ? '' : '再現はまだ途中です。'}</p>`;
    }
    if (region.plateau?.source) html += `<p class="src">出典：${esc(region.plateau.source)}</p>`;
    html += '</section>';

    // 木造家屋の流失
    if (washed) {
      let all = 0, near = 0, woodNear = 0;
      region.buildings.forEach((b, id) => {
        if (!b.wood) return;
        const inR = Math.hypot(b.cx - pinX, b.cz - pinZ) <= EVAC_R;
        if (inR) woodNear++;
        if (washed[id]) { all++; if (inR) near++; }
      });
      const est = region.buildings.some((b) => b.woodEst);
      html += `<section class="rx"><h3>木造家屋の流失（浸水深2m・気象庁の目安。${est ? '多めに出る仮定' : '仮定'}）</h3><p>計算範囲で流された${est ? '木造などの普通建物（構造は推定）' : '木造家屋'} <b>${all}棟</b>（対象 ${solver.woodHouses}棟のうち）。地点から${EVAC_R}m以内では <b>${near}棟</b>（対象 ${woodNear}棟のうち）。</p>` +
        `<p class="src">${est ? '<b>構造は推定を含みます。</b>構造種別がない建物は、建物区分「普通建物」（PLATEAU、なければ国土地理院）を木造とみなしています。普通建物には2階建てのRC造なども含まれるので、実際より多く流れる側の仮定です。' : '木造かどうかは PLATEAU の構造種別で判断しています。'}流された家は壁でなくなるだけで、漂流物（がれき）がぶつかる力は計算していません。</p></section>`;
    }
    $('r-extra').innerHTML = html;
  }

  // ── frame loop ──
  let probeTick = 0;
  let fpsAcc = 0, fpsN = 0, fpsSec = 0, fpsGood = 0;
  prScale = 1; // every place starts sharp; a slow previous place must not carry its low resolution over
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
    // washed houses → forget them in the water shading and redraw the sun shadows (throttled, rare)
    if (solver.coast.washed !== (st.washSeen ?? 0) && !st.washBusy && now - (st.washAt ?? 0) > 6000) {
      st.washBusy = true; st.washAt = now;
      const seen = solver.coast.washed;
      solver.readWashed().then((w) => { if (w && app?.solver === solver) { world.markWashed(w); st.washSeen = seen; } }).catch(() => {}).finally(() => { st.washBusy = false; });
    }
    if (++probeTick % 4 === 0) solver.requestProbe(pinK);
    if (probeTick % 6 === 0) updateHud();
    // adaptive sub-step budget: keep the frame ≥ ~30 fps
    if (fixedDt === undefined) {
      fpsAcc += rdt; fpsN++;
      if (fpsAcc > 1) {
        const fps = fpsN / fpsAcc;
        // skip the first seconds (shader warm-up) and come back up on a 60 Hz screen: 55 fps for 3 s in a row is enough
        fpsSec++;
        fpsGood = fps >= 55 ? fpsGood + 1 : 0;
        if (fpsSec > 3 && fps < 40 && prScale > 0.6) { prScale *= 0.85; fpsGood = 0; onResize(); }
        else if (fpsGood >= 3 && prScale < 1) { prScale = Math.min(1, prScale * 1.15); fpsGood = 0; onResize(); }
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
      closeDialog();
      $('toast').hidden = true;
      labels.domElement.style.visibility = '';
      $('result').hidden = true;
      $('r-extra').innerHTML = '';
      labels.domElement.replaceChildren();
    },
    // debug / verification hooks
    frame, st, setView, openResult, camera, controls, outerSolver, lead, pin: { x: pinX, z: pinZ, k: pinK, ground: pinGround }, dir, tall,
  };
}

function onResize() {
  if (!innerWidth || !innerHeight || !renderer) return;
  renderer.setPixelRatio(basePR() * prScale);
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
  if (app) { app.camera.aspect = innerWidth / innerHeight; app.camera.updateProjectionMatrix(); }
}
addEventListener('resize', onResize);
// the height of the dock, for the things that must stay clear of it (toast, side panel)
if ('ResizeObserver' in window) new ResizeObserver(() => $('sim').style.setProperty('--dock-h', `${Math.ceil(document.querySelector('.dock').getBoundingClientRect().height)}px`)).observe(document.querySelector('.dock'));
// keep the dock above the (possibly two-line) credit
{
  const cr = document.querySelector('#sim .credit');
  if (cr && 'ResizeObserver' in window) new ResizeObserver(() => $('sim').style.setProperty('--credit-h', `${Math.ceil(cr.getBoundingClientRect().height) + 4}px`)).observe(cr);
}
document.addEventListener('visibilitychange', () => {
  if (!app) return;
  if (document.hidden) renderer.setAnimationLoop(null);
  else { app.st.lastT = performance.now(); renderer.setAnimationLoop(() => app.frame()); }
});

// ── deep links & verification hooks ──
if (qs.has('wash')) $('washaway').checked = qs.get('wash') !== '0';
if (qs.has('demo') && gpuOk) start({ demo: true, N: Number(qs.get('n') || 512), H: Number(qs.get('h') || 8), washaway: $('washaway').checked });
else if (qs.has('lat') && qs.has('lon')) {
  const lat = Number(qs.get('lat')), lon = Number(qs.get('lon'));
  picker.setPoint(lat, lon);
  if (qs.has('auto')) {
    const wait = setInterval(() => {
      if (sel.plan?.ok && !urlCondPending) { clearInterval(wait); $('go').click(); }
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

const CREDIT0 = {};

/** distance (m) from (x, z) to a footprint ring; 0 inside */
function distToRing(r, x, z) {
  let inside = false, best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const vx = xi - xj, vz = zi - zj, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - xj) * vx + (z - zj) * vz) / l2));
    best = Math.min(best, Math.hypot(xj + t * vx - x, zj + t * vz - z));
  }
  return inside ? 0 : best;
}
