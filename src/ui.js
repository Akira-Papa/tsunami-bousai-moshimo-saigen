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
export function depthSay(h) {
  if (h < 0.3) return ['浅くても流れは速く、巻き込まれるおそれがあります（気象庁：20〜30cmでも）', 'lv1'];
  if (h < 1) return ['0.3m以上：津波に巻き込まれた人から死者が出始めると仮定される深さです（内閣府の被害想定）', 'lv1'];
  if (h < 2) return ['1m以上：津波に巻き込まれた人は助からないと仮定される深さです（内閣府の被害想定）', 'lv2'];
  if (h < 3) return ['2m以上：木造家屋が全面破壊に至る目安の深さです（気象庁）', 'lv3'];
  return ['2階の床（約3m）を超える深さです。2m以上は木造家屋が全面破壊に至る目安（気象庁）', 'lv3'];
}

/** 国土地理院「重ねるハザードマップ」を、その地点・津波浸水想定レイヤーで開く（2026-11-10 に表示を確認した形式） */
export const hazardMapUrl = (lat, lon) =>
  `https://disaportal.gsi.go.jp/maps/?ll=${lat.toFixed(5)},${lon.toFixed(5)}&z=15&base=pale&ls=seamless%7Ctsunamishinsui_raster%2C0.8&disp=11&vs=c1j0l0u0t0h0z0`;

/**
 * 歩く時間の「下限」：直線でまっすぐ歩けたとしても、これより早くは着かない。
 * 速さの目安は消防庁「津波避難対策推進マニュアル検討会報告書」・国土交通省「津波防災まちづくりの計画策定に係る指針」:
 *  1.0 m/秒（目安）、歩行困難者・乳幼児等は 0.5 m/秒
 */
export function walkMin(d) {
  return { fast: Math.max(1, Math.ceil(d / 1.0 / 60)), slow: Math.max(1, Math.ceil(d / 0.5 / 60)) };
}

// ── モーダル：開いたら中へフォーカス、Tab は中で回す、Esc で閉じて、開いたボタンへ戻す ──
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
let current = null;
export function openDialog(el, { onClose, focus, opener: op } = {}) {
  closeDialog();
  // Safari does not focus a button on click, and a result can open by itself at the end of a run:
  // the caller may name the control to return to
  const opener = op ?? document.activeElement;
  el.hidden = false;
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(); return; }
    if (e.key !== 'Tab') return;
    const list = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list.at(-1);
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', key, true);
  current = { el, opener, key, onClose };
  const target = focus ?? el.querySelector('[data-autofocus]') ?? el.querySelector('h2');
  if (target) { if (!target.hasAttribute('tabindex') && !target.matches(FOCUSABLE)) target.tabIndex = -1; target.focus({ preventScroll: true }); }
}
export function closeDialog() {
  if (!current) return;
  const c = current;
  current = null;
  document.removeEventListener('keydown', c.key, true);
  c.el.hidden = true;
  c.onClose?.();
  if (c.opener && document.contains(c.opener) && c.opener.offsetParent !== null) c.opener.focus({ preventScroll: true });
}
export const dialogOpen = () => current?.el ?? null;
