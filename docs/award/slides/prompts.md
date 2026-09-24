# 画像生成プロンプト（実際に送った全文）

- 実行：`codex exec -m gpt-5.6-sol --skip-git-repo-check -s workspace-write -C <scratch>/A5 -i kumamoto/slide-03.png -i kumamoto/slide-06.png < プロンプト`（プロンプトは標準入力。-i は複数値を取るため）
- 参考画像（作風のみ）：`akirapapa-obsidian-1/.agents/skills/rich-3d-business-slides/references/kumamoto/slide-03.png`、`slide-06.png`（全ページ同じ2枚。生成画像を順送りしない）
- 画像生成：Codex 組み込み ImageGen。出力 1672×941px（全ページ同寸、引き伸ばし・トリミングなし）
- 04・10・12 は画面をマゼンタで生成し、`composite.py` で docs/review3 の実画面を合成（QA.md 参照）
- v2（2026-09-25）で 06・08・16・17 を差し替え。版名 v2／v3 が改訂版
- 不採用版を含む全送信文は scratch の `A5/prompts/sent-NN-版.txt`、ログは `A5/logs/`

## スライド01（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 01
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 01 of 18 — role: 作品名・応募部門・性格（仮定の再現）を一目で伝える
Conclusion of this slide: 地点を選ぶと、実際の街で仮定の津波が水として動く作品である。

EXACT Japanese copy to show on the image:
Headline: 津波防災もしも再現
Subtitle: 地点を選ぶと、実際の街で仮定の津波が「水」として動く
Labels:
- PLATEAU AWARD 2026 一般部門 応募作品
- 予測ではありません（仮定の再現です）
Footer: 津波防災もしも再現 / 01

Background explanation (for understanding only, do NOT print this paragraph): 作品の中身を1枚で示す。白い建築模型の港町の一角（岸壁・運河・低層の建物）へ、濁った半透明の水が岸側から道に沿って入り、建物の角で回り込む。地点には1m目盛りの柱と170cmの人影。災害の恐怖ではなく『確かめる道具』の印象にする。

Visual composition: A large pristine white architectural scale model of a Japanese harbor district (quay wall, a narrow canal, low warehouses and small houses, a railway embankment) on a pale stone plinth, viewed from a gentle 3/4 top-down angle. A thin layer of translucent muted grey-green turbid water enters from the quay side and flows along the streets, wrapping around building corners; two slim deep-blue arrows show flow direction. At the center stands a slim measurement pole with 1 m ticks and a small neutral 170 cm human silhouette figure for scale. Calm, precise, no destruction.
Composition notes: 右60%に大きな白い港町模型（正投影寄りの俯瞰）。左に見出し。水は模型の手前側から入り、細い矢印2本で進行方向を示す。柱と人影は模型の中央。
Reading order: 作品名 → 補助文 → 模型の水の流れ → 予測ではありませんの注記
Avoid misunderstanding: 災害映像・破壊・逃げる人は描かない。『予測』と誤読されないよう注記を必ず入れる。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-01-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド02（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 02
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 02 of 18 — role: なぜ既存の表示だけでは足りないかを示す
Conclusion of this slide: ハザードマップの色は最大浸水深の結果で、水がどこからどの順に来るかは読めない。

EXACT Japanese copy to show on the image:
Headline: ハザードマップの色だけでは、水の来方が分からない
Subtitle: 色は「最大でどこまで深くなるか」という結果。来る方向と順番は描かれていない。
Labels:
- 最大浸水深の色分け（結果）
- どこから来る？
- どの道を通る？
- どこで止まる？
- 静的な塗り分けは水量に上限がない（過去の試作では公式想定の約1.5倍に過大）
Footer: 津波防災もしも再現 / 02

Background explanation (for understanding only, do NOT print this paragraph): 住民が見る浸水想定図は、各地点の最大値を色で塗った結果図。自分の家に水がどの方向から来て、どの道・運河を通り、どこで止まるのかは分からない。作者の過去の試作（静的な塗り分け）では水量に上限がなく、公式想定の約1.5倍に過大になった。

Visual composition: Left: a flat square map tile lying on a thin stone plinth, painted with 4 calm depth-color bands (pale yellow, light orange, soft pink, muted purple) like an inundation hazard map, labeled as a result. Right: the same neighborhood as a small white 3D architectural model with no water, and three question labels floating above it connected by thin dotted lines to a street, a canal and an embankment. A thin dashed divider between them.
Composition notes: 左に色分けされた浸水深の地図タイル（平らな板、4段階の落ち着いた色）。右に同じ区画の白い模型を置き、その上に3つの問いのラベルを点線でつなぐ。下部に過去試作の注記を小さく。
Reading order: 見出し → 色の地図 → 3つの問い → 下部注記
Avoid misunderstanding: ハザードマップを否定しない（補完する位置づけ）。1.5倍は作者の過去試作の話で、他者の製品の話ではない。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-02-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド03（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 03
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 03 of 18 — role: 作品が何をするかを3段で示す
Conclusion of this slide: 地点を選ぶと、実地形・実建物の格子の上で仮定の津波を物理計算し、水の動きとして見せる。

EXACT Japanese copy to show on the image:
Headline: 地点を選ぶと、その街で水が動く
Subtitle: 実際の地形と建物の上で、仮定の津波を浅水方程式で計算する。
Labels:
- ① 地図で地点を選ぶ
- ② 実地形・実建物を約2m格子に
- ③ 水がぶつかり、回り込み、止まる
- 建物にぶつかる
- 運河をさかのぼる
- 線路の盛土で止まる
Footer: 津波防災もしも再現 / 03

