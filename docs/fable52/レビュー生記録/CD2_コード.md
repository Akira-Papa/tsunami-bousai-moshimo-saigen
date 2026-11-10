# CD2 コードレビュー（C+D：コミット 07f944c、A の反映：80484d7、未コミットの小差分）

**重大 0件／中 6件／軽微 12件**

対象：ブランチ fable52-improve。実装者とは別の立場で、コードを読んで確かめた（Chrome・GPU は使っていない。ソースは変更していない）。
読んだもの：src/camera.js、src/render/maplayer.js、src/data/mapextra.js、src/data/tiles.js・region.js の差分、src/render/world.js、src/main.js（createApp 全体）、src/brief.js、src/sim/swe.js（markUpdate）、index.html、src/style.css 末尾、three.js 0.186 の OrbitControls.js、設計 11 の 5・6 章。
「推測」と書いた所は、コードからの読み取りで、実機では動かしていない。

---

## 中（6件）

### 中1　#now-line が「深さの数字」ごとに読み上げられる（読み上げがうるさい）
- 場所：index.html:167（`role="status" aria-live="polite"`）／src/main.js:886-901（nowLine）・915-921（updateHud）
- 起きること：水が上がっている間、nowLine は `ここに水が来ました（深さ${h.toFixed(1)}m）` を返す。updateHud は約6コマごと（60fpsで約0.1秒）に呼ばれ、文字列が変わるたびに `textContent` を書き換える（`st.nowLine` と比べているので「毎フレーム」ではないが、深さが0.1m進むたびに別の文になる）。上昇中や「続く」の間、0.1m刻みで読み上げが積み上がる。
- 根拠：読み上げ用に作られた `#h-say-live`（main.js の `band` が変わった時だけ書く）とは別に、同じ内容が #now-line でも流れる。#auto-note（role=status）・#toast（role=status）も同時に動くので、status が同時に3〜4個鳴りうる。
- 直し方の案：#now-line から `aria-live` を外し、読み上げは「状態の切り替わり（沖が静か→上がる→防潮壁→陸に水→ここに水が来た→引く）」の時だけ別の sr-only の領域へ書く。深さの数字は文に入れない（見た目の行にだけ残す）。

### 中2　立って見る視点との行き来で、切替の最初のコマに「ぽん」と寄る・離れる
- 場所：src/camera.js:43-47（setLook）・59-64（setView）・49-52（moveTo）
- 起きること：非look→look の切替で、`setLook(true)` が即座に minDistance=maxDistance=0.5 を設定し、その直後に始まるアニメーションの最初の `controls.update()` が、半径を 0.5 に丸める（OrbitControls.js の update は毎回 `_clampDistance` で半径を制限する）。アニメーション中のカメラは「その時点の注視点から 0.5m」に固定され、注視点が `t0`（地点）から `t1` へ動くのに引きずられる。つまり俯瞰から「立って見る」を押した瞬間、カメラは地点から0.5mの所へ飛ぶ。逆（look→他）は minDistance=8 に戻るので、0.5m→8m にぽんと引く。
- 根拠：camera.js の `anim` は `camera.position` を lerp してから `controls.update()` を呼ぶので、lerp の結果が OrbitControls の距離制限で上書きされる（update() 内の `_spherical.radius = _clampDistance(...)`）。nav.mjs は到達後の状態だけを見ているはずで、途中経過は確認できていない（推測）。
- 直し方の案：look への切替では、アニメーション中は min/max を従来の値のままにし、アニメーション終了時（`anim.t>=1`）に `setLook(true)` を適用する。または look の切替だけ、短いフェード（暗転）か `instant` にする。

### 中3　ホイール（トラックパッドの慣性スクロールを含む）で、切替アニメーションが途中で止まる
- 場所：src/camera.js:37-41（onStart と onWheel）
- 起きること：視点の切替中（1.2秒）にホイールを回すと `anim = null` になり、カメラが途中の位置に取り残される。立って見る視点（look）では寄れない（min=max=0.5）ので、「何も起きないのに切替だけ止まる」。トラックパッドの慣性スクロールや、パネル上のスクロールの余韻が canvas に届いた時にも起こりうる。1本指・マウスの `pointerdown` でも同じ（「利用者の操作が勝つ」の設計どおりだが、ホイールが効かない状態でも止まる点が合わない）。
- 根拠：OrbitControls の onMouseWheel は `enableZoom` かつ `state===NONE` の時だけ 'start' を出す。camera.js の独自 `onWheel` は常に `anim=null` にする（OrbitControls が 'start' を出すので二重でもある）。
- 直し方の案：独自の wheel リスナーを消し、OrbitControls の 'start' だけに任せる。さらに look 中は wheel で止めない。「止めた時は、行き先まで一気に進めるか、いまの位置のまま止めるかを選ぶ」仕様をはっきりさせる（途中で止める案なら、行き先の視点名のボタン表示 `.on` も合わせて外す）。

