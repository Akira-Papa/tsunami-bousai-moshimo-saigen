# 15　UI/UX の見直し — 調査と方針

2026-11-12　ブランチ `fable52-improve`（直す前 = c35edf9）。担当：Fable 5.2。

本人（あきらパパ様）の指示（2026-11-11）：「テキスト多すぎる、わかりにくい。もっとわかりやすく簡潔に。おじいちゃんおばあちゃんもいる。いろんな人に見やすいサイトに。ほかのサイトも見て、参考に」。

結果（何を直し、何を確かめたか）は [16_UIUX見直し_結果.md](16_UIUX見直し_結果.md)。直す前｜直した後の並べ画像は [uiux/](uiux/)。

## 1　直す前の画面で、分かりにくかった所（実測）

`scripts/fable52/uiux-shots.mjs` で、名古屋港 ガーデンふ頭を PC幅（1440×900）とスマホ幅（390×844）で開き、画面に見えている文字を数えた（生の記録：[uiux/raw/uiux_before.json](uiux/raw/uiux_before.json)）。

| 場面 | 見えている文字（PC） | うち14px未満 | 見えている文字（スマホ） | うち14px未満 |
|---|---|---|---|---|
| はじめの画面 | 450字 | 328字 | 251字 | 129字 |
| 場所を選んだ直後 | 736字 | 448字 | 399字 | 323字 |
| 3D（水が着いた後） | 929字 | 837字 | 338字 | 328字 |
| 3D（「表示」を開く） | 1,151字 | 1,059字 | 556字 | 547字 |
| 結果 | 857字 | 360字 | 550字 | 108字 |

- カードの中身は、畳まれていない文字だけで **約3,800字**。最初に目に入るのが、長い説明文と出典。
- 3Dの画面は、**文字の9割が14px未満**（いちばん小さい文字は10px）。暗い半透明の面に、淡い色の小さな文字。
- 大事なことが1つに絞られていない。場所を選んだ直後に、深さの数字・4行の注意・到達の文・ケースの注記・逃げる場所の説明が、同じ大きさで並ぶ。
- 3Dの逃げ道の帯の凡例は、操作欄のいちばん下に11〜12pxで1行。「緑・橙・灰色の点線」の意味を、色の小さな見本と文で読ませていた。
- 3Dの右の欄（PC）は、はじめから「くわしく」が開いていて、数字が6つと、小さな字の説明が続く。
- 押す所：PCのはじめの画面で、44px未満のものが17個（地点の例のボタンが34px）。

## 2　調べたこと

別役（調査）が Web 検索で一次情報を開いて確かめた。**実際に開いて本文を確認できたものだけ**を載せる。開けなかったものは 2.4 に分けた。確認日 2026-11-12。

### 2.1　指針（数字つき）

