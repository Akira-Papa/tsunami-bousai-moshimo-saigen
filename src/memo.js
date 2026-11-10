// わが家の避難メモ — 自分で書いて、端末の中にだけ保存し、印刷できる。どこにも送らない。
// 印刷に載せるのは、公式想定・指定緊急避難場所・自分で書いた内容だけ（再現の数字は載せない）。
import { $, esc, openDialog, closeDialog, QUAKE_LINE, QUAKE_MORE } from './ui.js';
import { distJa } from './data/evac.js';

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
  const values = () => Object.fromEntries(FIELDS.map(([id, k]) => [k, $(id).value.trim()]));
  let saveT = 0;
  body.addEventListener('input', () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { $('memo-saved').textContent = write(values()) ? 'この端末に保存しました' : 'この端末には保存できませんでした（印刷して残してください）'; }, 400);
  });

  function sheet() {
    const c = getContext() ?? {};
    const v = values();
    const o = c.official;
    const off = !o ? '（未確認）'
      : o.state === 'hit' ? `この付近（100m四方）の最大浸水深 ${o.cell.depth.toFixed(1)}m${o.cell.arrival != null ? `、地震から最も早くて約${Math.round(o.cell.arrival / 60)}分で水が来はじめる想定（猶予の時間ではありません）` : ''}`
        : o.state === 'none' ? 'このケースでは、この100m四方に浸水のセルなし（安全という意味ではありません）'
          : o.state === 'outside' ? '収録している公式データの範囲の外（「浸水しない」という意味ではありません）' : '取得できませんでした';
    const ev = c.evac;
    const sites = ev?.status === 'ok' && ev.sites.length
      ? `<ol>${ev.sites.map((s) => `<li><b>${esc(s.name)}</b>　直線で${distJa(s.d)}・${s.bearing}の方向${s.address ? `<br>${esc(s.address)}` : ''}${s.remarks ? `<br>備考：${esc(s.remarks)}` : ''}</li>`).join('')}</ol><p>直線の距離です。入口・開いている時間・何階まで上がるかは、市町村の情報で確かめてください。</p>`
      : '<p>（このデータでは確認できませんでした。自治体のハザードマップで確かめて、上の欄に書いてください）</p>';
    const line = (t) => (t ? esc(t).replace(/\n/g, '<br>') : '<span class="blank"></span>');
    return `<h1>わが家の津波避難メモ</h1>
      <p class="p-quake">${QUAKE_LINE}${QUAKE_MORE}</p>
      <p class="p-meta">地点：${esc(c.name || '（未選択）')}${c.lat != null ? `（${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}）` : ''}　作成日：${new Date().toLocaleDateString('ja-JP')}</p>
      ${FIELDS.map(([, k, label]) => `<h2>${label}</h2><p class="p-fill">${line(v[k])}</p>`).join('')}
      <h2>公式想定（内閣府 2025・ケース01・100m四方に集約）</h2><p>${off}</p>
      <h2>津波から逃げる場所（指定緊急避難場所・津波）近い順</h2>${sites}
      <p class="p-foot">この紙は予測ではありません。公式想定は1つのケースの値で、実際の津波はこれより早く・深くなることがあります。避難は市町村の情報と、津波警報・注意報に従ってください。<br>出典：内閣府 南海トラフの巨大地震モデル・被害想定手法検討会（2025）の浸水データを集約加工／国土地理院「指定緊急避難場所データ」（津波）。「津波防災もしも再現」で作成。</p>`;
  }

  $('memo-print').addEventListener('click', () => {
    write(values());
    $('print-sheet').innerHTML = sheet();
    window.print();
  });
  $('memo-close').addEventListener('click', () => closeDialog());

  return {
    open() {
      const v = read();
      for (const [id, k] of FIELDS) $(id).value = v[k] ?? '';
      const c = getContext() ?? {};
      $('memo-place').textContent = c.name ? `地点：${c.name}` : '';
      $('memo-saved').textContent = '';
      openDialog(dlg, { focus: $(FIELDS[0][0]) });
    },
  };
}
