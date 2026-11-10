// 「この地点の公式想定」— GPU を使わない。WebGPU がない端末でも、地点を選ぶだけでここまでは必ず出す。
//   ・内閣府（2025）ケース01 の100m集約：最大浸水深・最早到達（状態は4つ：あり／このケースではなし／収録外／取得失敗）
//   ・国土地理院 指定緊急避難場所（津波）：1km以内・近い順
//   ・地図：公式の浸水セル（浸水セルだけ）と、逃げる場所の記号
// 再現（3D）の数字はここには出さない。
import * as maplibregl from 'maplibre-gl';
import { officialNear, officialInBox, officialAround, caseNote, cellHasLand } from './data/official.js';
import { loadEvacSites, distJa, EVAC_SOURCE, EVAC_SOURCE_URL } from './data/evac.js';
import { loadDemMosaic, URLS } from './data/tiles.js';
import { $, esc, depthSay, hazardMapUrl, walkMin, arrivalSentence } from './ui.js';
import { planRoutes, highGround, ROUTE_RANGE_M } from './route.js';
import { ROAD_SOURCE, ROAD_SOURCE_URL } from './data/roads.js';

const NEAR = 300;      // これより遠い場所は見出しを分ける（このサイトの目安の区切り）
const RADIUS = 1000;   // 探す範囲
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const OFFICIAL_NAME = '内閣府（2025）南海トラフ巨大地震の津波浸水想定。11通りのうちの1つ「ケース01」を、100m四方ごとの値にまとめたもの';
const OTHER = 'ほかのケースや、地震の揺れで堤防が早く壊れる場合、川をさかのぼる水では、';

/** 海岸の津波高をケース別に見て、ケース01がこの地域の最大のケースかどうかを一文で */
export function caseHtml(info) {
  // silence would read as "ケース01 is the worst case": say what is (not yet) known in every state
  if (info == null) return '<p class="brief-case">ケース別の津波高を確認中…（ケース01より深く・広くなる地域があります）</p>';
  const n = caseNote(info?.row);
  if (!n) return `<p class="brief-case">${info.failed ? 'ケース別の津波高を取得できませんでした。' : 'この地域のケース別の津波高は確認できていません。'}ケース01より深く・広くなることがあります。</p>`;
  const who = info.guessed ? `近くの「${esc(info.borrowed ?? info.name)}」（この地点の市区町村を特定できなかったため、近くの値です）`
    : info.borrowed ? `近くの「${esc(info.borrowed)}」` : `「${esc(info.name)}」`;
  const base = `${who}の海岸の最大津波高（内閣府の一覧・1m単位）は、ケース01では${n.c1}m、11ケースの最大は${n.max}m（ケース${n.tops.map((k) => String(k).padStart(2, '0')).join('・')}）。`;
  return n.lower
    ? `<p class="brief-case warnish"><b>ケース01は、この地域で津波が最も高くなるケースではありません。</b>${base}浸水は、ここに出ている値より<b class="notsafe">深く・広くなることがあります</b>。自治体のハザードマップ（最大クラスの想定）で確かめてください。</p>`
    : `<p class="brief-case">${base}</p>`;
}

/** 「すぐ隣」か「約Nm先」か（100mセルの縁までの距離） */
export const edgeJa = (edge) => (edge < 50 ? 'すぐ隣の100m四方から' : `約${Math.round(edge / 10) * 10}m先から`);

/** 備えの基準にする公式の深さ：その100m四方と、周り300m以内の深いほう */
export const officialPrep = (o) => Math.max(o?.cell?.depth ?? 0, o?.around?.max ?? 0);

