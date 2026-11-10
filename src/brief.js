// 「この地点の公式想定」— GPU を使わない。WebGPU がない端末でも、地点を選ぶだけでここまでは必ず出す。
//   ・内閣府（2025）ケース01 の100m集約：最大浸水深・最早到達（状態は4つ：あり／このケースではなし／収録外／取得失敗）
//   ・国土地理院 指定緊急避難場所（津波）：1km以内・近い順
//   ・地図：公式の浸水セル（浸水セルだけ）と、逃げる場所の記号
// 再現（3D）の数字はここには出さない。
import * as maplibregl from 'maplibre-gl';
import { officialNear, officialInBox, officialAround, caseNote } from './data/official.js';
import { loadEvacSites, distJa, EVAC_SOURCE, EVAC_SOURCE_URL } from './data/evac.js';
import { loadDemMosaic, URLS } from './data/tiles.js';
import { $, esc, depthSay, hazardMapUrl, walkMin, arrivalJa } from './ui.js';

const NEAR = 300;      // これより遠い場所は見出しを分ける（このサイトの目安の区切り）
const RADIUS = 1000;   // 探す範囲
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const OFFICIAL_NAME = '内閣府（2025）南海トラフ巨大地震の津波浸水想定。11通りのうちの1つ「ケース01」を、100m四方ごとの値にまとめたもの';
const OTHER = 'ほかのケースや、地震の揺れで堤防が早く壊れる場合、川をさかのぼる水では、';

/** 海岸の津波高をケース別に見て、ケース01がこの地域の最大のケースかどうかを一文で */
export function caseHtml(info) {
  const n = caseNote(info?.row);
  // no per-case figures (no municipality, or not in the table): silence would read as "ケース01 is the worst case"
  if (!n) return info ? '<p class="brief-case">この地域のケース別の津波高は確認できていません。ケース01より深く・広くなることがあります。</p>' : '';
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
    const arr = arrivalJa(c.arrival);
    return `<div class="brief-nums"><div class="brief-main"><span class="k">この100m四方の最大浸水深</span><b class="brief-num">${c.depth.toFixed(1)}<i>m</i></b></div>${deeper ? `<div class="brief-main deeper"><span class="k">周り${a.R}m以内の最大<small>備えはこちらで</small></span><b class="brief-num">${a.max.toFixed(1)}<i>m</i></b></div>` : ''}</div>
      ${deeper && landNote ? `<p class="src">${landNote}</p>` : ''}
      <p class="brief-say">${esc(say)}</p>
      <p class="brief-arr">${arr ? `地震から<b>最も早くて${arr}</b>で水が来はじめる想定です。` : ''}<span class="notsafe">逃げるまでの猶予の時間ではありません。</span>${OTHER}もっと早く・深くなることがあります。</p>${cs}`;
  }
  if (o.state === 'none') {
    const near = a?.n ? `<b>ただし、${edgeJa(a.edge)}浸水の想定があります（周り${a.R}m以内の最大 ${a.max.toFixed(1)}m。備えはこの深さで）。</b>${landNote}` : '';
    return `<p class="brief-none">このケース（ケース01）では、この100m四方に浸水のセルはありません。${near}<b class="notsafe">安全という意味ではありません。</b>${OTHER}浸水することがあります。自治体のハザードマップで確かめてください。</p>${a?.n ? `<p class="brief-say">${esc(depthSay(a.max)[0])}</p>` : ''}${cs}`;
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
export function evacHtml(ev, { first = 3, notes = null, letters = true } = {}) {
  if (!ev) return '<p class="brief-wait">逃げる場所を確認中…</p>';
  if (ev.status === 'failed') return `<p class="brief-fail">逃げる場所のデータを取得できませんでした（通信の状態を確かめてください）。<b class="notsafe">「近くにない」という意味ではありません。</b> <button type="button" class="ghost small" data-retry="evac">もう一度</button></p>`;
  if (!ev.sites.length) return `<p class="brief-none">1km以内には、このデータ（国土地理院）に津波の指定緊急避難場所は見つかりませんでした。<b class="notsafe">「逃げる場所がない」「津波が来ない」という意味ではありません。</b>データに載っていない市町村もあります。自治体のハザードマップで、高い場所と逃げる場所を確かめてください。</p>`;
  const item = (s, n) => {
    const w = walkMin(s.d);
    return `<li><button type="button" class="evac-item" data-evac="${n}">
      ${letters ? `<span class="evac-letter" aria-hidden="true">${LETTERS[n] ?? ''}</span>` : ''}
      <span class="evac-body"><b>${esc(s.name)}</b>
      <span class="evac-meta">直線で${distJa(s.d)}・${s.bearing}の方向</span>
      <span class="evac-meta">歩く目安：約${w.fast}分／歩くのが難しい人・乳幼児連れは約${w.slow}分</span>
      ${s.address ? `<span class="evac-addr">${esc(s.address)}</span>` : ''}${s.remarks ? `<span class="evac-rem">備考：${esc(s.remarks)}</span>` : ''}${notes?.get(s.name) ?? ''}</span></button></li>`;
  };
  const near = [], farther = [];
  ev.sites.forEach((s, n) => (s.d <= NEAR ? near : farther).push([s, n]));
  const shown = (arr) => arr.filter(([, n]) => n < first).map(([s, n]) => item(s, n)).join('');
  const rest = ev.sites.map((s, n) => [s, n]).filter(([, n]) => n >= first);
  let h = `<p class="evac-intro">津波から、まず命を守るために逃げ込む場所です（泊まるための「避難所」とは別です）。<b>入口・開いている時間・何階まで上がれるかは、市町村の情報で確かめてください。</b>海や川に近づく道にならないかも、地図で確かめてください。</p>`;
  if (near.some(([, n]) => n < first)) h += `<p class="evac-group">${NEAR}m以内</p><ul class="evac-list">${shown(near)}</ul>`;
  if (farther.some(([, n]) => n < first)) h += `<p class="evac-group far">${NEAR}mより遠い<small>早めに動く必要があります。歩くのが難しい人は、手を貸す人を決めておいてください</small></p><ul class="evac-list">${shown(farther)}</ul>`;
  if (rest.length) h += `<details class="evac-more"><summary>ほか${rest.length}件を見る</summary><ul class="evac-list">${rest.map(([s, n]) => item(s, n)).join('')}</ul></details>`;
  if (ev.total > ev.sites.length) h += `<p class="src">1km以内にはほかに${ev.total - ev.sites.length}件あります（近い順に${ev.sites.length}件を表示）。</p>`;
  h += `<p class="evac-note"><b>距離は直線です。</b>川・運河・線路をまたぐと、道のりは大きく変わります。${letters ? '記号（A・B…）は近い順で、おすすめの順ではありません。' : ''}歩く目安は、まっすぐ歩けた場合の時間です（1.0m/秒。歩くのが難しい人・乳幼児連れは0.5m/秒）。実際の避難はもっとゆっくりで、夜・雨・混雑ではさらにかかります。${NEAR}mの区切りは、このサイトの目安です。</p>`;
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
    if (!dem.got) return; // no tile at all: cannot tell — keep every cell (and the caveat on screen)
    o.around = officialAround(o.off, 0, 0, 300, (c) => !Number.isNaN(dem.sample(c.lat, c.lon, true)));
  } catch { /* keep the unfiltered figure */ }
}