### 中4　スマホの最初の画面（topHtml）が、下の欄にある2つの注意を出していない
- 場所：src/brief.js:74-92（topHtml）／比べる先：同 49-58・62（officialHtml）
- 起きること：
  1. 状態が hit で「周り○m以内の最大」が `deeper` の時、officialHtml は「（海や川の水面にかかるセルを含むことがあります）」（`a.landOnly` が偽の時）を添えるが、topHtml は添えない。最初の画面に「周り300m以内 12.0m　備えは深いほうで」だけが出て、その値が海・川にかかるセルの値かもしれないことが分からない（官公庁の数字を「備えの基準」に読ませる文なので、注意は同じ強さで必要）。
  2. `o.partial`（周りの公式データの一部を取得できなかった）の注記が topHtml にない。「周りの最大は、これより深いことがあります」が最初の画面では欠ける。
- 根拠：設計 11 の「決まり：状態に結びつく注意は畳まない」。この2つは状態に結びつく注意。
- 直し方の案：topHtml の hit で `deeper && !a.landOnly` の時に `<small>` で短く添える。`o.partial` の時は `state` の末尾に「周りの一部は取得できていません」を足す。また none の時の弱い近隣値（officialHtml の `weak`）の扱いを揃える（topHtml は 0.2m・230m先でも同じ「浸水の想定があります」の文になる）。

### 中5　「北を上に」「Q/E」などの大きい回転が、カメラを注視点の真上へ振り上げる
- 場所：src/camera.js:105-115（turn / north）・49-52（moveTo）
- 起きること：turn は「いまのカメラ位置」と「回した後の位置」を直線で補間する（円弧ではない）。回す角が大きいほど（北を上にするが、南向きの時は約180°）、補間の途中でカメラが注視点に近づく。水平成分が0に近づくので、高さだけが残り、カメラが真上を通って反対側へ振られる（OrbitControls が phi を makeSafe するので真上で止まって見える）。俯瞰（高さ約260m・後ろ380m以上）では、距離も460mから約260mまで縮む。
- 根拠：lerpVectors による位置補間（camera.js:91-94）。方位が±90°を超える時の north() が該当する。
- 直し方の案：turn のアニメーションだけは、角度を補間して `off.applyAxisAngle` で毎コマ位置を出す（円弧）。または 90°を超える north() は instant にする。

### 中6　流れの印が、水が出始めの時に疎になる／最初の1本が遅い（推測）
- 場所：src/sim/swe.js:432-452（markUpdate）、480 付近の休み時間（`r3.mul(-8).sub(5)`＝休み5〜13秒の画面の時間）
- 起きること：1本の印は「休む5〜13秒 → 1回だけ乱数のセルを試す → 水が流れている所（A.x>0.05・建物でない・速さ0.3m/s超）でだけ生まれる（海は27%の確率でだけ試す）」。同時に出る数の目安は MARKS×（約4÷（約9＋4p））×p。p は「正方形の中で流れているセルの割合」。MARKS は 16384（N<768）か 32768。
  - 水が陸に上がった直後は p が小さい（推測で0.1〜0.5%）。32768本でも、同時に出る印は数十本、16384本では20〜40本程度になりうる。以前（休み0.5〜2秒）の約1/6。
  - 再生を始めた最初のコマで全部の印が試して失敗し、全員が5〜13秒休む。水が先に出た時でも最初の印が出るのは、画面の時間で数秒後。
  - `uMk.x` は `min(sdt, 0.05)`（swe.js:743）。20fps を切ると印の時間が実際より遅く進み、休みがさらに長く感じられる。
- 根拠：計算式のみ（実機では未確認）。設計 A の狙い「水が陸に上がる瞬間（×5）に流れが見える」に関わる。
- 直し方の案：休みを一定にするのではなく、「前の試みが成功率を持つ」形にする（試す回数を p の推定に合わせる＝失敗が続いたら次の試みを早める／1回の休みの中で2〜3回試す）。または、印の総数の下限（水が出始めの時だけ休みを短く）を設ける。実機で、名古屋の陸上がり直後の画面の印の数を数えると確実。