/** 公式想定の一文（状態ごと）。どの状態でも「安全」とは読めないようにする */
export function officialHtml(o, info = null) {
  if (!o) return '<p class="brief-wait">公式想定を確認中…</p>';
  const c = o.cell, a = o.around;
  const cs = caseHtml(info);
  const landNote = a?.landOnly ? '' : '（海や川の水面にかかるセルを含むことがあります）';
  if (o.state === 'hit') {
    const deeper = a?.n && a.max > c.depth + 0.05;
    const top = Math.max(c.depth, deeper ? a.max : 0);
    const [say] = depthSay(top);
    const partial = o.partial ? '<p class="src">周りの公式データの一部を取得できませんでした（通信）。周りの最大は、これより深いことがあります。</p>' : '';
    return `<div class="brief-nums"><div class="brief-main"><span class="k">この100m四方の最大浸水深</span><b class="brief-num">${c.depth.toFixed(1)}<i>m</i></b></div>${deeper ? `<div class="brief-main deeper"><span class="k">周り${a.R}m以内の最大<small>備えはこちらで</small></span><b class="brief-num">${a.max.toFixed(1)}<i>m</i></b></div>` : ''}</div>
      ${deeper && landNote ? `<p class="src">${landNote}</p>` : ''}
      <p class="brief-say">${esc(say)}</p>
      ${partial}<p class="brief-arr">${arrivalSentence(c.arrival)}<span class="notsafe">逃げるまでの猶予の時間ではありません。</span>${OTHER}もっと早く・深くなることがあります。</p>${cs}`;
  }
  if (o.state === 'none') {
    // a shallow or distant neighbour is NOT a figure to prepare for (善進本町: 0.2 m, 230 m away, on land below sea level)
    // (a deep value stays a figure to prepare for even when it is 100 m away: 金城ふ頭 has 3.2 m at 130 m)
    const weak = a?.n && (a.max < 0.3 || (a.max < 1 && a.edge >= 100));
    const near = !a?.n ? '' : weak
      ? `<b>ただし、${edgeJa(a.edge)}最大 ${a.max.toFixed(1)}m の浸水の想定があります。</b>これはケース01だけの値で、備えの上限ではありません。${landNote}`
      : `<b>ただし、${edgeJa(a.edge)}浸水の想定があります（周り${a.R}m以内の最大 ${a.max.toFixed(1)}m。備えは、少なくともこの深さで）。</b>${landNote}`;
    return `<p class="brief-none">このケース（ケース01）では、この100m四方に浸水のセルはありません。${near}<b class="notsafe">安全という意味ではありません。</b>${OTHER}浸水することがあります。水が来る前に高い所へ逃げられるよう、自治体のハザードマップで確かめてください。</p>${a?.n && !weak ? `<p class="brief-say">${esc(depthSay(a.max)[0])}</p>` : ''}${o.partial ? '<p class="src">周りの公式データの一部を取得できませんでした（通信）。</p>' : ''}${cs}`;
  }
  if (o.state === 'outside') return `<p class="brief-none">この地点は、このサイトが収録している公式データの範囲の外です。<b class="notsafe">「浸水しない」という意味ではありません。</b>自治体のハザードマップで確かめてください。</p>`;
  return `<p class="brief-fail">公式想定を取得できませんでした（通信の状態を確かめてください）。<b class="notsafe">「浸水しない」という意味ではありません。</b> <button type="button" class="ghost small" data-retry="official">もう一度</button></p>`;
}

/**
 * 津波から逃げる場所（指定緊急避難場所）の一覧。
 * @param ev      loadEvacSites() の結果（null = 確認中）
 * @param first   最初に見せる件数（残りは畳む）
 * @param notes   site.name → 注記HTML（再現の水位と比べられた建物だけ。肯定の表示は出さない）
 */