Background explanation (for understanding only, do NOT print this paragraph): 善進本町（名古屋市港区）の再現では、水は運河をさかのぼり、線路の盛土で止まった。これは色分けの地図では見えない『水の来方』そのもの。

Visual composition: Three stations left to right on separate pale stone plinths, joined by deep-blue arrows: (1) a flat pale map tile with a single location pin; (2) the same city block as a white architectural model with a faint square grid engraved over terrain and buildings; (3) the same model with translucent muted grey-green turbid water flowing: hitting a building face with a little white foam, flowing up a narrow canal, and stopping against a raised railway embankment. Short labels point to these three behaviours.
Composition notes: 左から右へ3段：平らな地図タイルにピン → 同じ区画の白い模型に薄い格子線 → 同じ模型に濁った水が流れ、3か所に短いラベル。段の間に濃紺の矢印。
Reading order: ①→②→③ → ③の中の3つの水の振る舞い
Avoid misunderstanding: 『予測』ではなく仮定条件での再現。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-03-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド04（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 04
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 04 of 18 — role: 実際に動く画面を見せる（審査：UI・実用性）
Conclusion of this slide: 実画面でも、地点選択→建物にぶつかる水→人の目線で測る、が確認できる。

EXACT Japanese copy to show on the image:
Headline: 実際の画面：名古屋市港区 善進本町
Subtitle: 海の高さ5m（仮定）・約2m格子。水は運河をさかのぼり、線路の盛土で止まった。
Labels:
- ① 地点を選ぶ
- ② 建物にぶつかる水
- ③ 人の目線で測る
- 実際の画面（2026-09-24 撮影）
Footer: 津波防災もしも再現 / 04

Background explanation (for understanding only, do NOT print this paragraph): 3枚のパネルに実際のスクリーンショット（docs/review3/01_pick.png、05_t800_impact.png、07_t800_eye.png）を合成する。生成画像に画面を描かせると実在しないUIになるため、画面部分は実画像を無加工で縮小して貼る。

Visual composition: Three identical slim display frames (thin satin-metal bezel, 16:10 aspect ratio, perfectly front-facing, orthographic, NOT in perspective, no tilt) standing on low pale stone bases, evenly spaced across the middle of the slide. Each screen area is a perfectly flat rectangle filled with solid pure magenta #FF00FF, no reflection, no gradient, no text, no UI drawn inside. Small deep-blue arrows between frames. Labels below each frame.
Composition notes: 横に3つの正面向きのディスプレイ枠（16:10）を等間隔に置き、下にラベル。枠の画面は合成用のマゼンタ単色。枠の間に細い矢印。
Reading order: 見出し → ①→②→③ → 撮影注記
Avoid misunderstanding: スクリーンショットは実画面。生成画像で画面を描かない。

IMPORTANT for screen areas: every screen must be an exact flat axis-aligned rectangle filled with solid pure magenta #FF00FF (real screenshots will be pasted in later). Do not draw any UI, map or picture inside the screens, and use magenta nowhere else on the slide.

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-04-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド05（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 05
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 05 of 18 — role: データから描画までの全体構造
Conclusion of this slide: 公開データから計算範囲をその場で組み立て、GPUで水を計算して描く。

EXACT Japanese copy to show on the image:
Headline: データ → 格子 → GPU物理 → 描画
Subtitle: 公開データだけで、選んだ地点の計算範囲をその場で組み立てる。
Labels:
- データ：標高（地理院5m・10m）／建物（PLATEAU LOD1）／航空写真／津波高（内閣府2025）
- 格子：約2m・768²／建物＝反射壁
- GPU物理：非線形浅水方程式
- 描画：屈折・泡・濁り・飛沫
Footer: 津波防災もしも再現 / 05

Background explanation (for understanding only, do NOT print this paragraph): 地形は国土地理院のDEM（5m＋10m）、建物はPLATEAU LOD1の実測高さを優先、航空写真は地面と屋根、津波の高さは内閣府2025の市区町村別の海岸最大津波高。格子は既定768²（1.5km四方でdx≈2m）。GPUで非線形浅水方程式を解き、屈折・泡・濁り・飛沫で描画する。

Visual composition: A left-to-right pipeline of four stations on pale plinths joined by deep-blue arrows: (1) four thin stacked translucent data sheets (elevation relief, building footprints, aerial photo, a small table of tsunami heights); (2) a square stone slab with a fine engraved grid where small white building blocks stand as walls; (3) a frosted-glass compute block containing the same grid with a thin sheet of water flowing across cells; (4) a white city model with translucent turbid water, subtle foam at building faces.
Composition notes: 左から右へ4つの層：積み重ねたデータ板（4枚） → 格子の石板（建物が壁として立つ） → 半透明のGPU計算ブロック（格子上を水が流れる） → 水が流れる白い街の模型。上から段の名前、下に中身ラベル。
Reading order: 4段を左→右
Avoid misunderstanding: データの出典を正しく。PLATEAUは建物、地形は地理院。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-05-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド06（採用：版v3）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 06
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 06 of 18 — role: 審査①3D都市モデルの活用：公式データの中身と使い方を正確に示す
Conclusion of this slide: PLATEAU公式・名古屋市2022年度の258,234棟の属性で、建物ごとに『水がぶつかる壁・流される・上がれる』を決めている。

