// わが家の避難メモ — 自分で書いて、端末の中にだけ保存し、印刷できる。どこにも送らない。
// 印刷に載せるのは、公式想定・指定緊急避難場所・自分で書いた内容だけ（再現の数字は載せない）。
import { $, esc, openDialog, closeDialog, QUAKE_LINE, QUAKE_MORE } from './ui.js';
import { distJa } from './data/evac.js';
import { caseNote } from './data/official.js';
import { edgeJa } from './brief.js';

const KEY = 'tsunami-moshimo-memo-v1';
// 欄の文言は、地区防災の現場の言葉（docs/fable52/会議の生発言/R3_権田.md の確定案）
const FIELDS = [
  ['m-where', 'where', 'まず逃げる場所（建物の名前と、何階まで上がるか）', '例：○○小学校の校舎 3階以上'],
  ['m-meet', 'meet', '離ればなれの時に会う場所（迎えには戻らず、自分が先に逃げる）', '例：○○公園の高台。連絡は災害用伝言ダイヤル171'],
  ['m-help', 'help', '手助けが要る人と、誰が手を貸すか（名前を書く）', '例：祖母（歩くのがゆっくり）→ 父が一緒に'],
];

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; } }

export function createMemo({ getContext }) {
  const dlg = $('memo');
  const body = $('memo-fields');
  body.innerHTML = FIELDS.map(([id, , label, ph]) => `<label for="${id}">${label}</label><textarea id="${id}" rows="2" placeholder="${ph}"></textarea>`).join('');
  // the memo remembers which place it was written for: a memo for home must not be printed, unnoticed,
  // on top of the official figures of some other place the reader was only trying out
  let place = '';
  const values = () => ({ ...Object.fromEntries(FIELDS.map(([id, k]) => [k, $(id).value.trim()])), place });
  const hasText = () => FIELDS.some(([id]) => $(id).value.trim());
  let saveT = 0;
  body.addEventListener('input', () => {
    place = getContext()?.name || place;
    $('memo-other').hidden = true;
    clearTimeout(saveT);
    saveT = setTimeout(() => { $('memo-saved').textContent = write(values()) ? 'この端末に保存しました' : 'この端末には保存できませんでした（印刷して残してください）'; }, 400);
  });

  function sheet() {
    const c = getContext() ?? {};
    const v = values();
    const o = c.official, a = o?.around;
    const cn = caseNote(c.info?.row);
    const near = a?.n ? `周り${a.R}m以内の最大 ${a.max.toFixed(1)}m` : '';
    const off = !o ? '（未確認）'
      : o.state === 'hit' ? `この100m四方の最大浸水深 ${o.cell.depth.toFixed(1)}m${a?.n && a.max > o.cell.depth + 0.05 ? `、${near}（備えは深いほうで）` : ''}`
        : o.state === 'none' ? `このケースでは、この100m四方に浸水のセルなし${a?.n ? `。ただし、${edgeJa(a.edge)}浸水の想定があります（${near}）` : ''}。安全という意味ではありません`
          : o.state === 'outside' ? '収録している公式データの範囲の外（「浸水しない」という意味ではありません）' : '取得できませんでした（「浸水しない」という意味ではありません）';
    const lower = cn?.lower && (o?.state === 'hit' || o?.state === 'none') ? '<p><b>ケース01は、この地域で津波が最も高くなるケースではありません。実際は、これより深く・広くなることがあります。</b></p>' : '';
    const ev = c.evac;
    const sites = ev?.status === 'ok' && ev.sites.length
      ? `<ol>${ev.sites.map((s) => `<li><b>${esc(s.name)}</b>　直線で${distJa(s.d)}・${s.bearing}の方向${s.address ? `<br>${esc(s.address)}` : ''}${s.remarks ? `<br>備考：${esc(s.remarks)}` : ''}</li>`).join('')}</ol><p>近い順で、おすすめの順ではありません。距離は直線です（道のりはもっと長くなります）。入口・開いている時間・何階まで上がるかは、市町村の情報で確かめてください。泊まるための「避難所」とは別です。</p>`
      : `<p>（${ev?.status === 'failed' ? '取得できませんでした' : 'このデータでは、1km以内に見つかりませんでした'}。「逃げる場所がない」という意味ではありません。市町村のハザードマップで確かめて、上の欄に書いてください）</p>`;
    const line = (t) => (t ? esc(t).replace(/\n/g, '<br>') : '<span class="blank"></span>');
    const today = new Date().toLocaleDateString('ja-JP');
    return `<h1>わが家の津波避難メモ</h1>
      <p class="p-quake">${QUAKE_LINE}${QUAKE_MORE}</p>
      <p class="p-meta">調べた地点：${esc(c.name || '（未選択）')}${c.lat != null ? `（${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}）` : ''}　作成日：${today}${v.place && c.name && v.place !== c.name ? `<br><b>注意：上の欄は「${esc(v.place)}」を選んでいた時に書いた内容です。下の想定と逃げる場所は「${esc(c.name)}」のものです。</b>` : ''}</p>
      ${FIELDS.map(([, k, label]) => `<h2>${label}</h2><p class="p-fill">${line(v[k])}</p>`).join('')}
      <h2>公式想定（内閣府 2025・11通りのうちの1つ「ケース01」・100m四方ごとの値）</h2><p>${off}</p>${lower}
      <h2>津波から逃げる場所（指定緊急避難場所・津波）近い順</h2>${sites}
      <p class="p-foot">この紙は予測ではありません。公式想定は1つのケースの値で、実際の津波はこれより早く・深くなることがあります。避難は、市町村の情報と、津波警報・注意報に従ってください。<br><b>このデータは ${today} に取得しました。逃げる場所や想定は変わります。年に1回は家族で見直し、市町村の最新のハザードマップで確かめてください。</b><br>出典：内閣府 南海トラフの巨大地震モデル・被害想定手法検討会（2025）の浸水データを集約加工／国土地理院「指定緊急避難場所データ」（津波）。「津波防災もしも再現」で作成。</p>`;
  }

  $('memo-print').addEventListener('click', () => {
    write(values());
    $('print-sheet').innerHTML = sheet();
    window.print();
  });
  $('memo-clear').addEventListener('click', () => {
    for (const [id] of FIELDS) $(id).value = '';
    place = '';
    try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
    $('memo-other').hidden = true;
    $('memo-saved').textContent = '書いた内容を、この端末から消しました';
    $(FIELDS[0][0]).focus();
  });
  $('memo-close').addEventListener('click', () => closeDialog(dlg));

  return {
    open() {
      const v = read();
      for (const [id, k] of FIELDS) $(id).value = v[k] ?? '';
      place = v.place ?? '';
      const c = getContext() ?? {};
      $('memo-place').textContent = c.name ? `いま選んでいる地点：${c.name}` : '';
      const other = hasText() && place && c.name && place !== c.name;
      $('memo-other').hidden = !other;
      if (other) $('memo-other').textContent = `下の内容は、前に「${place}」を選んでいた時に書いたものです。いまの地点のメモにするなら、書き直してください。`;
      $('memo-saved').textContent = '';
      openDialog(dlg, { focus: $(FIELDS[0][0]) });
    },
  };
}