export function evacHtml(ev, { first = 3, notes = null, letters = true, compact = false } = {}) {
  if (!ev) return '<p class="brief-wait">逃げる場所を確認中…</p>';
  if (ev.status === 'failed') return `<p class="brief-fail">逃げる場所のデータを取得できませんでした（通信の状態を確かめてください）。<b class="notsafe">「近くにない」という意味ではありません。</b> <button type="button" class="ghost small" data-retry="evac">もう一度</button></p>`;
  if (!ev.sites.length) return `<p class="brief-none">1km以内には、このデータ（国土地理院）に津波の指定緊急避難場所は見つかりませんでした。<b class="notsafe">「逃げる場所がない」「津波が来ない」という意味ではありません。</b>データに載っていない市町村もあります。自治体のハザードマップで、高い場所と逃げる場所を確かめてください。</p>`;
  const item = (s, n) => {
    const w = walkMin(s.d);
    return `<li><button type="button" class="evac-item" data-evac="${n}">
      ${letters ? `<span class="evac-letter" aria-hidden="true">${LETTERS[n] ?? ''}</span>` : ''}
      <span class="evac-body"><b>${esc(s.name)}</b>
      <span class="evac-meta">直線で${distJa(s.d)}・${s.bearing}の方向</span>
      <span class="evac-meta">歩く目安：約${w.fast}分（実際の避難の平均の速さでは約${w.real}分）／歩くのが難しい人・乳幼児連れは約${w.slow}分${s.d > 500 ? '<b class="lowmark">　500mを超えます</b>' : ''}</span>
      ${s.address ? `<span class="evac-addr">${esc(s.address)}</span>` : ''}${s.remarks ? `<span class="evac-rem">備考：${esc(s.remarks)}</span>` : ''}${notes?.get(s.name) ?? ''}</span></button></li>`;
  };
  const near = [], farther = [];
  ev.sites.forEach((s, n) => (s.d <= NEAR ? near : farther).push([s, n]));
  const shown = (arr) => arr.filter(([, n]) => n < first).map(([s, n]) => item(s, n)).join('');
  const rest = ev.sites.map((s, n) => [s, n]).filter(([, n]) => n >= first);
  const intro = `<p class="evac-intro">津波から、まず命を守るために逃げ込む場所です（泊まるための「避難所」とは別です）。<b>入口・開いている時間・何階まで上がれるかは、市町村の情報で確かめてください。</b>海や川に近づく道にならないかも、地図で確かめてください。</p>`;
  // compact (the result screen on a phone): the first place must be visible without scrolling — the long note follows the list
  let h = compact ? '<p class="evac-intro">命を守るために逃げ込む場所です（「避難所」とは別）。<b>入口・時間・階は市町村で確認。</b></p>' : intro;
  if (near.some(([, n]) => n < first)) h += `<p class="evac-group">${NEAR}m以内</p><ul class="evac-list">${shown(near)}</ul>`;
  if (farther.some(([, n]) => n < first)) h += `<p class="evac-group far">${NEAR}mより遠い<small>早めに動く必要があります。歩くのが難しい人は、手を貸す人を決めておいてください。消防庁は、歩いて避難できる距離の目安を「最長でも500m程度」としています</small></p><ul class="evac-list">${shown(farther)}</ul>`;
  if (rest.length) h += `<details class="evac-more"><summary>ほか${rest.length}件を見る</summary><ul class="evac-list">${rest.map(([s, n]) => item(s, n)).join('')}</ul></details>`;
  if (ev.total > ev.sites.length) h += `<p class="src">1km以内にはほかに${ev.total - ev.sites.length}件あります（近い順に${ev.sites.length}件を表示）。</p>`;
  h += `<p class="evac-note"><b>距離は直線です。</b>川・運河・線路をまたぐと、道のりは大きく変わります。${letters ? '記号（A・B…）は近い順で、おすすめの順ではありません。' : ''}歩く目安は、まっすぐ歩けた場合の時間です（1.0m/秒。東日本大震災での実際の避難の平均は0.62m/秒。歩くのが難しい人・乳幼児連れは0.5m/秒）。夜・雨・混雑ではさらにかかります。${NEAR}mの区切りは、このサイトの目安です。${compact ? '海や川に近づく道にならないかも、地図で確かめてください。' : ''}</p>`;
  return h;
}

export const EVAC_CREDIT = `逃げる場所：<a href="${EVAC_SOURCE_URL}" target="_blank" rel="noopener">${EVAC_SOURCE}</a>（市町村長の指定をもとに国土地理院が整理。公開に同意した市町村のものだけが載っています。最新の状況は市町村に確認）。歩く速さ：1.0m/秒を目安、歩行困難者・乳幼児等は0.5m/秒。実際の避難の平均は0.62m/秒で、避難できる距離は最長でも500m程度が目安（消防庁「津波避難対策推進マニュアル検討会報告書」、国土交通省「津波防災まちづくりの計画策定に係る指針」）。`;

