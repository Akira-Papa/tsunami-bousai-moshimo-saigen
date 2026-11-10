// 「この地点の公式想定」— GPU を使わない。WebGPU がない端末でも、地点を選ぶだけでここまでは必ず出す。
//   ・内閣府（2025）ケース01 の100m集約：最大浸水深・最早到達（状態は4つ：あり／このケースではなし／収録外／取得失敗）
//   ・国土地理院 指定緊急避難場所（津波）：1km以内・近い順
//   ・地図：公式の浸水セル（浸水セルだけ）と、逃げる場所の記号
// 再現（3D）の数字はここには出さない。
import * as maplibregl from 'maplibre-gl';
import { officialNear, officialInBox, caseNote } from './data/official.js';
import { loadEvacSites, distJa, EVAC_SOURCE, EVAC_SOURCE_URL } from './data/evac.js';
import { $, esc, depthSay, hazardMapUrl, walkMin } from './ui.js';

const NEAR = 300;      // これより遠い場所は見出しを分ける（歩く人によっては間に合わない）
const RADIUS = 1000;   // 探す範囲
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
export const OFFICIAL_NAME = '内閣府（2025）南海トラフ巨大地震の津波浸水想定のうち、11ケースの1つ「ケース01」';

/** 公式想定の一文（状態ごと）。どの状態でも「安全」とは読めないようにする */
/** 海岸の津波高をケース別に見て、ケース01がこの地域の最大のケースかどうかを一文で */
export function caseHtml(info) {
  const n = caseNote(info?.row);
  if (!n) return '';
  const who = info.borrowed ? `近くの「${esc(info.borrowed)}」` : `「${esc(info.name)}」`;
  const base = `${who}の海岸の最大津波高は、ケース01では${n.c1}m、11ケースの最大は${n.max}m（ケース${n.tops.map((k) => String(k).padStart(2, '0')).join('・')}）。`;
  return n.lower
    ? `<p class="brief-case warnish"><b>ケース01は、この地域で津波が最も高くなるケースではありません。</b>${base}浸水は、ここに出ている値より<b class="notsafe">深く・広くなることがあります</b>。自治体のハザードマップ（最大クラスの想定）で確かめてください。</p>`
    : `<p class="brief-case">${base}</p>`;
}

export function officialHtml(o, info = null) {
  if (!o) return '<p class="brief-wait">公式想定を確認中…</p>';
  const c = o.cell;
  const a = o.around;
  const aroundHit = a?.n && a.max > (c?.depth ?? 0) + 0.05 ? `周り${a.R}m以内では、最大${a.max.toFixed(1)}mの想定です。` : '';
  const aroundNone = a?.n ? `<b>ただし、約${Math.max(10, Math.round(a.nearest / 10) * 10)}m先から浸水の想定があります（周り${a.R}m以内の最大 ${a.max.toFixed(1)}m）。</b>` : '';
  const cs = caseHtml(info);
  if (o.state === 'hit') {
    const [say] = depthSay(c.depth);
    const arr = c.arrival != null ? `地震から<b>最も早くて約${Math.round(c.arrival / 60)}分</b>で水が来はじめる想定です。` : '';
    return `<div class="brief-main"><span class="k">この付近（100m四方）の最大浸水深</span><b class="brief-num">${c.depth.toFixed(1)}<i>m</i></b></div>
      <p class="brief-say">${esc(say)}</p>
      <p class="brief-arr">${aroundHit}${arr}<span class="notsafe">猶予の時間ではありません。</span>ほかのケースや、堤防の破損、川をさかのぼる水では、もっと早く・深くなることがあります。</p>${cs}`;
  }
  if (o.state === 'none') return `<p class="brief-none">このケース（ケース01）では、この100m四方に浸水のセルはありません。${aroundNone}<b class="notsafe">安全という意味ではありません。</b>ほかのケースや、堤防の破損、川をさかのぼる水では、浸水することがあります。自治体のハザードマップで確かめてください。</p>${cs}`;
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
  if (!ev.sites.length) return `<p class="brief-none">1km以内には、このデータ（国土地理院）に津波の指定緊急避難場所は見つかりませんでした。<b class="notsafe">「逃げる場所がない」「ここは来ない」という意味ではありません。</b>自治体のハザードマップで、高い場所と逃げる場所を確かめてください。</p>`;
  const item = (s, n) => {
    const w = walkMin(s.d);
    return `<li><button type="button" class="evac-item" data-evac="${n}">
      ${letters ? `<span class="evac-letter" aria-hidden="true">${LETTERS[n] ?? ''}</span>` : ''}
      <span class="evac-body"><b>${esc(s.name)}</b>
      <span class="evac-meta">直線で${distJa(s.d)}・${s.bearing}の方向／歩いて少なくとも約${w.fast}分（ゆっくり歩く人は約${w.slow}分以上）</span>
      ${s.address ? `<span class="evac-addr">${esc(s.address)}</span>` : ''}${s.remarks ? `<span class="evac-rem">備考：${esc(s.remarks)}</span>` : ''}${notes?.get(s.name) ?? ''}</span></button></li>`;
  };
  const near = [], farther = [];
  ev.sites.forEach((s, n) => (s.d <= NEAR ? near : farther).push([s, n]));
  const shown = (arr) => arr.filter(([, n]) => n < first).map(([s, n]) => item(s, n)).join('');
  const rest = ev.sites.map((s, n) => [s, n]).filter(([, n]) => n >= first);
  let h = '';
  if (near.some(([, n]) => n < first)) h += `<p class="evac-group">${NEAR}m以内</p><ul class="evac-list">${shown(near)}</ul>`;
  if (farther.some(([, n]) => n < first)) h += `<p class="evac-group far">${NEAR}mより遠い<small>歩く人によっては、間に合わないことがあります</small></p><ul class="evac-list">${shown(farther)}</ul>`;
  if (rest.length) h += `<details class="evac-more"><summary>ほか${rest.length}件を見る</summary><ul class="evac-list">${rest.map(([s, n]) => item(s, n)).join('')}</ul></details>`;
  if (ev.total > ev.sites.length) h += `<p class="src">1km以内にはほかに${ev.total - ev.sites.length}件あります（近い順に${ev.sites.length}件を表示）。</p>`;
  h += `<p class="evac-note"><b>直線の距離です。</b>川・運河・線路をまたぐと、道のりは大きく変わります。海や川に近づく向きでないかも、地図で確かめてください。歩く時間は、まっすぐ歩けたとしての下限です（夜・雨・混雑ではもっとかかります）。<b>入口・開いている時間・何階まで上がるかは、市町村の情報で確かめてください。</b>泊まるための「避難所」とは別のものです。</p>`;
  return h;
}

