// 「この地点の公式想定」— GPU を使わない。WebGPU がない端末でも、地点を選ぶだけでここまでは必ず出す。
//   ・内閣府（2025）ケース01 の100m集約：最大浸水深・最早到達（状態は4つ：あり／このケースではなし／収録外／取得失敗）
//   ・国土地理院 指定緊急避難場所（津波）：1km以内・近い順
//   ・地図：公式の浸水セル（浸水セルだけ）と、逃げる場所の記号
// 再現（3D）の数字はここには出さない。
import * as maplibregl from 'maplibre-gl';
import { officialNear, officialInBox, officialAround, caseNote, cellHasLand } from './data/official.js';
import { loadEvacSites, distJa, EVAC_SOURCE, EVAC_SOURCE_URL } from './data/evac.js';
import { loadDemMosaic, URLS } from './data/tiles.js';
import { $, esc, depthSay, depthShort, depthFig, arrivalJa, hazardMapUrl, walkMin, arrivalSentence } from './ui.js';
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

const DEPTH_STEPS = [[0.3, '#ffffb3'], [1, '#f7f5a9'], [2, '#ffd8c0'], [5, '#ffb7b7'], [10, '#ff9191'], [20, '#f285c9'], [Infinity, '#dc7adc']];
const depthColor = (d) => DEPTH_STEPS.find(([m]) => d < m)[1];

/**
 * カードのいちばん上：「ここに来る水の深さ」を、大きな数字と絵（大人・家と水の高さ）と短い言葉で。
 * 決まり：状態に結びつく注意（待ってよい時間ではない／安全という意味ではない／ケース01が最大でない／周りを読めなかった）は、
 * ここに短く出して畳まない。一般の説明と出典は、下の「くわしい説明・出典」に回る（同じデータから作る）。
 */
export function topHtml(cur) {
  const o = cur.official;
  const head = '<p class="bt-k">ここに来る水の深さ<small>国の想定（内閣府2025・ケース01）</small></p>';
  if (!o) return `<div class="bt-depth">${head}<p class="bt-wait">確認中…</p></div>`;
  const n = cur.info ? caseNote(cur.info.row) : null;
  const caseWarn = n?.lower ? `<p class="bt-state warnish"><b>ほかの想定では、もっと深くなります。</b>この地域で津波がいちばん高いのは、別のケースです（海岸で最大${n.max}m）。</p>` : '';
  if (o.state === 'hit') {
    const c = o.cell, a = o.around, deeper = a?.n && a.max > c.depth + 0.05;
    // the number, the picture and the words all speak of the SAME value (this 100 m square); the deeper value
    // nearby is a dashed line in the picture and a sentence of its own (review U1-1)
    const [word, lv] = depthShort(c.depth);
    const arr = arrivalJa(c.arrival);
    return `<div class="bt-depth ${lv}">${head}
      <div class="bt-fig">${depthFig(c.depth, depthColor(c.depth), deeper ? a.max : null)}
        <div class="bt-nums"><b class="bt-num">${c.depth.toFixed(1)}<i>m</i></b>
        <span class="bt-word">${esc(word)}</span></div>
      </div>
      ${deeper ? `<p class="bt-around"><span class="dash" aria-hidden="true"></span><span>まわり${a.R}mでは、最大 <b>${a.max.toFixed(1)}m</b>（${esc(depthShort(a.max)[0])}）。<b class="prep">${a.max.toFixed(1)}m のつもりで、そなえてください。</b></span></p>` : ''}
      <p class="bt-act"><b>水が来る前に、高い所へ。</b></p>
      ${o.partial ? '<p class="bt-cav">まわりの一部を読みこめませんでした。もっと深いかもしれません。</p>' : ''}
    </div>`
      + (arr ? `<p class="bt-state time"><span class="bt-ico" aria-hidden="true"></span><span>水が来はじめるのは、地震から<b>${c.arrival < 60 ? arr : `早くて ${arr}`}</b>。<b class="notsafe">待ってよい時間ではありません。</b></span></p>` : '')
      + caseWarn;
  }
  if (o.state === 'none') {
    const a = o.around;
    // (a shallow or distant neighbour is not a figure to prepare for — the same rule as the full section below)
    const weak = a?.n && (a.max < 0.3 || (a.max < 1 && a.edge >= 100));
    return `<div class="bt-depth none">${head}
      <p class="bt-none">この想定では、ここに浸水はありません。<b class="notsafe">安全という意味ではありません。</b></p>
      <p class="bt-word">${!a?.n ? 'ほかの想定や、堤防がこわれた時は、水が来ることがあります。'
        : weak ? `${edgeJa(a.edge)}、最大 ${a.max.toFixed(1)}m の浸水の想定があります（備えの上限ではありません）。`
          : `<b>${edgeJa(a.edge)}、浸水の想定があります（まわり${a.R}mで最大 ${a.max.toFixed(1)}m）。備えは、この深さで。</b>`}</p>
      ${o.partial ? '<p class="bt-cav">まわりの一部を読みこめませんでした。ここに出ていない浸水の想定があるかもしれません。</p>' : ''}
    </div>` + caseWarn;
  }
  if (o.state === 'outside') return `<div class="bt-depth none">${head}<p class="bt-none">ここは、このサイトのデータの範囲の外です。<b class="notsafe">「浸水しない」という意味ではありません。</b></p><p class="bt-word">自治体のハザードマップで確かめてください。</p></div>`;
  return `<div class="bt-depth none">${head}<p class="bt-none">読みこめませんでした（通信）。<b class="notsafe">「浸水しない」という意味ではありません。</b></p></div>`;
}