const DEPTH_COLOR = ['step', ['get', 'd'], '#ffffb3', 0.3, '#f7f5a9', 1, '#ffd8c0', 2, '#ffb7b7', 5, '#ff9191', 10, '#f285c9', 20, '#dc7adc'];
const MIN_ZOOM = 11.5;

/** keep only land cells in the "deepest nearby" figure, using the GSI 10 m DEM (no data = sea / water surface) */
async function landAround(lat, lon, o) {
  if (!o?.off?.cells?.length) return;
  try {
    const d = 340 / 110940, dl = 340 / (111320 * Math.cos((lat * Math.PI) / 180));
    const dem = await loadDemMosaic({ west: lon - dl, east: lon + dl, north: lat + d, south: lat - d }, 14, URLS.dem10);
    // no tile, or a tile that failed to load: land and water cannot be told apart everywhere — keep every cell
    // (and the caveat on screen) rather than silently dropping the cells under the missing tile
    if (!dem.got || dem.failed) return;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    o.around = officialAround(o.off, 0, 0, 300, (c) => cellHasLand((x, z) => !Number.isNaN(dem.sample(c.lat - z / 110940, c.lon + x / kx, true))));
  } catch { /* keep the unfiltered figure */ }
}

const walkJa = (d) => { const w = walkMin(d); return `歩く目安：約${w.fast}分（実際の避難の平均の速さでは約${w.real}分）／歩くのが難しい人・乳幼児連れは約${w.slow}分`; };
const over500 = (d) => (d > 500 ? '<b class="lowmark">　500mを超えます</b>' : '');

/**
 * 逃げる道のり（目安）の一覧。
 * @param rt   { status, sites:[{road,path,elev}], highs:[{level,label,res}], here } | null（確認中）
 * @param ev   逃げる場所（rt.sites と同じ並び）
 * @param H    波の条件（海の高さ m）
 * @param sel  選ばれている行き先（'s0'…/'h0'/'h1'）
 */