export const EVAC_CREDIT = `逃げる場所：<a href="${EVAC_SOURCE_URL}" target="_blank" rel="noopener">${EVAC_SOURCE}</a>（市町村長の指定をもとに国土地理院が整理。最新の状況は市町村に確認）。歩く速さの目安：1.0m/秒、歩行困難な人・乳幼児などは0.5m/秒（消防庁「津波避難対策推進マニュアル検討会報告書」、国土交通省「津波防災まちづくりの計画策定に係る指針」）。`;

const DEPTH_COLOR = ['step', ['get', 'd'], '#ffffb3', 0.3, '#f7f5a9', 1, '#ffd8c0', 2, '#ffb7b7', 5, '#ff9191', 10, '#f285c9', 20, '#dc7adc'];
const MIN_ZOOM = 11.5;

export function createBrief({ map }) {
  const el = $('brief');
  let token = 0;
  let cur = null; // { lat, lon, official, evac }
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

  function render() {
    if (!cur) { el.hidden = true; return; }
    el.hidden = false;
    const { lat, lon } = cur;
    el.innerHTML = `
      <h2 class="brief-h">この地点の公式想定<small>${OFFICIAL_NAME}（100m四方に集約）</small></h2>
      <div class="brief-off">${officialHtml(cur.official, cur.info)}</div>
      <h3 class="brief-h3">津波から逃げる場所<small>指定緊急避難場所（津波）・1km以内の近い順</small></h3>
      <div class="brief-evac">${evacHtml(cur.evac)}</div>
      <p class="brief-links">
        <a class="linkbtn" href="${hazardMapUrl(lat, lon)}" target="_blank" rel="noopener">重ねるハザードマップで、この地点を確かめる<small>（国土地理院・別の画面が開きます）</small></a>
        ${String(cur.info?.code ?? '').startsWith('231') ? '<a class="linkbtn" href="https://www.city.nagoya.jp/bousaiportal/hinan/1013390/1013420.html" target="_blank" rel="noopener">名古屋市の津波避難ビルの一覧を見る<small>（名古屋市・別の画面が開きます）</small></a>' : ''}
        <button type="button" class="ghost" id="brief-memo">わが家の避難メモを書く</button>
      </p>
      <p class="src">${EVAC_CREDIT}</p>`;
    // one announcement when both parts have settled (not on every partial update)
    if (cur.official && cur.evac && !cur.said) {
      cur.said = true;
      const o = cur.official, e = cur.evac;
      $('brief-live').textContent = `公式想定：${o.state === 'hit' ? `最大浸水深${o.cell.depth.toFixed(1)}メートル` : o.state === 'none' ? 'このケースでは浸水のセルなし。安全という意味ではありません' : o.state === 'outside' ? '収録範囲の外' : '取得できませんでした'}。逃げる場所：${e.status === 'failed' ? '取得できませんでした' : e.sites.length ? `${e.sites[0].name}、直線で${distJa(e.sites[0].d)}` : '1キロ以内には見つかりませんでした'}。`;
    }
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
    const my = token;
    const jobs = [];
    if (!only || only === 'official') {
      cur.official = null;
      jobs.push(officialNear(lat, lon).then((o) => { if (my === token) { cur.official = o; render(); } }));
    }
    if (!only || only === 'evac') {
      cur.evac = null;
      jobs.push(loadEvacSites(lat, lon, RADIUS, 5).then((ev) => { if (my === token) { cur.evac = ev; drawMarkers(ev); render(); } }));
    }
    render();
    await Promise.all(jobs);
    return cur;
  }

  return {
    /** a new point: show "確認中…" at once, discard any older answer */
    update(lat, lon) {
      token++;
      clearMarkers();
      cur = { lat, lon, official: null, evac: null, info: null, said: false };
      $('brief-live').textContent = '';
      const p = load(lat, lon);
      cur.promise = p;
      return p;
    },
    /** municipality + Cabinet-Office coastal heights per case (from tsunamiHeightAt) */
    setInfo(info) { if (cur) { cur.info = info; render(); } },
    get current() { return cur; },
  };
}