---

## 軽微（12件）

1. **camera.js:98（`if (!anim) clamp()`）**　アニメーション中は地面・panR の制限が効かない。キー・ボタンの pan（0.25秒）は終了の瞬間に制限へ「ぱちん」と戻る（panR の端で押した時）。長い切替（1.2秒）の途中で、小さな丘をカメラが突き抜けることもありうる（推測）。制限を毎コマ適用し、アニメーションの端点だけ補間する形が安全。
2. **camera.js:141-157（onKey）**　キーを押し続けると、`keydown` の自動連打のたびに `moveTo` が e=0 から始まる（smoothstep は最初が遅い）ので、押し続けた時の速さが1回押しの約1/3になる（推測）。連打中は anim を作らず、毎コマ `rdt` で動かす方式がなめらか。また `;` が「近づく」に割り当てられていて、`;` を打つだけで寄る（日本語キーボードでは `+` が Shift+`;` なので、その救済と思われる。`e.shiftKey` と `e.code === 'Semicolon'` を見て、`;` 単独は外す方がよい）。
3. **camera.js:125-140**　立って見る視点では、＋−ボタン・矢印・ダブルクリックが「何も起きない」まま。`.navbtn` を disabled か `aria-disabled` にするか、押した時に短く理由を出すとよい。maxPolarAngle（0.495π）のため、look では上を向けない（水平より上は見えない）のも仕様として案内した方がよい。
4. **camera.js・main.js:700（camera.fov）**　縦横の判定は createApp の時だけ。スマホを横に回すと fov は 62 のまま（以前から）。onResize で `innerWidth < innerHeight ? 62 : 45` を更新するのが安全。
5. **main.js:687-697（compose）**　ドック・HUD の高さが変わるたび（おまかせの知らせの出入り、「表示」を開く、HUD の1行/2行の切替）に、絵の中心がずれる。水が来る瞬間（知らせが出る＝ドックが約40px高くなる）に3Dの絵がふっと上へ動く。ドック高の変化を拾うのは ResizeObserver（main.js:1334）だけで、HUD の高さ（#now-line の折り返しで変わる）では呼ばれない。一定の余白を先取りするか、ずれをなめらかに補間する（`setViewOffset` を数コマかけて動かす）と見た目が安定する（推測）。
6. **main.js:739・742（`$('now-line')`）**　アプリ作成時に `now-line` へ START_SAY を直接書くが `st.nowLine` は未設定なので、最初の updateHud で同じ文をもう一度書く（スクリーンリーダーが再読する場合がある）。`st.nowLine = START_SAY` で初期化する。
7. **main.js:710（max: innerWidth <= 760 ? 6 : 12）**　札の数の上限が作成時の画面幅で固定。窓幅を変える・回転すると合わない。`update()` の引数に毎回渡す。
8. **src/render/world.js（roadCanvas）・maplayer.js:12-30**　道が0本（合成の港町・取得失敗）でも 2048×2048 の OffscreenCanvas（約16MB）と CanvasTexture を作る。`region.mapRoads?.length` が0なら小さいダミー（1×1）にする。解放は `roadTex.dispose()`（world.js）で GPU 側は片付くが、CPU 側の canvas は texture.image への参照が切れるまで残る（`roadTex.image = null`）。
9. **mapextra.js:50（`rnkWidth`）**　`Math.max(0, Math.min(4, Number(p.rnkWidth ?? 1)))`。もし値に「不明」を表す大きな数（例 9999）があると 4（幅17m）に丸まり、太い道として描かれる。NaN になる値は `r.w !== w` で黙って捨てられる。仕様の値の範囲を確かめ、範囲外は 1（細め）か捨てる、と明示するのがよい（推測：実データで確かめていない）。
10. **maplayer.js:98-124（createBeacon）**　柱の高さは80mで固定、太さだけが距離に比例する。4km 離れると80mは画面で約2%の高さしかなく、太い短い筒に見える（推測）。高さも `dist` に比例させる（例 `dist*0.15`）と、設計の「細い光の柱」に近づく。
11. **アクセシビリティの細部**　(a) 札（CSS2DObject）は最大90個が DOM に残り、スクリーンリーダーに読まれうる。`labels.domElement` に `aria-hidden="true"` を付ける（3Dの内容は別の欄で読める）。(b) `#disp-btn` の文字「表示 ▾」の記号が読み上げられる。`aria-label="表示の切りかえ"` と、`aria-expanded` が既にあるので記号は `aria-hidden` の span に。(c) `#bt-more` を押した時、スクロールするだけでフォーカスは移らない（#brief-h は tabindex=-1 なので `focus({preventScroll:true})` を足せる）。また `part()` が毎回 `#brief-top` を innerHTML で作り直すので、#bt-more にフォーカスがある時に遅れて届いた答えでフォーカスが落ちる。(d) `#band`（role=img）の名前は固定で、いまの段階を伝えない（#now-line が言うので許容）。
12. **main.js:748-750（on と cleanups）**　createApp の途中で例外が出ると（rig・on・nav-hint の登録のあと）、`app` に代入されないまま dispose が呼ばれず、OrbitControls・`window` の keydown・#play の click が残る。再試行で二重に付く。try/catch で `cleanups` を流す（以前からの作り）。