export function routeHtml(rt, ev, H, sel = null, canChange = false) {
  if (!rt) return '<p class="brief-wait">道のりを確認中…</p>';
  if (rt.status === 'failed') return '<p class="brief-fail">道のりを取得できませんでした（通信の状態を確かめてください）。直線距離の一覧は、上に出ています。 <button type="button" class="ghost small" data-retry="route">もう一度</button></p>';
  if (rt.status !== 'ok') return '<p class="brief-none">近くに道のデータがありません（地図データにない道かもしれません）。上の、直線距離の一覧を使ってください。</p>';
  const pressed = (id) => `aria-pressed="${sel === id}"`;
  let h = `<p class="route-wave">波の条件：<b>海の高さ ${H.toFixed(1)}m</b><small>（海岸での津波の高さ。初期値は内閣府の最大津波高${canChange ? '。下の「3Dで再現する」の海の高さを変えると、高い所の行き先も変わります' : ''}）</small></p>
    <p class="route-note">道のりは、地図データから求めた目安です。<b>通れるとは限りません</b>（建物の倒壊・液状化・夜や雨など）。津波が来る前に逃げる想定で、浸水する道も避けていません。<b>実際に歩いて確かめてください。</b></p>`;
  // designated sites: the three nearest by road
  const sites = ev?.status === 'ok' ? ev.sites : [];
  const idx = sites.map((_, i) => i).filter((i) => rt.sites[i]?.road != null).sort((a, b) => rt.sites[a].road - rt.sites[b].road);
  const lost = sites.map((_, i) => i).filter((i) => rt.sites[i]?.road == null);
  h += '<ul class="route-list">';
  for (const i of idx.slice(0, 3)) {
    const s = sites[i], r = rt.sites[i];
    h += `<li><button type="button" class="route-item site" data-route="s${i}" ${pressed('s' + i)}>
      <span class="route-tag site">指定</span><span class="evac-body"><b>${LETTERS[i] ?? ''}　${esc(s.name)}</b>
      <span class="evac-meta">道のり ${distJa(r.road)}（直線では${distJa(s.d)}）${over500(r.road)}</span>
      <span class="evac-meta">${walkJa(r.road)}</span>
      ${r.elev == null ? '<span class="evac-addr">地面の標高は取得できませんでした</span>'
        : r.elev < H ? `<span class="evac-low">地面の標高 約${r.elev.toFixed(1)}m：海の高さ（${H.toFixed(1)}m）より低い場所です。建物なら、できるだけ上の階へ</span>`
          : `<span class="evac-addr">地面の標高 約${r.elev.toFixed(1)}m（海の高さ ${H.toFixed(1)}m 以上）</span>`}</span></button></li>`;
  }
  // high ground: the wave height, and twice the wave height
  let anyHigh = false;
  rt.highs.forEach((hg, n) => {
    const r = hg.res;
    if (r.found && r.dist < 60) {
      anyHigh = true;
      h += `<li class="route-miss"><span class="route-tag high">高い所</span>${hg.label}：この地点のまわりは、標高 約${r.elev.toFixed(1)}m で、すでにこの高さ以上です。</li>`;
    } else if (r.found) {
      anyHigh = true;
      h += `<li><button type="button" class="route-item high" data-route="h${n}" ${pressed('h' + n)}>
        <span class="route-tag high">高い所</span><span class="evac-body"><b>${hg.label}</b>
        <span class="evac-meta">道のり ${distJa(r.dist)}・標高 約${r.elev.toFixed(1)}m${over500(r.dist)}</span>
        <span class="evac-meta">${walkJa(r.dist)}</span></span></button></li>`;
    } else {
      h += `<li class="route-miss"><span class="route-tag high">高い所</span>${hg.label}：${r.reason === 'nodem' ? '標高を取得できませんでした（通信）。' : `この範囲（地点から約${(ROUTE_RANGE_M / 1000).toFixed(1)}km以内）の道路には、見つかりませんでした。`}</li>`;
    }
  });
  h += '</ul>';
  if (!idx.length && !lost.length && ev?.status === 'ok') h += '<p class="evac-note">この範囲には、指定された逃げる場所への道のりはありません（上の一覧のとおり、1km以内に見つかっていません）。</p>';
  if (lost.length) h += `<p class="evac-note">道がつながらなかった場所：${lost.map((i) => `${LETTERS[i] ?? ''}（${esc(sites[i].name)}）`).join('、')}。地図にない道があるかもしれません。直線距離は上の一覧に出ています。</p>`;
  if (!anyHigh && rt.highs.every((x) => x.res.reason !== 'nodem')) h += '<p class="evac-note"><b>この範囲は平らな土地です。</b>高い所が遠いときは、指定された逃げる場所の、できるだけ上の階へ。</p>';
  h += `<p class="route-note"><b>標高が海の高さより高くても、津波が来ないという意味ではありません。</b>気象庁によると、津波が陸をかけ上がる高さは、海岸での津波の高さの2〜4倍に達することが多いとされています。できるだけ高い所へ。「高い所」は、標高（まわり50mを含む）と海の高さを比べて選んだもので、市町村が決めた避難の目標地点ではありません。指定された逃げる場所の、何階まで上がれるか・入口・開いている時間は、市町村の情報で確かめてください。並びは道のりの近い順で、おすすめの順ではありません。</p>
    <p class="src">道のり：<a href="${ROAD_SOURCE_URL}" target="_blank" rel="noopener">${ROAD_SOURCE}</a>と、地理院タイル（標高タイル）を加工して作成。地図にない細い道・階段・歩道橋は入っていません。高速道路は通りません。</p>`;
  return h;
}