/**
 * 津波から逃げる場所（指定緊急避難場所）の一覧。
 * @param ev      loadEvacSites() の結果（null = 確認中）
 * @param first   最初に見せる件数（残りは畳む）
 * @param notes   site.name → 注記HTML（再現の水位と比べられた建物だけ。肯定の表示は出さない）
 */
export function evacHtml(ev, { first = 3, notes = null, letters = true, compact = false, walk = true } = {}) {
  if (!ev) return '<p class="brief-wait">逃げる場所を確認中…</p>';
  if (ev.status === 'failed') return `<p class="brief-fail">逃げる場所のデータを取得できませんでした（通信の状態を確かめてください）。<b class="notsafe">「近くにない」という意味ではありません。</b> <button type="button" class="ghost small" data-retry="evac">もう一度</button></p>`;
  if (!ev.sites.length) return `<p class="brief-none">1km以内には、このデータ（国土地理院）に津波の指定緊急避難場所は見つかりませんでした。<b class="notsafe">「逃げる場所がない」「津波が来ない」という意味ではありません。</b>データに載っていない市町村もあります。自治体のハザードマップで、高い場所と逃げる場所を確かめてください。</p>`;
  const item = (s, n) => {
    const w = walkMin(s.d);
    return `<li><button type="button" class="evac-item" data-evac="${n}">
      ${letters ? `<span class="evac-letter" aria-hidden="true">${LETTERS[n] ?? ''}</span>` : ''}
      <span class="evac-body"><b>${esc(s.name)}</b>
      ${walk ? `<span class="evac-walk">歩いて <b>約${w.fast}〜${w.slow}分</b>${s.d > 500 ? '<b class="lowmark">遠いです（500mより先）</b>' : ''}</span>` : ''}
      <span class="evac-meta">直線で${distJa(s.d)}・${s.bearing}の方向</span>
      ${s.address ? `<span class="evac-addr">${esc(s.address)}</span>` : ''}${s.remarks ? `<span class="evac-rem">備考：${esc(s.remarks)}</span>` : ''}${notes?.get(s.name) ?? ''}</span></button></li>`;
  };
  const near = [], farther = [];
  ev.sites.forEach((s, n) => (s.d <= NEAR ? near : farther).push([s, n]));
  const shown = (arr) => arr.filter(([, n]) => n < first).map(([s, n]) => item(s, n)).join('');
  const rest = ev.sites.map((s, n) => [s, n]).filter(([, n]) => n >= first);
  // the first place must be visible without scrolling — the long note follows the list, folded
  let h = '<p class="evac-intro">命を守るために逃げこむ場所です（泊まる「避難所」とは別）。<b>入口・開いている時間・上がれる階は、市町村で確かめてください。</b></p>';
  if (near.some(([, n]) => n < first)) h += `<p class="evac-group">${NEAR}m以内</p><ul class="evac-list">${shown(near)}</ul>`;
  if (farther.some(([, n]) => n < first)) h += `<p class="evac-group far">${NEAR}mより遠い<small>早めに動いてください。歩くのが難しい人は、手を貸す人を決めておいてください</small></p><ul class="evac-list">${shown(farther)}</ul>`;
  if (rest.length) h += `<details class="evac-more"><summary>ほか${rest.length}件を見る</summary><ul class="evac-list">${rest.map(([s, n]) => item(s, n)).join('')}</ul></details>`;
  if (ev.total > ev.sites.length) h += `<p class="src">1km以内にはほかに${ev.total - ev.sites.length}件あります（近い順に${ev.sites.length}件を表示）。</p>`;
  h += `<details class="more sub"><summary>距離と歩く時間について</summary><p class="evac-note"><b>距離は直線です。</b>消防庁は、歩いて避難できる距離の目安を「最長でも500m程度」としています。川・運河・線路をまたぐと、道のりは大きく変わります。${letters ? '記号（A・B…）は近い順で、おすすめの順ではありません。' : ''}${walk ? '歩く目安は、まっすぐ歩けた場合の時間です（1.0m/秒。東日本大震災での実際の避難の平均は0.62m/秒。歩くのが難しい人・乳幼児連れは0.5m/秒）。夜・雨・混雑ではさらにかかります。' : '歩く目安は、下の「逃げる道のり」に、道のりから出しています（1.0m/秒。実際の避難の平均は0.62m/秒。歩くのが難しい人・乳幼児連れは0.5m/秒）。'}${NEAR}mの区切りは、このサイトの目安です。海や川に近づく道にならないかも、地図で確かめてください。</p></details>`;
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

const walkJa = (d) => { const w = walkMin(d); return `歩いて <b>約${w.fast}〜${w.slow}分</b>`; };
// 屋外の場所（建物の上の階がない）かどうかを、名前から見分ける。分からなければ両方の言い方を出す
const OUTDOOR = /公園|広場|駐車場|グラウンド|運動場|緑地|校庭|高台|山|丘|神社|墓地/;
const BUILDING = /学校|ビル|センター|庁舎|会館|マンション|住宅|病院|ホテル|タワー|館|園舎|保育|幼稚|工場|社屋|本社|支店|寮|アパート/;
const over500 = (d) => (d > 500 ? '<b class="lowmark">遠いです（500mより先）</b>' : '');

/**
 * 逃げる道のり（目安）の一覧。
 * @param rt   { status, sites:[{road,path,elev}], highs:[{level,label,res}], here } | null（確認中）
 * @param ev   逃げる場所（rt.sites と同じ並び）
 * @param H    波の条件（海の高さ m）
 * @param sel  選ばれている行き先（'s0'…/'h0'/'h1'）
 */
export function routeHtml(rt, ev, H, sel = null, canChange = false, off = null) {
  if (!rt) return '<p class="brief-wait">逃げる場所と道のりを確認中…</p>';
  if (rt.status === 'failed') return `<p class="brief-fail">道のりを取得できませんでした（通信の状態を確かめてください）。${ev?.status === 'ok' ? '直線距離の一覧は、上に出ています。' : '通信が戻るまでは、自治体のハザードマップや、地域の避難場所の看板を確かめてください。津波のおそれがあるときは、まず高い所へ。'} <button type="button" class="ghost small" data-retry="route">もう一度</button></p>`;
  if (rt.status !== 'ok') return '<p class="brief-none">近くに道のデータがありません（地図データにない道かもしれません）。上の、直線距離の一覧を使ってください。</p>';
  const pressed = (id) => `aria-pressed="${sel === id}"`;
  // one line that must stay in sight; the conditions and the long notes are folded at the end of the list
  let h = '<p class="route-note lead"><b>通れるとは限りません。</b>上の時間とくらべて「間に合う」とは言えません。<b>揺れたら、すぐ逃げてください。</b></p>';
  const notes = `<p class="route-wave">波の条件：<b>海の高さ ${H.toFixed(1)}m</b><small>（海岸での津波の高さ。初期値は内閣府の最大津波高${canChange ? '。上の「津波の高さ」を変えると、高い所の行き先も変わります' : ''}）</small></p>
    <p class="route-note">道のりは、地図データから求めた目安です。<b>通れるとは限りません</b>（橋の損傷・建物の倒壊・液状化・夜や雨など）。津波が来る前に逃げる想定で、浸水する道も避けていません。<b>実際に歩いて確かめてください。</b></p>
    <p class="route-note">${off?.state === 'hit' && off.cell?.arrival != null ? `津波は、地震から最も早くて${off.cell.arrival < 60 ? '1分たたないうち' : `約${Math.floor(off.cell.arrival / 60)}分`}で来はじめる想定です（この地点の公式想定・ケース01）。` : '津波は、地震のあと数分で来ることがあります。'}歩く目安は歩き出してからの時間で、これと比べて<b>「間に合う」とは言えません</b>。遠い所を目指すより、近くの丈夫な建物の上の階へ上がるほうが早い場合があります。</p>
    <p class="route-note">歩く時間は「速く歩ける人〜歩くのが難しい人」の幅です（1.0m/秒〜0.5m/秒。東日本大震災での実際の避難の平均は0.62m/秒）。夜・雨・混雑では、さらにかかります。</p>`;
  // designated sites: the three nearest by road
  const sites = ev?.status === 'ok' ? ev.sites : [];
  const idx = sites.map((_, i) => i).filter((i) => rt.sites[i]?.road != null).sort((a, b) => rt.sites[a].road - rt.sites[b].road);
  const lost = sites.map((_, i) => i).filter((i) => rt.sites[i]?.road == null);
  h += '<ul class="route-list">';
  for (const i of idx.slice(0, 3)) {
    const s = sites[i], r = rt.sites[i];
    h += `<li><button type="button" class="route-item site" data-route="s${i}" ${pressed('s' + i)}>
      <span class="route-letter site" aria-hidden="true">${LETTERS[i] ?? ''}</span><span class="evac-body"><span class="route-kind site">逃げる場所（指定）</span><b>${esc(s.name)}</b>
      <span class="evac-walk">${walkJa(r.road)}${over500(r.road)}</span>
      <span class="evac-meta">道のり ${distJa(r.road)}（直線では${distJa(s.d)}）</span>
      ${r.elev == null ? ''
        : Math.abs(r.elev - H) <= 1 ? `<span class="evac-low">地面は、海の高さと同じくらい（標高 約${r.elev.toFixed(1)}m）。上の階・もっと高い所へ</span>`
        : r.elev < H ? `<span class="evac-low">地面が低い場所（標高 約${r.elev.toFixed(1)}m）。${OUTDOOR.test(s.name) && !BUILDING.test(s.name) ? 'とどまらず、もっと高い所へ' : BUILDING.test(s.name) && !OUTDOOR.test(s.name) ? 'できるだけ上の階へ' : '建物なら上の階へ。広場なら、もっと高い所へ'}</span>`
          : ''}</span></button></li>`;
  }
  // high ground: the wave height, and twice the wave height
  let anyHigh = false;
  rt.highs.forEach((hg, n) => {
    const r = hg.res;
    if (r.found && r.dist < 60) {
      anyHigh = true;
      h += `<li class="route-miss"><span class="route-tag high">高い所</span>${hg.label}：この地点のまわりは、標高 約${r.elev.toFixed(1)}m で、この高さ以上です。ただし、津波が来ない場所という意味ではありません。できるだけ、さらに高い所へ。</li>`;
    } else if (r.found) {
      anyHigh = true;
      h += `<li><button type="button" class="route-item high" data-route="h${n}" ${pressed('h' + n)}>
        <span class="route-letter high" aria-hidden="true">高</span><span class="evac-body"><span class="route-kind high">高い所</span><b>${hg.label}</b>
        <span class="evac-walk">${walkJa(r.dist)}${over500(r.dist)}</span>
        <span class="evac-meta">道のり ${distJa(r.dist)}・標高 約${r.elev.toFixed(1)}m</span></span></button></li>`;
    } else if (r.reason === 'nodem' || rt.highs.some((x) => x.res.found)) {
      h += `<li class="route-miss"><span class="route-tag high">高い所</span>${hg.label}：${r.reason === 'nodem' ? '標高を取得できませんでした（通信）。' : `近く（ここから約${(ROUTE_RANGE_M / 1000).toFixed(1)}km）の道には、見つかりませんでした。`}</li>`;
    }
  });
  h += '</ul>';
  if (!idx.length && !lost.length && ev?.status === 'ok') h += '<p class="evac-note">この範囲では、指定された逃げる場所への道のりを求められませんでした（上の一覧のとおり、1km以内のデータに見つかっていません）。自治体のハザードマップで確かめてください。</p>';
  if (lost.length) h += `<p class="evac-note">道がつながらなかった場所：${lost.map((i) => `${LETTERS[i] ?? ''}（${esc(sites[i].name)}）`).join('、')}。地図にない道があるかもしれません。直線距離は上の一覧に出ています。</p>`;
  if (!anyHigh && rt.highs.every((x) => x.res.reason !== 'nodem')) h += `<p class="route-miss none"><span class="route-tag none">高い所</span><span><b>近く（ここから約${(ROUTE_RANGE_M / 1000).toFixed(1)}km）の道には、海の高さ（${H.toFixed(1)}m）より高い所が見つかりませんでした。</b>「高い所がない」という意味ではありません。逃げる場所の建物の、できるだけ上の階へ。<small>何階まで上がれるかは市町村の情報で、遠くの高台は自治体のハザードマップで確かめてください。</small></span></p>`;
  h += `<details class="more sub"><summary>道のりの注意と、くわしい説明</summary>${notes}<p class="route-note"><b>標高が海の高さより高くても、2倍の高さでも、津波が来ないという意味ではありません。</b>気象庁によると、津波が陸をかけ上がる高さは、海岸での津波の高さの2〜4倍に達することが多く、V字谷のような地形ではさらに高くなることがあります。できるだけ高い所へ。標高は国土地理院の標高データ（10mメッシュと、あれば5mメッシュの低いほう）の目安で、数mずれることがあります。「高い所」は、標高（まわり50mを含む）と海の高さを比べて選んだもので、市町村が決めた避難の目標地点ではありません。指定された逃げる場所の、何階まで上がれるか・入口・開いている時間は、市町村の情報で確かめてください。並びは道のりの近い順で、おすすめの順ではありません。</p>
    <p class="src">道のり：<a href="${ROAD_SOURCE_URL}" target="_blank" rel="noopener">${ROAD_SOURCE}</a>と、地理院タイル（標高タイル）を加工して作成。道のデータは提供実験のもので、地図にない細い道・階段・歩道橋は入っていないことがあります。高速道路は通りません。</p></details>`;
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
        'circle-color': DEPTH_COLOR, 'circle-opacity': 0.8,
        'circle-stroke-color': 'rgba(110,50,40,.8)', 'circle-stroke-width': 0.9,
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
    for (const i of idx) out.push({ id: 's' + i, kind: 'site', path: rt.sites[i].path, road: rt.sites[i].road });
    rt.highs.forEach((hg, n) => { if (hg.res.found && hg.res.dist >= 60) out.push({ id: 'h' + n, kind: 'high', path: hg.res.path, lat: hg.res.lat, lon: hg.res.lon, elev: hg.res.elev, road: hg.res.dist, level: hg.level }); });
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
  let highSeq = 0;
  async function computeHighs() {
    const rt = cur?.route;
    if (rt?.status !== 'ok') return false;
    const my = ++highSeq, H = getH();
    const [a, b] = await Promise.all([highGround(rt, H), highGround(rt, 2 * H)]);
    if (my !== highSeq || cur?.route !== rt) return false;   // the wave height moved on, or another point was chosen
    rt.H = H;
    rt.highs = [
      { level: H, label: `海の高さ（${H.toFixed(1)}m）より高い所`, res: a },
      { level: 2 * H, label: `海の高さの2倍（${(2 * H).toFixed(1)}m）より高い所`, res: b },
    ];
    if (routeSel && !routeFeatures().some((f) => f.id === routeSel)) routeSel = null;
    return true;
  }
  async function loadRoute(lat, lon, c, my) {
    c.route = null; part('route');
    let rt;
    try { rt = await planRoutes(lat, lon, c.evac?.status === 'ok' ? c.evac.sites : []); } catch (e) { console.warn('route', e); rt = { status: 'failed' }; }
    if (my !== token) return;
    if (rt.status === 'ok') { rt.highs = []; rt.H = getH(); c.route = rt; if (!(await computeHighs())) return; } else c.route = rt;
    drawRoutes(); part('route');
    if (rt.status === 'ok') part('evac'); // the walking estimate now comes from the road distance, once
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
      <div class="brief-top" id="brief-top"></div>
      <h3 class="brief-h3 first" id="brief-h" tabindex="-1">逃げる場所と、道のり<small>近い順。下の A・B・C をおすと、地図に道が出ます</small></h3>
      <div class="brief-route" id="brief-route"></div>
      <details class="more" id="evac-details"><summary>逃げる場所の一覧<small>住所・方向</small></summary>
        <div class="brief-evac" id="brief-evac"></div>
      </details>
      <p class="brief-links" id="brief-links"></p>
      <details class="more" id="off-details"><summary>くわしい説明・出典<small>国の想定について</small></summary>
        <h2 class="brief-h">この場所の、国の想定（公式想定）<small>${OFFICIAL_NAME}</small></h2>
        <div class="brief-off" id="brief-off"></div>
        <p class="src">${EVAC_CREDIT}</p>
      </details>`;
    part('off'); part('evac'); part('route'); part('links');
  }
  function part(which) {
    if (!cur || !$('brief-off')) return;
    $('brief-top').innerHTML = topHtml(cur); // the first screen on a phone (every part feeds it)
    if (which === 'off') $('brief-off').innerHTML = officialHtml(cur.official, cur.info);
    if (which === 'evac') {
      // rebuilt when the road distances arrive: keep the reader's place (an opened "ほか○件", the focused item)
      const box = $('brief-evac'), f = document.activeElement;
      const open = !!box.querySelector('details[open]'), key = box.contains(f) ? f.getAttribute('data-evac') : null;
      box.innerHTML = evacHtml(cur.evac, { walk: cur.route?.status !== 'ok' });
      if (open) box.querySelector('details')?.setAttribute('open', '');
      if (key != null) box.querySelector(`[data-evac="${key}"]`)?.focus({ preventScroll: true });
      // no places found / not loaded: that message must not stay folded away
      if (cur.evac && (cur.evac.status === 'failed' || !cur.evac.sites.length)) $('evac-details').open = true;
    }
    if (which === 'route') {
      // rebuilt when the wave height changes or a line is chosen: keep the reader's place
      const f = document.activeElement, key = $('brief-route').contains(f) ? f.getAttribute('data-route') : null;
      $('brief-route').innerHTML = routeHtml(cur.route, cur.evac, cur.route?.H ?? getH(), routeSel, !$('sim-setup')?.hidden, cur.official);
      if (key) $('brief-route').querySelector(`[data-route="${key}"]`)?.focus({ preventScroll: true });
      // no ways (no road data / no connection): the straight-line list takes their place, opened
      if (cur.route && cur.route.status !== 'ok') $('evac-details').open = true;
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
        <a class="linkbtn" href="${hazardMapUrl(cur.lat, cur.lon)}" target="_blank" rel="noopener">ハザードマップで確かめる<small>国土地理院・別の画面が開きます</small></a>
        ${String(cur.info?.code ?? '').startsWith('231') && !cur.info?.guessed ? '<a class="linkbtn" href="https://www.city.nagoya.jp/bousaiportal/hinan/1013390/1013420.html" target="_blank" rel="noopener">名古屋市の津波避難ビルの一覧<small>名古屋市・別の画面が開きます</small></a>' : ''}
        <button type="button" class="ghost" id="brief-memo">わが家の避難メモ</button>`;
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
        // the visible map is what the card leaves free (on a phone: the strip above it, below the note)
        const note = $('map-note')?.getBoundingClientRect();
        const pad = innerWidth > 760 ? { left: Math.min(460, innerWidth * 0.4) + 40, top: 90, right: 60, bottom: 70 }
          : { left: 28, right: 28, top: Math.round((note?.bottom ?? 60) + 14), bottom: Math.round(innerHeight * 0.62 + 16) };
        const box = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
        const cam = map.cameraForBounds(box, { padding: pad, maxZoom: 17 });
        if (cam) map.easeTo({ ...cam, duration: 700 }); else map.fitBounds(box, { padding: 20, maxZoom: 17, duration: 700 });
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
    setWave() { if (cur?.route?.status === 'ok') computeHighs().then((ok) => { if (ok) { drawRoutes(); part('route'); } }); },
    get current() { return cur; },
    /** the ways shown on the map (for the 3-D view): the lines and the one the card has picked, if any */
    get routes() { return { feats: routeFeatures(), sel: routeSel, H: cur?.route?.H ?? null }; },
  };
}
