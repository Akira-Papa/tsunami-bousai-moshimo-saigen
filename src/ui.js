// 小さな UI 部品（GPU を使わない）：文言の定数、エスケープ、モーダルのフォーカス管理
export const $ = (id) => document.getElementById(id);
export function esc(t) { return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// ── 文言（出典と確認日は docs/fable52/05_一次情報の確認.md） ──
// 気象庁「強い揺れや弱くても長い揺れを感じたときは、すぐに避難を開始しましょう」
// 「津波は長い時間くり返し襲ってきます。津波警報・注意報が解除されるまでは、避難を続けましょう」に沿った文
export const QUAKE_LINE = '強い揺れや、弱くても長い揺れを感じたら、すぐ高い所へ避難を。';
export const QUAKE_MORE = '津波はくり返し来ます。警報・注意報が解除されるまで、戻らないでください。';

/**
 * 深さの目安（一次情報どおり）:
 *  内閣府 南海トラフ巨大地震 被害想定の手法：浸水深30cm以上で死者が発生し始め、1mでは津波に巻き込まれた人の
 *    すべてが死亡すると仮定
 *  気象庁：20〜30cm程度の津波でも速い流れに巻き込まれるおそれ／木造家屋は浸水1m程度から部分破壊、2mで全面破壊
 *    （建て方や地形で変わる目安。首藤の津波強度階級を改変）
 */
// どの文も「巻き込まれる前に高い所へ」で終える：深さを知らせるのは、あきらめさせるためではない
export function depthSay(h) {
  if (h < 0.3) return ['0.2〜0.3mの津波でも、人は速い流れに巻き込まれるおそれがあります（気象庁）。浅くても近づかないでください。', 'lv1'];
  if (h < 1) return ['0.3m以上：内閣府の被害想定は、この深さから、津波に巻き込まれた人に亡くなる人が出始めると仮定しています。水が来る前に、高い所へ。', 'lv1'];
  if (h < 2) return ['1m以上：津波に巻き込まれると、命にかかわる深さです（内閣府の被害想定は、巻き込まれた人は1mで全員が亡くなると仮定）。水が来る前に、高い所へ。', 'lv2'];
  if (h < 3) return ['2m以上：気象庁は、木造家屋が全面破壊に至る目安としています。巻き込まれると命にかかわる深さです（内閣府の被害想定は、1mで全員が亡くなると仮定）。水が来る前に、高い所へ。', 'lv3'];
  return ['2階の床の高さ（このサイトの目安で約3m）を超える深さです。気象庁は、2mで木造家屋が全面破壊に至る目安としています。巻き込まれると命にかかわります。水が来る前に、もっと高い所へ。', 'lv3'];
}

/**
 * 深さの短い言い方（画面の1行用）。中身は depthSay と同じ一次情報からとり、言い切りを足さない。
 * くわしい文（depthSay）は「くわしく」の中に残す。
 */
export function depthShort(h) {
  if (h < 0.3) return ['浅くても、流されます', 'lv1'];
  if (h < 1) return ['流されて、命の危険がある深さ', 'lv1'];
  if (h < 2) return ['巻き込まれると、命にかかわる深さ', 'lv2'];
  if (h < 3) return ['木造の家がこわれる深さ', 'lv3'];
  return ['2階まで水が来る深さ', 'lv3'];
}

/**
 * 深さを形で見せる絵：大人（約1.7m）と2階建ての家（2階の床 約3m・このサイトの目安）の横に、水の高さを塗る。
 * 6mより深い時は、絵の上まで水にして「6m以上」と分かるように上に波線を出す。数字は別に大きく出す。
 */
export function depthFig(h, color = '#ffb7b7', around = null) {
  const top = 6.6, H = 96, y = (m) => Math.round((H - (Math.min(m, top) / top) * H + 8) * 10) / 10;
  const wy = y(h), p = y(1.7);
  return `<svg class="depth-fig" viewBox="0 0 120 112" aria-hidden="true">
    <rect x="0" y="${wy}" width="120" height="${Math.round((104 - wy) * 10) / 10}" fill="${color}"/>
    <path d="M0 ${wy}h120" stroke="#b3261e" stroke-width="2.5"${h > top ? ' stroke-dasharray="6 4"' : ''}/>
    <g fill="none" stroke="#1a1f24" stroke-width="2.4" stroke-linejoin="round">
      <path d="M52 104V${y(6)}l27-10 27 10V104z" fill="rgba(255,255,255,.5)"/><path d="M52 ${y(3)}h54"/>
      <path d="M62 ${y(5)}h10v10h-10z M86 ${y(5)}h10v10h-10z M62 ${y(2.2)}h10v10h-10z"/>
    </g>
    ${around != null ? `<path d="M0 ${y(around)}h120" stroke="#b3261e" stroke-width="2.5" stroke-dasharray="7 5"/>` : ''}
    <g fill="#1a1f24"><circle cx="24" cy="${p + 4}" r="4.2"/><path d="M19 ${p + 10}h10v${Math.round((94 - p) * 10) / 10}h-3.6v-9h-2.8v9H19z"/></g>
    <path d="M0 104h120" stroke="#1a1f24" stroke-width="3"/>
  </svg>`;
}

/** 公式の最早到達（秒）→「約N分」。「最も早くて」と言う以上、切り捨てる（四捨五入は遅い側へずれる） */
export function arrivalJa(sec) {
  if (sec == null || !Number.isFinite(sec)) return null;
  const m = Math.floor(sec / 60);
  // an hour or more is said in hours and minutes ("108分" is hard to picture)
  return sec < 60 ? '1分たたないうち' : m >= 60 ? `約${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `約${m}分`;
}
/** 「地震から最も早くて約N分で水が来はじめる想定です。」（1分未満は言い回しを変える） */
export function arrivalSentence(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  return sec < 60 ? '地震から<b>1分たたないうちに</b>水が来はじめる想定です（最も早い場合）。' : `地震から<b>最も早くて約${Math.floor(sec / 60)}分</b>で水が来はじめる想定です。`;
}

/** 国土地理院「重ねるハザードマップ」を、その地点・津波浸水想定レイヤーで開く（2026-11-10 に表示を確認した形式） */
export const hazardMapUrl = (lat, lon) =>
  `https://disaportal.gsi.go.jp/maps/?ll=${lat.toFixed(5)},${lon.toFixed(5)}&z=15&base=pale&ls=seamless%7Ctsunamishinsui_raster%2C0.8&disp=11&vs=c1j0l0u0t0h0z0`;

/**
 * 歩く時間の目安（直線をまっすぐ歩けた場合。切り上げ＝遅い側）。
 * 消防庁「津波避難対策推進マニュアル検討会報告書」・国土交通省「津波防災まちづくりの計画策定に係る指針」:
 *  1.0 m/秒を目安、歩行困難者・身体障がい者・乳幼児・重病人等は 0.5 m/秒。
 *  東日本大震災の実際の避難の平均は 0.62 m/秒で、避難できる距離は「最長でも500m程度を目安」
 * 1.0 m/秒は上限ではないので「下限」とは呼ばない。
 */
export function walkMin(d) {
  return { fast: Math.max(1, Math.ceil(d / 1.0 / 60)), real: Math.max(1, Math.ceil(d / 0.62 / 60)), slow: Math.max(1, Math.ceil(d / 0.5 / 60)) };
}

// ── モーダル：開いたら中へフォーカス、Tab は中で回す、Esc で閉じて、開いたボタンへ戻す ──
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
// dialogs stack (the memo opens on top of the result and returns to it)
const stack = [];
export function openDialog(el, { onClose, focus, opener: op } = {}) {
  if (stack.some((d) => d.el === el)) return;
  // Safari does not focus a button on click, and a result can open by itself at the end of a run:
  // the caller may name the control to return to
  const opener = op ?? document.activeElement;
  el.hidden = false;
  const key = (e) => {
    if (stack.at(-1)?.el !== el) return; // only the top dialog listens
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDialog(el); return; }
    if (e.key !== 'Tab') return;
    const list = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list.at(-1);
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', key, true);
  stack.push({ el, opener, key, onClose });
  const target = focus ?? el.querySelector('[data-autofocus]') ?? el.querySelector('h2');
  if (target) { if (!target.hasAttribute('tabindex') && !target.matches(FOCUSABLE)) target.tabIndex = -1; target.focus({ preventScroll: true }); }
}
/** close one dialog (and anything opened on top of it); with no argument, close them all */
export function closeDialog(el = null) {
  const from = el ? stack.findIndex((d) => d.el === el) : 0;
  if (from < 0) return;
  for (const c of stack.splice(from).reverse()) {
    document.removeEventListener('keydown', c.key, true);
    c.el.hidden = true;
    c.onClose?.();
    if (c.opener && document.contains(c.opener) && c.opener.offsetParent !== null) c.opener.focus({ preventScroll: true });
  }
}
export const isDialogOpen = (el) => stack.some((d) => d.el === el);
export const anyDialogOpen = () => stack.length > 0;