| 項目 | 推奨値・ルール | 出典 |
|---|---|---|
| 文字のコントラスト | 4.5:1 以上。大きな文字は 3:1 以上（AA） | WCAG 2.2 達成基準 1.4.3　https://www.w3.org/TR/WCAG22/ |
| 文字以外（アイコン・枠・地図の線） | 隣り合う色と 3:1 以上（AA） | WCAG 2.2 1.4.11　https://www.w3.org/TR/WCAG22/ |
| 文字の拡大 | 200% まで拡大しても内容・機能を失わない（AA） | WCAG 2.2 1.4.4 |
| リフロー | 幅 320 CSS px で横スクロールなし（AA） | WCAG 2.2 1.4.10 |
| 押せる範囲（最低） | 24×24 CSS px 以上（AA） | WCAG 2.2 2.5.8　https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| 押せる範囲（望ましい） | 44×44 CSS px 以上（AAA） | WCAG 2.2 2.5.5　https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html |
| 色だけに頼らない | 色を唯一の伝達手段にしない（A） | WCAG 2.2 1.4.1　https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html |
| 色＋模様・形・線種 | 図は色＋破線／点線などを組み合わせ、凡例も同じ組み合わせで示す | WCAG 達成方法 G111　https://www.w3.org/WAI/WCAG22/Techniques/general/G111 |
| 文字の大きさ | 本文・UI は 16 CSS px 以上が基準。14px は付随情報のみ、14px 未満は原則不可 | デジタル庁デザインシステム（タイポグラフィ）　https://design.digital.go.jp/dads/foundations/typography/ |
| 行間 | 本文は文字サイズの 1.5 倍以上（一般の本文は 150〜175%） | 同上 |
| ボタン | 高さは Large 56px／Medium 48px。小さいボタンも押せる範囲は 44 CSS px 以上。塗りの主ボタンは1画面に原則1つ | デジタル庁デザインシステム（ボタン）　https://design.digital.go.jp/dads/components/button/usage/ |
| 色 | 文字は背景と 4.5:1 以上、アイコン・枠線は 3:1 以上 | デジタル庁デザインシステム（カラー）　https://design.digital.go.jp/dads/foundations/color/ |
| 加齢による変化 | コントラスト感度・色の知覚・近くの焦点、細かい操作、短期記憶や集中が下がる | W3C WAI Older Users and Web Accessibility　https://www.w3.org/WAI/older-users/ |
| 高齢者向けの作り方 | 文字は 200% まで拡大可、コントラスト 4.5:1（強化は 7:1） | W3C WAI Developing Websites for Older People　https://www.w3.org/WAI/older-users/developing/ |
| 高齢者の使いやすさ | 65歳以上の調査。小さい文字・小さいボタンが主な障害。エラー文は簡潔・具体的に | NN/g Usability for Older Adults　https://www.nngroup.com/articles/usability-for-senior-citizens/ |
| タッチの大きさ（実寸） | 1cm×1cm 以上、間隔も空ける | NN/g Touch Targets　https://www.nngroup.com/articles/touch-target-size/ |
| iOS の目安 | 押す部品は 44pt×44pt 以上 | Apple UI Design Dos and Don'ts　https://developer.apple.com/design/tips/ |
| Android の目安 | 押す部品は 48×48dp 以上 | Google Android Accessibility Help　https://support.google.com/accessibility/android/answer/7101858?hl=en |
| 警戒レベルの配色 | 5＝黒、4＝紫、3＝赤、2＝黄、1＝白。色覚の型別に検証済み | 内閣府（防災担当）2020-05-29　https://www.bousai.go.jp/pdf/200529_haishoku.pdf |
| 気象情報の配色 | 赤と緑の混在を避ける。線は高齢者に配慮して可能な限り太く | 気象庁 配色に関する設定指針　https://www.jma.go.jp/jma/kishou/info/colorguide/HPColorGuide_202007.pdf |
| 色のユニバーサルデザイン | 見分けやすい配色／見分けにくい人にも伝わる／色の名前で会話できる | CUDO　https://www.cudo.jp/?page_id=86 |
| JIS X 8341-3:2016 | WCAG 2.0 と同じ内容の規格 | WAIC　https://waic.jp/docs/jis2016/understanding/201604/ |
| 公共サイトの手順書 | JIS X 8341-3:2016 に基づく取組と手順 | 総務省 みんなの公共サイト運用ガイドライン　https://www.soumu.go.jp/info-accessibility-portal/webaccessibility/guideline/ |

### 2.2　参考にしたサイト