export function createBrief({ map }) {
  const el = $('brief');
  let token = 0;
  let cur = null; // { lat, lon, official, evac, info }
  let markers = [];
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
    refresh();
  });

  function clearMarkers() { for (const m of markers) m.remove(); markers = []; }
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
      <p class="brief-links" id="brief-links"></p>
      <p class="src">${EVAC_CREDIT}</p>`;
    part('off'); part('evac'); part('links');
  }
  function part(which) {
    if (!cur || !$('brief-off')) return;
    if (which === 'off') $('brief-off').innerHTML = officialHtml(cur.official, cur.info);
    if (which === 'evac') $('brief-evac').innerHTML = evacHtml(cur.evac);
    if (which === 'links') $('brief-links').innerHTML = `
        <a class="linkbtn" href="${hazardMapUrl(cur.lat, cur.lon)}" target="_blank" rel="noopener">重ねるハザードマップで、この地点を確かめる<small>（国土地理院・別の画面が開きます）</small></a>
        ${String(cur.info?.code ?? '').startsWith('231') && !cur.info?.guessed ? '<a class="linkbtn" href="https://www.city.nagoya.jp/bousaiportal/hinan/1013390/1013420.html" target="_blank" rel="noopener">名古屋市の津波避難ビルの一覧を見る<small>（名古屋市・別の画面が開きます）</small></a>' : ''}
        <button type="button" class="ghost" id="brief-memo">わが家の避難メモを書く</button>`;
    say();
  }
  // read out once both parts have settled, and again whenever a retry changes the answer
  function say() {
    if (!cur?.official || !cur?.evac) return;
    const o = cur.official, e = cur.evac;
    const t = `公式想定：${o.state === 'hit' ? `最大浸水深${officialPrep(o).toFixed(1)}メートル` : o.state === 'none' ? `このケースでは、この100メートル四方に浸水のセルなし${o.around?.n ? `。ただし近くに最大${o.around.max.toFixed(1)}メートルの想定` : ''}。安全という意味ではありません` : o.state === 'outside' ? '収録範囲の外。浸水しないという意味ではありません' : '取得できませんでした'}。逃げる場所：${e.status === 'failed' ? '取得できませんでした' : e.sites.length ? `${e.sites[0].name}、直線で${distJa(e.sites[0].d)}` : '1キロ以内には見つかりませんでした'}。`;
    if ($('brief-live').textContent !== t) $('brief-live').textContent = t;
  }

  el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-retry]');
    if (r && cur) { load(cur.lat, cur.lon, r.dataset.retry); return; }
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
      jobs.push(officialNear(lat, lon).then(async (o) => {
        await landAround(lat, lon, o);
        if (my === token) { c.official = o; part('off'); }
      }));
    }
    if (!only || only === 'evac') {
      c.evac = null; part('evac');
      jobs.push(loadEvacSites(lat, lon, RADIUS, 5).then((ev) => { if (my === token) { c.evac = ev; drawMarkers(ev); part('evac'); } }));
    }
    await Promise.all(jobs);
    return c;
  }

  return {
    /** a new point: show "確認中…" at once, discard any older answer */
    update(lat, lon) {
      token++;
      clearMarkers();
      cur = { lat, lon, official: null, evac: null, info: null };
      $('brief-live').textContent = '';
      skeleton();
      return load(lat, lon);
    },
    /** municipality + Cabinet-Office coastal heights per case (from tsunamiHeightAt) */
    setInfo(info) { if (cur) { cur.info = info; part('off'); part('links'); } },
    get current() { return cur; },
  };
}