export function createBrief({ map, getH = () => 5 }) {
  const el = $('brief');
  let token = 0;
  let cur = null; // { lat, lon, official, evac, info }
  let markers = [];
  let highMarkers = [];
  let routeSel = null;
  const ready = map ? new Promise((r) => map.once('load', r)) : new Promise(() => {}); // no map (no WebGL2): text only

  // ── 地図：公式の浸水セル（浸水セルだけを塗る。塗られない所を「安全」の色で塗らない） ──
  ready.then(() => {
    map.addSource('off-cells', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'off-cells', type: 'circle', source: 'off-cells', minzoom: MIN_ZOOM,
      paint: {
        'circle-color': DEPTH_COLOR, 'circle-opacity': 0.72,
        'circle-stroke-color': 'rgba(120,50,50,.55)', 'circle-stroke-width': 0.6,
        // ≈ 50 m on the ground (the 100 m cell): radius doubles per zoom level
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 10, 0.4, 18, 102],
      },
    });
    let seq = 0;
    const refresh = async () => {
      const my = ++seq;
      const note = $('map-note');
      const src = map.getSource('off-cells');
      if (!src) return;
      if (map.getZoom() < MIN_ZOOM) { src.setData({ type: 'FeatureCollection', features: [] }); if (note) note.dataset.state = 'far'; return; }
      const b = map.getBounds();
      try {
        const { rows, failed } = await officialInBox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
        if (my !== seq) return;
        src.setData({ type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r[0], r[1]] }, properties: { d: r[2] } })) });
        if (note) note.dataset.state = failed ? 'failed' : 'ok';
      } catch { if (my === seq && note) note.dataset.state = 'failed'; }
    };
    map.on('moveend', refresh);
    // the ways to the places to flee to: one line per destination (never a single "right" route)
    map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'sel'], 1], 9, 6], 'line-opacity': 0.95 } });
    map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'kind'], 'high', '#c2410c', '#15803d'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 6, 3.5], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.8] } });
    drawRoutes();
    refresh();
  });

  function clearMarkers() { for (const m of markers) m.remove(); markers = []; }

  // ── 逃げる道のり ──
  const routeFeatures = () => {
    const rt = cur?.route, out = [];
    if (rt?.status !== 'ok') return out;
    const sites = cur.evac?.status === 'ok' ? cur.evac.sites : [];
    const idx = sites.map((_, i) => i).filter((i) => rt.sites[i]?.path).sort((a, b) => rt.sites[a].road - rt.sites[b].road).slice(0, 3);
    for (const i of idx) out.push({ id: 's' + i, kind: 'site', path: rt.sites[i].path });
    rt.highs.forEach((hg, n) => { if (hg.res.found && hg.res.dist >= 60) out.push({ id: 'h' + n, kind: 'high', path: hg.res.path, lat: hg.res.lat, lon: hg.res.lon }); });
    return out;
  };
  function drawRoutes() {
    for (const m of highMarkers) m.remove();
    highMarkers = [];
    if (!map) return;
    const feats = routeFeatures();
    const src = map.getSource('routes');
    // the selected line is drawn last (on top)
    feats.sort((a, b) => (a.id === routeSel) - (b.id === routeSel));
    if (src) src.setData({ type: 'FeatureCollection', features: feats.map((f) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: f.path }, properties: { id: f.id, kind: f.kind, sel: f.id === routeSel ? 1 : 0 } })) });
    for (const f of feats) if (f.kind === 'high') {
      const m = document.createElement('div');
      m.className = 'high-marker';
      m.textContent = '高';
      m.title = '高い所（標高と海の高さを比べて選んだ地点。市町村が決めた避難の目標地点ではありません）';
      highMarkers.push(new maplibregl.Marker({ element: m, anchor: 'center' }).setLngLat([f.lon, f.lat]).addTo(map));
    }
  }
  /** the high-ground destinations depend on the wave condition (海の高さ): recomputed whenever it changes */
  function computeHighs() {
    const rt = cur?.route;
    if (rt?.status !== 'ok') return;
    const H = getH();
    rt.H = H;
    rt.highs = [
      { level: H, label: `海の高さ（${H.toFixed(1)}m）より高い所`, res: highGround(rt, H) },
      { level: 2 * H, label: `海の高さの2倍（${(2 * H).toFixed(1)}m）より高い所`, res: highGround(rt, 2 * H) },
    ];
    if (routeSel && !routeFeatures().some((f) => f.id === routeSel)) routeSel = null;
  }
  async function loadRoute(lat, lon, c, my) {
    c.route = null; part('route');
    let rt;
    try { rt = await planRoutes(lat, lon, c.evac?.status === 'ok' ? c.evac.sites : []); } catch (e) { console.warn('route', e); rt = { status: 'failed' }; }
    if (my !== token) return;
    c.route = rt;
    computeHighs(); drawRoutes(); part('route');
  }
  function drawMarkers(ev) {
    clearMarkers();
    if (ev?.status !== 'ok' || !map) return;
    ev.sites.forEach((s, n) => {
      const m = document.createElement('div');
      m.className = 'evac-marker';
      m.textContent = LETTERS[n] ?? '';
      m.title = `津波の指定緊急避難場所：${s.name}`;
      markers.push(new maplibregl.Marker({ element: m, anchor: 'center' }).setLngLat([s.lon, s.lat]).addTo(map));
    });
  }

  // the card is built once per point; afterwards each part is replaced on its own, so a late answer
  // (the municipality, a retry) never folds the list someone is reading or throws their focus away
  function skeleton() {
    el.hidden = false;
    el.innerHTML = `
      <h2 class="brief-h" id="brief-h" tabindex="-1">この地点の公式想定<small>${OFFICIAL_NAME}</small></h2>
      <div class="brief-off" id="brief-off"></div>
      <h3 class="brief-h3">津波から逃げる場所<small>指定緊急避難場所（津波）・1km以内の近い順</small></h3>
      <div class="brief-evac" id="brief-evac"></div>
      <h3 class="brief-h3">逃げる道のり（目安）<small>指定された逃げる場所と、高い所まで。歩く道の網で、いちばん短い道</small></h3>
      <div class="brief-route" id="brief-route"></div>
      <p class="brief-links" id="brief-links"></p>
      <p class="src">${EVAC_CREDIT}</p>`;
    part('off'); part('evac'); part('route'); part('links');
  }
  function part(which) {
    if (!cur || !$('brief-off')) return;
    if (which === 'off') $('brief-off').innerHTML = officialHtml(cur.official, cur.info);
    if (which === 'evac') $('brief-evac').innerHTML = evacHtml(cur.evac);
    if (which === 'route') {
      // rebuilt when the wave height changes or a line is chosen: keep the reader's place
      const f = document.activeElement, key = $('brief-route').contains(f) ? f.getAttribute('data-route') : null;
      $('brief-route').innerHTML = routeHtml(cur.route, cur.evac, cur.route?.H ?? getH(), routeSel, !$('sim-setup')?.hidden);
      if (key) $('brief-route').querySelector(`[data-route="${key}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (which === 'links') {
      // rebuilt when the municipality arrives: keep the reader's focus on the same control
      const f = document.activeElement, key = $('brief-links').contains(f) ? (f.id || f.getAttribute('href')) : null;
      renderLinks();
      if (key) [...$('brief-links').querySelectorAll('a, button')].find((n) => n.id === key || n.getAttribute('href') === key)?.focus({ preventScroll: true });
    }
    say();
  }
  function renderLinks() {
    $('brief-links').innerHTML = `
        <a class="linkbtn" href="${hazardMapUrl(cur.lat, cur.lon)}" target="_blank" rel="noopener">重ねるハザードマップで、この地点を確かめる<small>（国土地理院・別の画面が開きます）</small></a>
        ${String(cur.info?.code ?? '').startsWith('231') && !cur.info?.guessed ? '<a class="linkbtn" href="https://www.city.nagoya.jp/bousaiportal/hinan/1013390/1013420.html" target="_blank" rel="noopener">名古屋市の津波避難ビルの一覧を見る<small>（名古屋市・別の画面が開きます）</small></a>' : ''}
        <button type="button" class="ghost" id="brief-memo">わが家の避難メモを書く</button>`;
  }
  // read out once both parts have settled, and again whenever a retry changes the answer
  function say() {
    if (!cur?.official || !cur?.evac) return;
    const o = cur.official, e = cur.evac;
    const t = `公式想定：${o.state === 'hit' ? `この100メートル四方の最大浸水深${o.cell.depth.toFixed(1)}メートル${o.around?.n && o.around.max > o.cell.depth + 0.05 ? `、周り300メートル以内の最大${o.around.max.toFixed(1)}メートル` : ''}` : o.state === 'none' ? `このケースでは、この100メートル四方に浸水のセルなし${o.around?.n ? `。ただし近くに最大${o.around.max.toFixed(1)}メートルの想定` : ''}。安全という意味ではありません` : o.state === 'outside' ? '収録範囲の外。浸水しないという意味ではありません' : '取得できませんでした。浸水しないという意味ではありません'}。逃げる場所：${e.status === 'failed' ? '取得できませんでした' : e.sites.length ? `${e.sites[0].name}、直線で${distJa(e.sites[0].d)}` : '1キロ以内には見つかりませんでした'}。`;
    if ($('brief-live').textContent !== t) $('brief-live').textContent = t;
  }

  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-retry]');
    if (r && cur) { if (r.dataset.retry === 'route') loadRoute(cur.lat, cur.lon, cur, token); else load(cur.lat, cur.lon, r.dataset.retry); return; }
    const rb = e.target.closest('[data-route]');
    if (rb && cur?.route?.status === 'ok') {
      routeSel = routeSel === rb.dataset.route ? null : rb.dataset.route;
      drawRoutes(); part('route');
      const f = routeFeatures().find((x) => x.id === routeSel);
      if (f && map) {
        const xs = f.path.map((q) => q[0]), ys = f.path.map((q) => q[1]);
        const pad = innerWidth > 760 ? { left: Math.min(460, innerWidth * 0.4) + 40, top: 80, right: 60, bottom: 60 } : { left: 40, right: 40, top: 110, bottom: innerHeight * 0.62 + 30 };
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: pad, maxZoom: 17, duration: 700 });
      }
      return;
    }
    const b = e.target.closest('[data-evac]');
    if (b && cur?.evac?.sites) {
      const s = cur.evac.sites[Number(b.dataset.evac)];
      if (s && map) map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15.5), speed: 1.4 });
      return;
    }
    if (e.target.closest('#brief-memo')) el.dispatchEvent(new CustomEvent('memo', { bubbles: true }));
  });

  async function load(lat, lon, only = null) {
    const my = token, c = cur;
    const jobs = [];
    if (!only || only === 'official') {
      c.official = null; part('off');
      // the official figure is shown as soon as it is known; the land/water refinement (a second download) only
      // replaces the "deepest nearby" figure afterwards — it never holds the card back
      jobs.push(officialNear(lat, lon).then(async (o) => {
        if (my === token) { c.official = o; part('off'); }
        const refine = landAround(lat, lon, o).then(() => { if (my === token) part('off'); });
        await Promise.race([refine, new Promise((r) => setTimeout(r, 12000))]); // a slower answer still updates the card when it comes
      }));
    }
    if (!only || only === 'evac') {
      c.evac = null; part('evac');
      jobs.push(loadEvacSites(lat, lon, RADIUS, 5).then((ev) => {
        if (my !== token) return;
        c.evac = ev; drawMarkers(ev); part('evac');
        // the ways there are worked out once the places are known — and never hold the card (or the 3-D run) back
        c.routeP = loadRoute(lat, lon, c, my);
      }));
    }
    await Promise.all(jobs);
    return c;
  }

  return {
    /** a new point: show "確認中…" at once, discard any older answer */
    update(lat, lon) {
      token++;
      clearMarkers();
      routeSel = null;
      cur = { lat, lon, official: null, evac: null, info: null, route: null };
      drawRoutes();
      $('brief-live').textContent = '';
      skeleton();
      return load(lat, lon);
    },
    /** municipality + Cabinet-Office coastal heights per case (from tsunamiHeightAt) */
    setInfo(info) { if (cur) { cur.info = info; part('off'); part('links'); } },
    /** the wave condition changed: the high-ground destinations move with it */
    setWave() { if (cur?.route?.status === 'ok') { computeHighs(); drawRoutes(); part('route'); } },
    get current() { return cur; },
  };
}