EXACT Japanese copy to show on the image:
Headline: PLATEAUの属性で、建物ごとに役割を決める
Subtitle: 名古屋市2022年度のCityGMLから、5区（中村・熱田・中川・港・南）の258,234棟を変換。
Labels:
- 実測高さ 91%
- 地上階数 90%
- 用途 89%
- 建物区分（堅ろう・普通）84%
- ① 実測高さ → 水がぶつかる壁
- ② 普通建物（木造と推定）→ 浸水深2m以上で流失（首藤1993）
- ③ 堅ろうで、高さが水位＋2m以上 → 垂直避難の候補（橙）
- ④ 指定緊急避難場所（津波・国土地理院）902棟 → 緑
- 避難先として指定されているかは、自治体の情報で確認
- 名古屋のデータに、構造種別と建物ごとの津波浸水想定はない
Footer: 津波防災もしも再現 / 06

Background explanation (for understanding only, do NOT print this paragraph): PLATEAU公式の名古屋市2022年度CityGML（標準製品仕様書4.1）から5区258,234棟を変換。充足率は実測高さ91.0%、地上階数89.5%、用途89.4%、建物区分84.1%。構造種別と建物の津波リスク属性は名古屋のデータに1件もないため、木造は建物区分『普通』から推定する。浸水深2m以上（首藤1993、木造家屋の全面破壊）で流失させる。堅ろう建物で高さが水位＋2m以上を垂直避難の候補として橙で示し、国土地理院の指定緊急避難場所（津波）を建物に結合した902棟は緑で示す。