| サイト | 分かりやすい点 | このサイトで取り入れたこと |
|---|---|---|
| 国土地理院 重ねるハザードマップ（2023-05-30 リニューアル）　https://www.gsi.go.jp/bousaichiri/bousaichiri61037.html | 住所を入れると、その地点の災害リスクと取るべき行動を**文で**出す | 場所を選んだら、まず「ここに来る水の深さ ○m」と「水が来る前に、高い所へ」を出す |
| ハザードマップポータルサイト　https://disaportal.gsi.go.jp/ | 入口は「住所から探す」と大きなボタン数個だけ | はじめの画面を、住所の欄・「さがす」・「地図をおしても、えらべます」に絞った |
| 気象庁 警戒レベル・キキクル　https://www.jma.go.jp/jma/kishou/know/bosai/alertlevel.html | 色と行動が1対1（黄＝注意、赤＝警戒、紫＝危険） | 深さの色に、短い言葉を1つ添える（「巻き込まれると、命にかかわる深さ」など） |
| 東京都防災アプリ　https://www.bousai.metro.tokyo.lg.jp/1028747/index.html | 一般・キッズ・シニアのモード、やさしい日本語 | 切り替えは作らず、はじめから全員に読める言葉・大きさにした（切り替えを探させない） |
| Wellington（WREMO）津波避難ゾーン　https://www.wremo.nz/hazards/tsunami/ | 色を3つに抑え、合言葉を1つ掲げる（Long or Strong, Get Gone） | いつも見える黄色の帯に「強い揺れや、弱くても長い揺れを感じたら、すぐ高い所へ避難を。」 |
| NANOOS Tsunami Evacuation Zones　https://nvs.nanoos.org/TsunamiEvac | 凡例は、避難路・集合場所などを絵＋言葉で示す | 逃げ道の凡例を、線の見本（色＋実線／点線）＋短い言葉にした |
| Oregon Tsunami Clearinghouse　https://www.oregon.gov/dogami/tsuclearinghouse/Pages/default.aspx | 「Beat the Wave」地図は、着くのに必要な速さを示す | 行き先ごとに「歩いて 約○〜○分」をいちばん大きく出す |
| NOAA tsunami.gov　https://www.tsunami.gov/ | いまの状態を1文で最上部に置く | 3Dの「いま何が起きているか」の1行を、19pxの太字にした |
| GOV.UK Check your long term flood risk　https://www.gov.uk/check-long-term-flood-risk | 開始前に「分かること・分からないこと」を短く。次の画面の問いは1つだけ | 「これは『もしも』の再現です。予測ではありません」を、どの画面でもいちばん上に |
| GOV.UK Service Manual（Structuring forms）　https://www.gov.uk/service-manual/design/form-structure | 1ページに1つのこと | ①場所をえらぶ → ②深さと逃げる場所 → ③3Dで見る、の3段階を見せる |
| GOV.UK Use clear language　https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/ | 長い文は分ける。能動態。平易な言葉 | 1文を短く。「〜してください」でそろえる |
| NN/g Progressive Disclosure　https://www.nngroup.com/articles/progressive-disclosure/ | 最初は大事な少数だけ。段階は2つまで。入口は見える所に、明確な名前で | 長い説明・出典は「くわしく」に1段だけ畳む（入口は枠つき・52px・名前つき） |
| NN/g Instructional Overlays and Coach Marks　https://www.nngroup.com/articles/mobile-instructional-overlay/ | 案内は1度に1つ。使う場面で。絵＋ごく短い文 | 3Dの初回は「指でなぞると、まわせます」だけを大きく出す |
| 特務機関NERV防災アプリ（報道記事）　https://www.businessinsider.jp/post-258630 | 色覚の型別の配色、文字サイズの切り替え、読み上げ用の並び | 色だけで区別しない（線種・記号・言葉を必ず添える） |

### 2.3　言葉のルール（やさしい日本語）

出典：出入国在留管理庁・文化庁「在留支援のためのやさしい日本語ガイドライン」（2020年8月）https://www.moj.go.jp/isa/content/930006072.pdf 、弘前大学社会言語学研究室「『やさしい日本語』作成のためのガイドライン」（増補版 2013・消防庁サイト掲載の写し）https://www.fdma.go.jp/singi_kento/kento/items/kento207_20_sankou5-6.pdf

- 1文は短く、1文で言うことは1つ。
- 3つ以上のことは箇条書き。
- 回りくどい言い方をやめる。
- 外来語（カタカナ語）は、できるだけ使わない。
- 漢語より和語（「避難」→「逃げる」）。略語・専門用語は避ける。
- 二重否定を使わない。
- 受身・使役は、できるだけ使わない。
- 曖昧な言い方を避け、時間や数字をはっきり書く。
- 文末は「です・ます」。指示は「〜してください」。
- 大事な災害の言葉はそのまま使い、後ろに説明を付ける。

### 2.4　開けなかったもの・確かめられなかったもの