（補足の軽微）カメラの床は地面（groundAt）の高さで、浸水した水面ではない。水の中（浸水域の地面+1.5m）へカメラが入ると、水面の下から見える（推測。以前の視点でも起こりえた）。

---

## 確かめたが問題なかった点

**camera.js**
- OrbitControls 0.186 の使い方：`keys` を空にして `listenToKeyEvents` を呼ばないので二重処理なし。`touches`・`enableDamping`・`screenSpacePanning=false`・`maxPolarAngle` は有効な設定。`controls.dispose()` は disconnect を呼び、リスナーと `touchAction` を戻す。camera.js の自前リスナー（start・wheel・keydown・dblclick）は dispose ですべて外れる。
- rotateSpeed に負の値を入れても、`_rotateDelta = (end − start) × rotateSpeed`（OrbitControls.js:1114・1378）で反転するだけで破綻しない。look の min=max=0.5 は update の距離制限で保たれる。
- 注視点の制限（panR・地面〜+30m）とカメラの床は、`!anim` の時に毎コマ適用される。`center !== home` の判定は、views の `center` が毎回新しい Vector3 なので 'wide'・'impact' で正しく働く。
- pan() の右ベクトル `(-fz, 0, fx)` は右手系・y 上で正しい。
- `setViewOffset` と他の部品：`updateProjectionMatrix`（near の更新時も）は view を含めて計算する。CSS2DRenderer・自前の札の `project(camera)`・レイキャストは同じ `projectionMatrix` を使うので、位置はそろう。ポストエフェクト（bloom 等）は画面UVだけで、オフセットとは干渉しない。compose の符号（ox・oy）も、自由な領域の中心へ絵の中心が寄る向きで正しい。
- `compose()` が `let panelRects` の宣言より前に呼ばれていない（TDZ なし）。`#sim` が非表示の間は何もせず、show('sim') 後の `onResize()` と dock の ResizeObserver で追いつく。

**maplayer.js・mapextra.js**
- `tileMapExtra` の座標変換は既存の `tileLines`（tiles.js:187-207）と同じ式（`frame.toLocal(ty2lat(...), tx2lon(...))`、extent で割る）。タイルの外にはみ出た点（バッファ）の札は `g.x<0 || g.x>=extent` で落とす。道は同じ幅の区分を1つのパスに描くので、タイルの継ぎ目の重複線でアルファが濃くならない。
- 札は `textContent`（XSS なし）。重なり判定は「大きい優先度から先に確保」の貪欲法で、`n < max`・距離・画面の内側・既に確保した矩形との交差をすべて見る。`dist > 25` と `KIND_RANGE` で近すぎ・遠すぎを除く。
- DOM の後始末：`mapLabels.dispose()` が各要素を remove し、`labels.domElement.replaceChildren()` も呼ぶので、地点を選び直しても札は残らない。beacon の geometry・material は `world.dispose()` の traverse で破棄される。`roadTex.dispose()` も追加済み。
- 道の描画（world.js）は乾いた地面だけ・`uShowMap` で切替・`setMapVisible` が `tg-map` と連動。canvas の向き（flipY=false）は offTex と同じ流儀。