Visual composition: Top row under the subtitle: four small frosted-glass tags in a line (the fill rates). Center: one wide pale stone grid slab with a thin sheet of translucent grey-green turbid water across it, and four white building models standing left to right with clear spacing: (1) a mid-rise block whose side is hit by the water with a little foam; (2) a small low house model shifted slightly downstream with a short deep-blue arrow (clean, no rubble, no destruction); (3) a tall solid building whose roof is tinted soft orange (#E8923A), with a thin vertical dimension bracket from the water surface up to the roof marked +2m; (4) a building whose roof is tinted soft green (#4E9A5B). Numbered labels (1)-(4) below each model. Bottom: two short note lines in smaller text. Orange and green appear ONLY on those two roofs.
Composition notes: 上段に4つの充足率を小さな透明タグで横一列。中央に格子の石板、その上に4種類の白い建物模型を左から右へ：①実測高さの建物に水が当たる／②低い普通建物が浅く傾いて流れる（短い矢印、がれきなし）／③高い堅ろう建物の屋上が橙、水面から＋2mの寸法線／④緑の屋上の建物。各建物の下に番号ラベル。下部に注記2行（確認のお願いと、データにない属性）。
Reading order: 見出し → 充足率 → ①→④ → 下部注記
Avoid misunderstanding: 構造は推定であること、緑は指定場所の結合であり『安全』ではないこと、建物ごとの津波想定はデータにないことを必ず書く。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-06-v3.png
Then confirm the file exists and print its pixel size. Do not modify any other files.

Correction notes from the previous attempt (apply strictly):
- The fill-rate tags must read exactly: 「実測高さ 91%」「地上階数 90%」「用途 89%」「建物区分（堅ろう・普通）84%」. There is NO middle dot between 用途 and 89%.
- On building (3), the thin vertical dimension bracket must start exactly at the water surface and end at the roof edge, with a small label 「+2m」 next to it (this label is allowed).
```

## スライド07（採用：版b）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 07
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 07 of 18 — role: 審査④技術力：解の分かる問題での検証
Conclusion of this slide: 解が分かる3問題で計算を確かめ、変更のたびに合格を確認している。

EXACT Japanese copy to show on the image:
Headline: 答えが分かる3つの問題で、計算を確かめる
Subtitle: 変更のたびに同じ3本を回し、合格を確認している（/test.html）。
Labels:
- ① 静止湖
- 流速 3e-5・質量誤差 5.5e-10
- 静かな水は、静かなまま
- ② ダム崩壊
- 中央の水深 0.883（理論 0.889）
- ③ 海浜の水位上げ
- 汀線 3.19m（入力 3m）
Footer: 津波防災もしも再現 / 07

Background explanation (for understanding only, do NOT print this paragraph): 静止湖：でこぼこの底でも静かな水面が動かないか（流速3e-5、質量誤差5.5e-10）。ダム崩壊：理論解のある問題で中央水深0.883（理論0.889）。海浜の水位上げ：3mの入力で汀線3.19m。3本とも改善2周目・防潮壁追加・ネスト追加後も合格。

Visual composition: Three identical clear glass test tanks on pale stone bases in a row. Tank 1: an uneven bumpy bed with a perfectly flat, still water surface. Tank 2: the central gate has been lifted completely out of the water and floats above the tank (there is NO plate left inside the water); a step of water spreading into a smooth rarefaction wave. Tank 3: a sloping beach inside the tank with water rising up the slope, a thin line marking the shoreline. Water is clear pale blue-grey here (lab tanks). Labels under each tank.
Composition notes: 3つのガラス水槽を石の台に横並び。①底に凸凹のある水槽に平らな水面。②中央の仕切りが外れ、段差の水が広がる水槽。③斜面の浜がある水槽で水位が上がる。各水槽の下に数値ラベル。
Reading order: 左→右に3本、各々 名前→数値
Avoid misunderstanding: 資料に単位の記載がない値（流速3e-5、ダム崩壊の0.883）には単位を付けない。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-07-b.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド08（採用：版v2）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 08
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 08 of 18 — role: 審査⑤実用性・誠実さ：公式との差を条件つきで隠さない
Conclusion of this slide: 公式想定と並べ、条件と差の理由（未検証）を明記する。

EXACT Japanese copy to show on the image:
Headline: 公式想定と並べ、差を隠さない
Subtitle: 公式は内閣府2025 ケース01の100m集約。結果画面では周辺100m四方の最大も並べる。
Labels:
- 名古屋港 港町
- この再現（ここの最大）1.65m
- 公式想定（100m集約）1.27m
- 防潮壁・潮位を入れる前 2.07m
- 条件：流失なし。流失ありでは ここの最大1.74m・周辺100m四方2.27m・流失938棟
- 善進本町：地点には届かず（公式も浸水セルなし）
- 名古屋駅：駅には届かず（公式も浸水セルなし）
- 差の主な理由（未検証）：防潮壁を岸の線に置く近似・一様な長波の入力
Footer: 津波防災もしも再現 / 08

Background explanation (for understanding only, do NOT print this paragraph): docs/04の名古屋港 港町（海の高さ5m・格子768²・潮位T.P.+1.2m・防潮壁T.P.+4.6m）で、ここの最大は1.65m（流失なし）、公式の100m集約は1.27m。防潮壁と潮位を入れる前は2.07m。木造の流失を入れた条件では、ここの最大1.74m・周辺100m四方の最大2.27m・流失938棟。善進本町と名古屋駅は再現でも公式でも浸水なし。

Visual composition: Left: two tall clear glass gauge cylinders side by side on a stone base with fine metre ticks from 0 to 2.5 m; the left one filled with deep-blue translucent water up to exactly the 1.65 m tick, the right one with amber-tinted translucent fill up to exactly the 1.27 m tick; above the left one a dashed outline ghost level at 2.07 m with a neutral grey (#6B7585) label tag. Under the gauges one condition note line. Right: two small frosted-glass plates each with a small building-block model and a check mark. Bottom: one line of note text.
Composition notes: 左：2本の縦の透明ゲージ（0〜2.5m目盛り）。青の水柱1.65m、琥珀の水柱1.27m、青の上に点線で2.07m（灰色の札）。ゲージの下に条件の注記を1行。右：2つの一致カード。最下部に差の理由。
Reading order: 見出し → 名古屋港の3本 → 条件の注記 → 右の一致2件 → 理由
Avoid misunderstanding: 『公式より正しい』とは言わない。1.65mは『ここの最大』で100m集約とは物差しが違うことを札で明示。流失ありの値を条件つきで併記。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-08-v2.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド09（採用：版b）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 09
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 09 of 18 — role: 物理条件を公式想定に合わせた工夫（代表ページ）
Conclusion of this slide: 満潮位から始め、防潮壁は越流したら壊れる。公式想定と同じ条件で時間経過を追える。

EXACT Japanese copy to show on the image:
Headline: 満潮位から始め、防潮壁は越えたら壊れる
Subtitle: 公式想定と同じ条件：名古屋港 T.P.+1.2m、防潮壁の天端 T.P.+4.6m、越流したら破堤。
Labels:
- 約7分：岸の水位 2.9m／壊れた壁 0／3,923セル
- 約12分：岸の水位 4.4m／壊れた壁 214セル
- 約23分：岸の水位 5.2m／壊れた壁 3,870セル／陸の浸水 0.95km²
- 海
- 防潮壁
- 街
Footer: 津波防災もしも再現 / 09

Background explanation (for understanding only, do NOT print this paragraph): 名古屋港の朔望平均満潮位T.P.+1.20m（名古屋港管理組合・愛知県）から計算を始める。防潮壁は地理院の『堤防等に接する』線に置き、天端は公表範囲の低い方T.P.+4.6m。内閣府・愛知県の想定と同じく越流したら破堤。港町では約23分で3,923セル中3,870セルが壊れ、陸の浸水0.95km²。

Visual composition: Three identical cross-section blocks (like clean architectural section cuts) placed left to right on pale stone bases, joined by deep-blue arrows. Each section shows from left to right: sea water, a vertical concrete seawall, then low white buildings on land. Block 1: sea level well below the wall top. Block 2: sea level just reaching the wall top with a thin overtopping sheet and one small clean gap in the wall (no rubble). Block 3: several wall segments are missing as clean gaps where the wall has dropped down to ground level (no rubble, no debris, no crumbling concrete), translucent turbid water flowing onto land around the buildings. A thin horizontal dashed line on each marks the wall crest. Time and numbers under each block.
Composition notes: 同じ断面模型（海｜防潮壁｜街）を3つ左→右に並べ、時間ごとに海側の水位が上がり、3つ目では壁の一部が欠けて水が街に入る。各断面の下に時刻と数値。
Reading order: 見出し → 条件 → 7分→12分→23分
Avoid misunderstanding: 壁の位置は岸線で近似（限界で明記）。数値は港町・海の高さ5m・格子768²の一例。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-09-b.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド10（採用：版c）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 10
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 10 of 18 — role: 海から遠い地点（名古屋駅）も扱える
Conclusion of this slide: 広域と詳細の二段計算で、海から遠い地点にも水がどう来るかを見られる。

EXACT Japanese copy to show on the image:
Headline: 海から遠い名古屋駅も、二段の計算で見る
Subtitle: 広域が海から街への広がりを、詳細が建物の間の流れを計算する。
Labels:
- 広域：14km四方・約14m格子・建物は粗度で表す
- 詳細：1.5km四方・約2m格子・建物は壁
- 縁の70mで、広域の水位と流速を受け取る
- 約50分後：水の先端は駅の約6.0km手前（公式でも駅は浸水セルなし）
- 実際の画面（広域の視点）
Footer: 津波防災もしも再現 / 10

Background explanation (for understanding only, do NOT print this paragraph): 名古屋駅は海から遠く1段計算（最大4km四方）では海が入らない。広域（名古屋駅で14km四方、1024²、約14m格子、建物は粗度n=0.045〜0.09）で海→港→運河→市街地の広がりを計算し、地点の周り1.5km四方（768²、約2m、建物は壁）が縁70mの帯で広域の水位と流速を受け取る。

Visual composition: Left 55%: a large thin pale stone slab representing a wide area (sea at the bottom edge in muted blue-grey, a coastline, a port) with a smaller raised square block near the upper middle containing dense small white buildings (the station area); an amber thin band outlines the edge of the small block. Translucent turbid water covers only low land right next to the port and canals, clearly far away from the raised block; there are NO arrows anywhere on the left model (no curved arrow, no flow arrow) and the water must NOT reach the block. One small thin dashed amber line connects the edge band to its label. Right 40%: one slim display frame (thin satin bezel, 16:10, perfectly front-facing, orthographic, no tilt) on a low stone base whose screen is a perfectly flat rectangle filled with solid pure magenta #FF00FF, no reflection, no gradient, nothing drawn inside.
Composition notes: 左：大きな薄い石板（広域）の中央に、一段高い小さな詳細ブロック（白い建物が密に立つ）。周縁の帯を琥珀の細線で示し、広域から詳細への矢印。右：正面向きの画面枠に実画面（マゼンタで合成）。
Reading order: 見出し → 左の広域→詳細 → 右の実画面と数値
Avoid misunderstanding: 『駅は安全』とは書かない。計算時間と入力の仮定の範囲の結果。

IMPORTANT for screen areas: every screen must be an exact flat axis-aligned rectangle filled with solid pure magenta #FF00FF (real screenshots will be pasted in later). Do not draw any UI, map or picture inside the screens, and use magenta nowhere else on the slide.

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-10-c.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド11（採用：版b）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 11
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 11 of 18 — role: 審査③UI・UXデザイン：誤読を防ぐ設計
Conclusion of this slide: 数字を自分の体の高さで読めるようにし、用語を2つに固定し、『予測』『安全』とは書かない。

EXACT Japanese copy to show on the image:
Headline: 深さを、自分の体の高さで読めるようにする
Subtitle: 用語は2つに固定し、「予測」「安全」とは書かない。
Labels:
- 海の高さ＝海岸での津波の高さ（標高基準）
- ここの深さ＝地面からの浸水深
- 1m目盛りの柱と170cmの人影
- 3m 2階の床
- 2m 木造家屋が全面破壊（首藤1993）
- 1m 死者率が急上昇
- 0.3m 避難行動が困難（内閣府）
- 強い揺れを感じたら、この結果を待たずに高い所へ。
Footer: 津波防災もしも再現 / 11

Background explanation (for understanding only, do NOT print this paragraph): 地点に1m刻みの目盛り柱と170cmの人影、2階の床（3m）の線を立てる。閾値は出典が明確な3本だけ。海の高さ（海岸の津波高・標高基準）とここの深さ（地面からの浸水深）を別の標柱・色で示す。時計は『押し波の開始から』で、公式の到達時刻（地震から）と基準が違うことを明記する。

Visual composition: Center: a tall slim white measurement pole with clear 1 m tick marks from 0 to 4 m standing on a small patch of pale ground, next to a neutral matte grey human figure (simple, no face details) standing on the same ground as the pole's 0 mark. SCALE IS CRITICAL: the figure is exactly 1.7 m tall, so the top of its head is clearly BELOW the 2 m tick and above the 1 m tick (head at 1.7 m on the pole). Three thin horizontal lines cross the pole at 0.3 m, 1 m, 2 m with small labels on the right, and a separate dashed line at 3 m labelled second floor. A translucent pale blue band floats at one height on the left side labelled sea height; a short dark bracket from ground to water labelled depth here. Bottom: one calm full-width band with the final sentence. No red, no warning signs.
Composition notes: 中央に大きな目盛り柱と人影（白いマットな模型）、柱の横に3本の閾値の横線（0.3/1/2m）と3mの2階の床線。左に2つの用語札（青＝海の高さ、濃灰＝ここの深さ）。下部に避難の一言を落ち着いた帯で。
Reading order: 見出し → 柱と人影 → 閾値 → 用語 → 最後の一言
Avoid misunderstanding: 閾値を危険度ランクとして見せない。赤い警告色は使わない。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-11-b.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド12（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 12
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 12 of 18 — role: 画面の流れとスマホ対応
Conclusion of this slide: 選ぶ→見る→測る→比べるを一本道でつなぎ、スマホでも同じ流れで使える。

EXACT Japanese copy to show on the image:
Headline: 選ぶ → 見る → 測る → 比べる
Subtitle: 4つの画面を一本道でつなぎ、スマホでも同じ流れで使える。
Labels:
- 深さで色分け＝この再現／斜線＝公式想定
- HUD：いまの深さ・最大・流速・水の先端まで
- 視点：俯瞰・地点・目線・衝突・広域
- スマホ：短辺700px未満は格子512で開始
- 動きを減らす設定・WebGPU非対応の案内
Footer: 津波防災もしも再現 / 12

Background explanation (for understanding only, do NOT print this paragraph): 地点選択（住所検索とプリセット2群）→読み込み→再現（HUD、視点、倍速）→結果の比較（公式と同じ物差し）。深さで色分けし、公式想定は斜線で重ねる。スマホ幅では格子512を初期値に。reduced motionでは自動再生と視点の補間を止め、WebGPU非対応では明示して案内する。

Visual composition: A thin row of four numbered steps along the top under the subtitle. Below: left, one slim display frame (16:10 aspect, thin satin-metal bezel, perfectly front-facing, orthographic, no tilt) on a low stone base; right, one slim smartphone frame in portrait orientation (aspect about 9:19.5, perfectly front-facing, no tilt) on a small stone stand. Both screens are perfectly flat rectangles filled with solid pure magenta #FF00FF, no reflection, no gradient, nothing drawn inside. Short labels beside them.
Composition notes: 左に横長の画面枠（16:10）、右に縦長のスマホ枠（約9:19.5）、いずれも正面向きで画面はマゼンタ（実画面を合成）。上に4段の流れを小さな番号付きの帯で。下にラベル。
Reading order: 見出し → 4段の流れ → 2つの実画面 → 補足ラベル
Avoid misunderstanding: 実画面は合成。UIを生成で描かない。

IMPORTANT for screen areas: every screen must be an exact flat axis-aligned rectangle filled with solid pure magenta #FF00FF (real screenshots will be pasted in later). Do not draw any UI, map or picture inside the screens, and use magenta nowhere else on the slide.

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-12-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド13（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 13
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 13 of 18 — role: 審査④技術力：WebGPU/TSLと性能の工夫
Conclusion of this slide: ブラウザだけで2m格子の非線形浅水方程式をGPUで解き、読み戻しを最小にして軽く動かす。

EXACT Japanese copy to show on the image:
Headline: ブラウザだけで、2m格子の流体をGPUで解く
Subtitle: three.js WebGPURenderer と TSL の compute。1段を1回のディスパッチで計算する。
Labels:
- 非線形浅水方程式：MUSCL-minmod＋Audusse＋HLL＋SSP-RK2
- 状態はf32・2バッファで交互
- dtは固定（速度上限15m/sから決める）
- CPUへの読み戻しは地点の1セルだけ
- 飛沫粒子 2^17個もGPUで
- fpsに応じて画素比と計算量を自動調整
Footer: 津波防災もしも再現 / 13

Background explanation (for understanding only, do NOT print this paragraph): 状態はf32のinstancedArray（fp16では1mmの乾湿判定が壊れる）。1サブステップ＝1ディスパッチ。dtは速度上限と最大水深から固定で決め、GPU上の最大値集計を省く。CPUへはピンの1セル（16バイト）を4フレームに1回だけ非同期で読む。fps<40で画素比、fps<28でサブステップを下げる。

Visual composition: Center: an exploded stack of three thin square slabs floating above each other: top a frosted-glass grid slab labelled state A, middle a slab with tiny arrows on every cell edge (flux computation), bottom a grid slab labelled state B; curved deep-blue arrows loop from B back to A to show ping-pong buffers. At one corner, a single highlighted amber cell lifted out with a thin line to the side (the only read-back to CPU). A faint sheet of water texture across the top slab. Labels around it on both sides.
Composition notes: 中央に格子の石板を分解図で3層（状態A／流束の計算／状態B）重ね、層の間を細い矢印が往復。右側に小さな読み戻しの1セルを琥珀で強調。周りに短いラベル。
Reading order: 見出し → 中央の2バッファ → ラベル（左上→右下）
Avoid misunderstanding: fpsの実測値は資料にないので書かない。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-13-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド14（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 14
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 14 of 18 — role: 天才4人会議と改善2周
Conclusion of this slide: Claude Opus 5.5が4つの専門視点を担い、実画面で指摘→修正を重ねて作った。

EXACT Japanese copy to show on the image:
Headline: 4つの専門視点の会議と、改善2周で作った
Subtitle: Claude Opus 5.5 が4人の専門家を演じ、実画面で指摘→修正を繰り返した。
Labels:
- 汐見 凪：物理
- セーブル・オコンクォ：見た目
- 九条 刃：GPU
- 日向 灯：わかりやすさ
- 会議（決定10項目）
- 改善1周目
- 改善2周目
- 満潮位・防潮壁
- 内陸のネスト計算
- 陸に42mまで積み上がる → 造波を修正
- 2回目の地点が真っ黒 → 破棄の順を修正
- 「逃げる時間はあります」を削除
Footer: 津波防災もしも再現 / 14

Background explanation (for understanding only, do NOT print this paragraph): 会議で決定D1〜D10を出し、実画面のスクリーンショットを証拠に2周改善した。例：入力15mで陸が42mまで積み上がる（高知）→造波をリーマン不変量方式へ。2回目に選んだ地点が真っ黒→共有ジオメトリを破棄していた不具合を修正。決め打ちの『逃げる時間はあります』を削除し、公式の到達時刻から文を作る。

Visual composition: Left: four small round stone pedestals arranged in a small circle like a round table, each holding a small symbolic object instead of a person: a wave cross-section (physics), a cluster of foam spheres (look), a small GPU chip (GPU), a measurement pole (clarity). Right: a clean timeline rail receding gently in depth with five small stations. Under the rail, three small frosted cards showing before → after fixes. No faces, no robots.
Composition notes: 左に4つの小さな円形の台（人物ではなく各専門を表す物：波の断面、泡の粒、GPUチップ、目盛り柱）を円卓状に。右へ奥行き方向の時系列レール（5段）。レールの下に3つの修正例カード。
Reading order: 見出し → 4視点 → 5段の時系列 → 修正例
Avoid misunderstanding: 4人は実在の人物ではなくAIが演じる専門視点（補助文で明示）。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-14-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド15（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 15
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 15 of 18 — role: MIT公開とデータ規約、使われ方の想定
Conclusion of this slide: コードはMITで公開し、データは各提供元の規約に従う。学習・説明の場で使える形を想定する。

EXACT Japanese copy to show on the image:
Headline: MITで公開し、だれでも使い、直せるようにする
Subtitle: コードはMIT。データは各提供元の規約に従い、出典を表示する。
Labels:
- 公開ページ share.akirafunakoshi.com/tsunami-simulation/
- GitHub github.com/Akira-Papa/tsunami-bousai-moshimo-saigen
- コード：MIT License
- データ：内閣府・国土地理院・国土数値情報・PLATEAU の各規約
- 地点と条件をURLで共有できる
- 想定する使い方（構想）：地域や学校の防災学習／ハザードマップと並べて見る
Footer: 津波防災もしも再現 / 15

Background explanation (for understanding only, do NOT print this paragraph): ソースコードと文章はMIT。同梱・取得データ（内閣府の津波高・浸水メッシュ集約、国土数値情報、国土地理院、PLATEAU）は各規約に従い出典を表示。URLパラメータで地点・潮位・防潮壁の条件を共有して同じ再現を開ける。使い方は構想段階として示す。

Visual composition: Left: a clear two-tier acrylic box on a stone base: the upper tier holds a neat stack of code sheets (MIT), the lower tier holds several data cards (terrain, buildings, tsunami table) each with a small source tag. Right: two wide flat frosted-glass cards stacked vertically for the URLs (text large and exact), and below them a dashed-outline band for the concept line.
Composition notes: 左：2層に分かれた透明な箱（上：コード＝MIT、下：データ＝各規約）。右：公開ページとGitHubの2枚のURLカード、その下に構想の帯（点線枠）。
Reading order: 見出し → ライセンスの2層 → URL → 構想
Avoid misunderstanding: 社会実装の導入実績はまだない。『構想』と明記。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-15-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド16（採用：版v3）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 16
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 16 of 18 — role: 実装済み→次→構想を区別して示す
Conclusion of this slide: PLATEAU属性を使う3機能は実装済み。次は構造や津波浸水想定を持つ都市へ広げる。

EXACT Japanese copy to show on the image:
Headline: ここまで実装し、次は属性の多い都市へ広げる
Subtitle: PLATEAUの属性を使う3つの機能は実装済み。確認できた値を、地域ごとに増やしていく。
Labels:
- 実装済み
- 木造の流失
- 垂直避難の候補・指定緊急避難場所
- 建物位置での公式想定（100m集約値。建物ごとの公式値ではない）
- 名古屋港（流失あり）：ここの最大1.74m・周辺100m四方2.27m・流失938棟
- 次
- 構造や津波浸水想定を持つ都市への展開（例：徳島市2023年度）
- 防潮壁の実際のライン・河口堤防の天端・各地の満潮位
- 将来（構想）
- 実際の海底地形
Footer: 津波防災もしも再現 / 16

Background explanation (for understanding only, do NOT print this paragraph): A2で木造の流失（普通建物を木造と推定、浸水深2m以上）、垂直避難の候補（堅ろう・高さが水位＋2m以上、橙）と指定緊急避難場所902棟（緑）、建物位置での公式想定（内閣府100m集約値を建物の中心で引く）を実装済み。名古屋のPLATEAUには構造種別と津波浸水想定がないため、次はそれらを持つ都市（例：徳島市2023年度）へ広げる。防潮壁の実ライン・河口堤防天端・各地の満潮位は一次情報で確認してから入れる。海底地形の実測化は構想。

Visual composition: Three wide stone terraces rising gently from front to back like steps. Front terrace (implemented, solid deep-blue tags): a small low white house model shifted slightly downstream in shallow turbid water with a short arrow (clean, no rubble); a tall white building with a soft orange (#E8923A) roof next to a building with a soft green (#4E9A5B) roof; a white building beside a small glass gauge. One line of result numbers along the front edge of this terrace. Middle terrace (next): a set of small white city block tiles with tiny attribute tags floating above them, and a thin seawall line along a quay with a river-mouth levee. Back terrace (future concept, dashed outlines): one seabed contour relief tile. No red.
Composition notes: 奥行き方向に3段の台（手前＝実装済み・青い札、中＝次、奥＝構想・点線）。手前に3つの具体物：少しずれた低い家と短い矢印／屋上が橙の高い建物と緑の屋上の建物／建物の横に小さな比較ゲージ。手前の台の前縁に名古屋港の数値1行。中段に市街地の模型タイル（属性タグ付き）と岸壁の壁の線。奥に海底の等深線タイル。
Reading order: 手前→奥
Avoid misunderstanding: 構想を確約として書かない。建物位置の比較は100m集約値であり建物ごとの公式値ではない。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-16-v3.png
Then confirm the file exists and print its pixel size. Do not modify any other files.

Correction notes from the previous attempt (apply strictly):
- On the middle terrace, the small floating attribute tags must only show simple generic icons: stacked layers, a building outline, a wave, and an up-down arrow. Do NOT draw any torii gate, shrine, temple, flag or landmark icon.
```

## スライド17（採用：版v2）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 17
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 17 of 18 — role: できないことを先に明示する
Conclusion of this slide: 仮定の再現であり予測ではない。含まない要素・推定・未確認値を明示する。

EXACT Japanese copy to show on the image:
Headline: できないことを、先に書いておく
Subtitle: 仮定の再現であり、予測ではない。避難の判断は、自治体のハザードマップと公式想定で。
Labels:
- 防潮壁は岸の線で近似（沖の高潮防波堤は含まない）
- 名古屋港以外は防潮壁の高さ・満潮位が未確認
- 海底の地形は合成
- 漂流物・地盤沈下は含まない。建物の破壊は木造の流失だけ（木造は建物区分から推定）
- 公式との差の理由は未検証（富田町は約88分で未到達、公式2.6m）
Footer: 津波防災もしも再現 / 17

Background explanation (for understanding only, do NOT print this paragraph): READMEの限界に、木造流失の実装に伴う前提（構造は建物区分『普通』からの推定、破壊は流失だけ）を反映。富田町（中川区）は約88分時点で未到達だが、公式の100m集約は2.6m。理由は未検証。

Visual composition: Left 55%: a white architectural model of a coastal block on a stone plinth; elements NOT included in the simulation are drawn as faint dashed wireframe ghosts: an offshore breakwater in the sea, the seabed under the water, a few floating debris pieces; the seawall along the quay is shown simplified as a straight line. Right 40%: a clean vertical list of five items with small thin dash markers. Calm, honest tone.
Composition notes: 白い街の模型の中で、含まれていない要素（沖の防波堤・海底・漂流物）を点線のゴースト（ワイヤーフレーム）で描き、ラベルを添える。右側に5項目の縦リスト。
Reading order: 見出し → 模型のゴースト → リスト
Avoid misunderstanding: 限界を小さく書かない。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-17-v2.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```

## スライド18（採用：版a）

```text
Create exactly ONE premium Japanese business visual-abstract presentation slide as an image, not a cinematic illustration or advertisement.
Canvas: 16:9 landscape (target about 1672x941 px).
Use the attached reference images for STYLE ONLY: spacious light background, restrained matte 3D, large concrete explanatory objects, readable flat Japanese typography. Do NOT copy their text, game objects, people, swords or claims. Create the new subject described below.
Series style (keep identical on every slide):
- Background flat quiet pale #EEF1F5. Main text #202733. Primary color deep sea blue #2B5C8A (subtitle, arrows, implemented tags). Accent amber #C58A39 (official values, cautions, work-in-progress tags). Thin guide lines #BCC8DC. At most these two strong colors.
- Materials: matte white ceramic / pale stone architectural scale models, restrained satin metal, frosted glass only where transparency explains something. Water on land is translucent muted grey-green / light brown turbid water (never bright cyan, never tropical blue).
- Light: large soft area light from upper left, soft contact shadows, gentle orthographic-leaning 3/4 top-down view. No depth of field, no strong perspective.
- Layout: headline top-left (about 60px bold, #202733), subtitle under it (about 30px, #2B5C8A), large central diagram occupying about 60% of the area, labels about 26-28px, notes at least 20px. Outer margin about 96px, generous empty space (~25%).
- Footer bottom-right small text exactly: 津波防災もしも再現 / 18
- Japanese text must be horizontal, flat 2D, crisp and correctly spelled, placed in open space next to objects, never pasted on slanted 3D surfaces. Show the exact copy below and nothing else as text. No invented numbers, no logos.
- Tone: calm disaster-prevention study tool. NO disaster drama, NO destroyed buildings, NO people in danger, NO giant cinematic wave, NO red alarm colors, NO warning triangles, NO nightscape, NO futuristic city, NO glowing highways, NO decorative gold luxury, NO toy plastic, NO robots.

Slide 18 of 18 — role: 持ち帰りと行動、URL
Conclusion of this slide: 自分の街で水の来方を一度見ておく道具。予測ではない。

EXACT Japanese copy to show on the image:
Headline: 自分の街で、水の来方を一度見ておく
Subtitle: 津波防災もしも再現 ─ 予測ではありません。強い揺れを感じたら、この結果を待たずに高い所へ。
Labels:
- ① PLATEAUの建物に、水がぶつかる
- ② 公式想定と同じ物差しで比べる
- ③ 用語と人の高さで読める
- share.akirafunakoshi.com/tsunami-simulation/
- github.com/Akira-Papa/tsunami-bousai-moshimo-saigen（MIT）
Footer: 津波防災もしも再現 / 18

Background explanation (for understanding only, do NOT print this paragraph): 3つの要点（3D都市モデルでの物理再現、公式との比較、わかりやすさ）と、公開URL・GitHub。最後は避難の一言で締める。

Visual composition: Left: the same white harbor district architectural model as on the cover but calm, with only a thin still sheet of water in the canal, the measurement pole and the 170 cm figure at the center. Right: three numbered takeaways stacked vertically. Bottom: two URL lines in large exact text on a flat frosted strip.
Composition notes: 表紙と対になる構図：左に白い港町模型（水が引いた後の静かな状態、目盛り柱と人影）、右に3つの要点を番号付きで。下部にURLの2行を大きめ・正確に。
Reading order: 見出し → 3要点 → URL → 補助文の一言
Avoid misunderstanding: URLは正確に。

Generate the image with your native image generation tool (no HTML, no SVG, no code drawing, no PIL drawing). After generation, copy the generated PNG to this exact absolute path: /private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A5/gen/slide-18-a.png
Then confirm the file exists and print its pixel size. Do not modify any other files.
```