- NHK「全国ハザードマップ」・NHK防災・NEWS WEB EASY（利用規約への同意画面で止まる。同意していない）。
- Yahoo!天気 災害マップ、東京マイ・タイムラインの中身、FEMA Flood Map Service Center（接続エラー）、Climate Central（操作部品を読み取れず）、GeoNet（参考になる画面を確認できず）。
- NERV防災アプリのグッドデザイン賞受賞（受賞データベースで確認できず。上の表は報道記事による）。
- Apple HIG 本体・Material Design 3 本体（44pt／48dp は、上の表の公式ページで確認）。
- UDフォントの高齢者への効果（一次情報を確認できず。フォントは今までどおり Noto Sans JP）。
- キキクルの「5段階」という表記、海外サイトの「緑＝安全」の色の割り当て（本文で確認できず。このため「緑＝安全」とは書かず、「緑＝逃げる場所への道」とした）。

## 3　方針（この調査から決めたこと）

合言葉は **「あかるく・おおきく・みじかく」**。

| # | 方針 | 根拠 | 具体的な決まり |
|---|---|---|---|
| 1 | **明るい地に、濃い文字** | WCAG 1.4.3、W3C WAI（加齢でコントラスト感度が下がる）、デジタル庁（カラー） | 白い面に、ほぼ黒（#14191f・約17:1）。添え書きも #55616d（約6:1）以上。3Dの上の欄も、半透明の暗い面をやめて、白い面にする |
| 2 | **文字を大きく** | デジタル庁（16px が基準・14px は付随情報のみ）、NN/g（小さい文字が主な障害） | 本文 16px、大事な文は 17〜19px、数字は 36〜60px。添え書きは 14px 以上。例外は、3Dの中の小さな札と、ボタンの下の1語（12〜13px） |
| 3 | **押す所を大きく** | WCAG 2.5.5（44px）、デジタル庁（56／48px）、Android（48dp） | 押す所は 48px 以上。いちばん大事なボタン（「さがす」「3Dで水の動きを見る」「再生」）は 56〜60px。青の塗りのボタンは、1画面に1つ（＋検索） |
| 4 | **1画面に、大事なことを1つ** | GOV.UK（One thing per page）、重ねるハザードマップ（文で出す） | ①場所をえらぶ ②ここに来る水の深さ（数字＋絵＋短い言葉）③3Dで見る。いまの段階を、①②③の印で見せる |
| 5 | **長い説明は「くわしく」に、1段だけ畳む** | NN/g（Progressive Disclosure。段階は2つまで・入口は明確な名前で） | 出典・計算の条件・くわしい注意は `details.more` に。消さない（中身は今までと同じ） |
| 6 | **色だけに頼らない。形と言葉を添える** | WCAG 1.4.1・G111、気象庁（線は太く）、CUDO | 逃げ道：緑の実線＝逃げる場所へ／橙の実線＝高い所へ／灰色の**点線**＝いま水の下。記号 A・B・C（丸）と「高」（四角）。深さは、色の帯＋数字＋人と家の絵 |
| 7 | **やさしい言葉・短い文** | やさしい日本語ガイドライン、GOV.UK（Use clear language） | 「公式想定」→「国の想定」、「地点」→「場所」、「猶予の時間ではありません」→「待ってよい時間ではありません」、「飛沫」→「しぶき」など（一覧は「16」） |
| 8 | **案内は、使う場面で、1つだけ** | NN/g（Coach Marks） | 3Dの初回は「指でなぞると、まわせます」だけ。水が陸に上がった時の説明も、1〜2文に |
| 9 | **命にかかわる注意は、畳まない・消さない** | これまでの別役レビュー（「03」「13」「14」）で入れた注意 | 「安全という意味ではありません」「待ってよい時間ではありません」「通れるとは限りません」「逃げるのは、水が来る前に」「強い揺れ…すぐ高い所へ」は、短くして、見える所に残す |

### 見送ったこと

| 案 | 見送った理由 |
|---|---|
| 「やさしい表示」「シニア向け表示」への切り替え | 切り替えを探すこと自体が負担になる。はじめから全員に読める大きさ・言葉にした |
| ふりがな | 文字の量と行の高さが増える。まず漢語を和語に置きかえ、短くすることを優先した（次の候補） |
| 文字サイズの切り替えボタン | ブラウザの拡大（200%）に任せる。確認は「16」の「確かめていないこと」に書く |
| 3Dの凡例を、地図の上の独立した札にする | スマホ幅で3Dの見える所が減る。操作欄のいちばん上（3Dにいちばん近い行）に置いた |
| 計算の中身・道のりの求め方 | 今回の範囲の外（変えていない） |