**main.js**
- 地点を選び直した時：`start()` が最初に `stopApp()`（setAnimationLoop(null) → dispose）を呼ぶ。`on()` 経由のリスナー・nav-hint のリスナー・keyFn・タイマー（トースト・おまかせの再開・自動再生）はすべて cleanups に入る。`#auto-note`（cleanups で非表示）・`#now-line`（作成時に START_SAY）・`#band-pos`・`#speed-sel`（showSpeed）・`#toast`・`#r-extra`・`#views .on`（setView→onView）は新しい地点の始めに初期化される。`.navpad` は #sim の中なので画面と一緒に出入りする。
- 一時停止中：`nowLine` は `st.playing` が偽でも t>0 なら状態の文を返す（START_SAY は t≤0 の時だけ）。イベントの表示期限は実時間なので、停止中でも消える。結果ダイアログを開いている間：ラベル描画は止まらないが問題は出ない（`ui.play()` で停止済み）。
- WebGPU がない時：`#disp-btn`・`#hud-more` のハンドラは `app?.compose()` で null 安全。`onResize` は `renderer` の有無を見る。3Dに入らないので nav・rig は作られない。
- `highlight()` の変更（80484d7）：`near` は `front` が Infinity の時に偽。`st.hl.begin` を使う上限（240秒）と `hlStall` の組み合わせで、無限に延長されない。`rig.view === 'wide'` は表示の速さにだけ関わる。水の計算は、sim/advance.js の設計どおり「分け方（再生の速さ・fps）に依らない」固定の sub-step 番号で動くので、視点や速さの切り替えが結果を変えない。
- speed-sel と seg の二重管理：`showSpeed()` が両方を同じ状態から更新する。`<option>` の値（auto・1・5・20・60・999）は `baseSpeed`（20 or 60）・最速（999）をすべて含む。固定の速さを選ぶと次の `highlight()` が `st.hl = null` にする。
- フレームごとの重い処理：札の更新は6コマに1回、方位の針も同じ間隔。`#now-line` の `textContent` は文字が変わった時だけ書く（中1は「変わる頻度」の問題）。

**brief.js（topHtml）**
- 4つの状態（hit・none・outside・failed）と、逃げる場所（null＝確認中／failed／0件／あり）、道のり（null・ok・その他）の全組み合わせで、`undefined`・例外は出ない。`rt.sites[k]?.road` は null を除く。道のりが届かない場所だけの時は「直線で」に戻る。名前は `esc`、数値は `toFixed` のみで、エスケープ漏れなし。`o.cell`・`c.arrival`・`ev.sites[0]` はそれぞれ状態の条件の中でだけ使う。

**index.html・style.css**
- id の重複なし（`grep` で確認）。`[hidden] { display:none !important }`（style.css:178）があるので、`#disp`・`#nav-hint`・`#auto-note` の display との衝突はない。`:focus-visible`（style.css:246・571）で canvas・ボタンのフォーカスが見える。`prefers-reduced-motion` の時、camera は instant になり、CSS の transition もない。スマホ幅の `.speed-sel`（select）は PC で `display:none`、`#speeds` はスマホで `display:none` なので、読み上げの二重はない。
- 古い規則（`.time`・`.dock { grid-template-columns }`・`.clock-note { flex-basis:100% }`）との衝突は、`#sim` のID付きの新しい規則が上書きしている（詳細度で勝つ）。残る `.time` 系は使われていない（死んだ規則、軽微）。

**swe.js（markUpdate）・world.js**
- 読み手は `world.js:313-321` だけで、`FV.w` は `step(0.25, f.w)`（0/0.5/1 のどれでも 0→非表示、それ以外→表示）と `smoothstep(0.5, 1.0, f.w)`（0.5→0、1→1）で扱う。0.5 が「海＝薄い」・1 が「陸＝濃い」になり、0 は休み。新しい w の意味と整合している。`FV` を読む他のコード（scripts・test）はない。
- 水の計算への影響：`markUpdate` が読むのは A・S・R・R2 だけで、書くのは FM・FV だけ。`marks()` の呼び出しは表示用（main.js の `world.marks.visible` の時のみ）。計算結果が変わる経路は増えていない。乱数は `mkFrame`（フレーム番号）由来で、水の計算とは独立。
- 休みが長い（5〜13秒）ことで「印が完全に出なくなる」条件は、p が極めて小さい（<0.01%）時だけ。ただし中6のとおり、出始めは疎になる。

**未コミットの差分**
- main.js の toast 文言変更・style.css の `#sim .toast` 追加：`#toast-yes` が hidden の時（防潮壁の知らせを toast に出していた頃の名残）の扱いは、この差分では残っていない。スマホ幅の `.toast` は `flex-wrap` でボタンが文の下に横並び。`white-space:nowrap` のボタンは `flex:none` で縮まない。問題なし。
