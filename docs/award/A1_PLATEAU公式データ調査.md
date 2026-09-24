# A1｜PLATEAU公式データの調査と、名古屋の建物データの作成

- 調査日：2026-09-24（JST）
- 担当：A1（PLATEAU公式データの取得パイプライン）
- 書き込み先：`scripts/plateau/`、`public/plateau/`、`docs/award/A1_*.md`
- 表記：**確認済み**＝実データ・一次情報で確かめた事実／**推測**＝確かめていない見立て／**未確認**＝今回は確かめていない

---

## 1. 結論（先に）

| 欲しかった属性 | 名古屋市のPLATEAU公式データにあるか | 出力での扱い |
|---|---|---|
| 実測高さ `bldg:measuredHeight` | **ある**（確認済み） | `h`（充足率 91.0%） |
| 地上階数 `bldg:storeysAboveGround` | **ある**（確認済み） | `s`（89.5%） |
| 用途 `bldg:usage` | **ある**（確認済み） | `u`（89.4%、日本語名） |
| 構造種別 `uro:buildingStructureType` 等 | **ない**（確認済み） | `st` は全件 `null` |
| 津波浸水想定 `uro:BuildingTsunamiRiskAttribute` | **ない**（確認済み） | `td` は全件 `null` |
| 避難施設・津波避難ビル | PLATEAUには**ない**（確認済み） | 国土地理院「指定緊急避難場所（津波）」を建物に空間結合して `evac` |
| （代わりに使える）建物区分 `bldg:class` | **ある**（確認済み） | 拡張 `sc`（84.1%） |
| （代わりに使える）洪水浸水想定 `uro:RiverFloodingRiskAttribute` | **ある**（確認済み） | 拡張 `fd`（73.6%） |

- 名古屋市のPLATEAUは **2020年度** と **2022年度** の2版だけで、最新は **2022年度（標準製品仕様書 第4.1版、2025-03-21 に v4 データ追加）**。2023年度以降の名古屋市の版はデータカタログAPIにもG空間情報センターにも無い（確認済み、2026-09-24 時点）。
- 2022年度の「災害リスク」は **洪水浸水想定区域（庄内川・矢田川・木曽川、国管理）** と **土砂災害** だけ。**津波浸水想定（tnm）モデルも、建物の津波リスク属性も整備されていない**。
- 構造種別は、2022年度の名古屋市の建物に `uro:buildingStructureType` も、拡張属性の「構造」（`uro:KeyValuePairAttribute` の key=10）も**1件も入っていない**。使われている拡張属性は key=106「高さ根拠」だけ。
- 対象5区（中村・熱田・中川・港・南）で **258,234棟** を `public/plateau/` に出力した（561タイル、76.5MB、gzip 12.3MB）。

---

## 2. 入手経路（URL・形式・サイズ）

### 2.1 データカタログAPI（最新年度・メッシュ別URLの取得元）
- `https://api.plateauview.mlit.go.jp/datacatalog/citygml/23100`（確認済み）
  - 返り値：`cities[0]` = 名古屋市、`year: 2022`、`registrationYear: 2024`、`spec: "4.1"`
  - CityGML一式ZIP：`https://assets.cms.plateau.reearth.io/assets/79/e43a02-06b6-40c2-ae97-51eba1b4297b/23100_nagoya-shi_city_2022_citygml_4_op.zip`（**2,776,827,480 B ≒ 2.8GB**、HTTP Range 対応）
  - `files.bldg`：第3次メッシュ（約1km）ごとの GML 376 件。例 `…/23100_nagoya-shi_city_2022_citygml_4_op/udx/bldg/52365700_bldg_6697_op.gml`（名古屋港、1.07MB）
  - `files` にある地物型：`bldg`、`dem`、`fld`（550件、`natl/shonaigawa_shonaigawa`・`natl/shonaigawa_yadagawa`・`natl/kisogawa_kisogawa` のみ）、`lsld`、`luse`、`tran`、`urf`。**`tnm`（津波浸水想定）・`htd`（高潮）・`ifld`（内水）は無い**
  - コードリストZIP：`https://assets.cms.plateau.reearth.io/assets/d9/9e658a-5658-49a3-9c9b-d5b52a0aaf0f/23100_nagoya-shi_city_2022_citygml_4_op_codelists.zip`
- `https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets`（全国の配信データ一覧、確認済み）
  - 名古屋市（23100〜23116）は51件、すべて `year: 2022`
  - 建築物の **3D Tiles**（区別）。対象5区の LOD1：

| 区 | 3D Tiles LOD1 tileset.json | file_size |
|---|---|---|
| 中村区 23105 | `https://assets.cms.plateau.reearth.io/assets/20/220623-b369-4fd9-9525-0cf09de0c447/23100_nagoya-shi_city_2022_citygml_4_op_bldg_3dtiles_23105_nakamura-ku_lod1/tileset.json` | 30.1MB |
| 熱田区 23109 | `https://assets.cms.plateau.reearth.io/assets/48/98bbde-44d2-483f-9191-6653e5744ad3/23100_nagoya-shi_city_2022_citygml_4_op_bldg_3dtiles_23109_atsuta-ku_lod1/tileset.json` | 11.1MB |
| 中川区 23110 | `https://assets.cms.plateau.reearth.io/assets/a9/1dc07d-d6b2-470a-8431-6a73334ce00a/23100_nagoya-shi_city_2022_citygml_4_op_bldg_3dtiles_23110_nakagawa-ku_lod1/tileset.json` | 46.6MB |
| 港区 23111 | `https://assets.cms.plateau.reearth.io/assets/79/d67234-5b9d-4515-a16b-55edfe7d3bd3/23100_nagoya-shi_city_2022_citygml_4_op_bldg_3dtiles_23111_minato-ku_lod1/tileset.json` | 34.2MB |
| 南区 23112 | `https://assets.cms.plateau.reearth.io/assets/52/c3206f-5462-4b84-ad50-a34ccf9303f4/23100_nagoya-shi_city_2022_citygml_4_op_bldg_3dtiles_23112_minami-ku_lod1/tileset.json` | 26.0MB |

  - 建築物の **MVT は配信されていない**（MVTは `tran`・`luse`・`urf`・`lsld` だけ）。確認済み
  - 3D Tiles は3D形状つきで、平面の外形を取り出すには b3dm/glb の解読が要る。**属性の中身は CityGML と同じはず（推測、未確認）**。今回は属性を確実に読める CityGML を採用した

### 2.2 G空間情報センター（CKAN）
- 2022年度：`https://www.geospatial.jp/ckan/dataset/plateau-23100-nagoya-shi-2022`（確認済み）
  - 整備データ（ページの記載）：建築物（LOD0,1,2）、交通（道路）、都市計画決定情報、土地利用、**災害リスク（浸水）＝洪水浸水想定区域**、災害リスク（土砂災害）、地形
  - 配布：CityGML v4（2.8GB）、3D Tiles・MVT v4（1.7GB）、関連データセット（`23100_nagoya-shi_2022_related.zip`、239kB：`park`・`landmark`・`railway`・`emergency_route` の GeoJSON。**避難施設は無い**）
- 2020年度：`https://www.geospatial.jp/ckan/dataset/plateau-23100-nagoya-shi-2020`（確認済み）
  - CityGML v2 ZIP：`https://assets.cms.plateau.reearth.io/assets/50/bfc02d-c35b-4410-b09e-0613611350e5/23100_nagoya-shi_2020_citygml_4_op.zip`（2.88GB）
  - 3メッシュ（52365700・52365750・52365790）の建物GMLを抜き出して確かめたところ、**構造種別・津波リスクは無く**、洪水（`uro:BuildingRiverFloodingRiskAttribute`）だけがある。コードリストには `BuildingTsunamiRiskAttribute_rank.xml` や `BuildingDetailAttribute_buildingStructureType.xml` が同梱されているが、これは全国共通のひな形で、**名古屋市の建物に値は入っていない**（確認済み、上の3メッシュの範囲）
  - 「ファイルジオデータベース（防災）」`https://3d-city-model-ej-fgdbs.s3.ap-northeast-1.amazonaws.com/23100_nagoya-shi_2020/23100_nagoya-shi_saigai_fgdb.7z`（1.52GB）は中身を**未確認**（7z のため）。PLATEAU の防災FGDBは洪水等の浸水想定が一般的で、津波が入っている見込みは低い（推測）

---

## 3. 属性の実例（2022年度 CityGML、確認済み）

名古屋港の建物（`52365700_bldg_6697_op.gml`、`uro:buildingID = 23100-bldg-304585`、港区港町）：

```xml
<bldg:class codeSpace="../../codelists/Building_class.xml">3002</bldg:class>        <!-- 堅ろう建物 -->
<bldg:usage codeSpace="../../codelists/Building_usage.xml">422</bldg:usage>         <!-- 文教厚生施設 -->
<bldg:measuredHeight uom="m">62.8</bldg:measuredHeight>
<bldg:storeysAboveGround>6</bldg:storeysAboveGround>
<uro:BuildingDetailAttribute> totalFloorArea 10107.8037 / buildingFootprintArea 1684.63395 / surveyYear 2021 …
<uro:BuildingIDAttribute> buildingID 23100-bldg-304585 / city 23111 …
<uro:KeyValuePairAttribute> key 106（高さ根拠） codeValue 3（航空写真測量・数値表層モデルによる間接計測）
```

洪水浸水想定（`52365750`、`uro:bldgDisasterRiskAttribute`）：

```xml
<uro:RiverFloodingRiskAttribute>
  <uro:description>1</uro:description>   <!-- 庄内川水系庄内川 -->
  <uro:rank>2</uro:rank>                 <!-- 0.5m以上3m未満 -->
  <uro:depth uom="m">1.155</uro:depth>
  <uro:adminType>1</uro:adminType>       <!-- 国 -->
  <uro:scale>2</uro:scale>               <!-- L2（想定最大規模） -->
  <uro:duration uom="時間">678.17</uro:duration>
</uro:RiverFloodingRiskAttribute>
```

対象範囲の223メッシュ（479,413棟、5.5GB）の要素を全数集計した結果（確認済み）：
- `bldg:measuredHeight`・`bldg:storeysAboveGround`・`bldg:usage`：各 480,452 要素
- `uro:RiverFloodingRiskAttribute`：825,366 要素（1棟に河川×規模ぶん複数）
- `uro:LandSlideRiskAttribute`：505
- `uro:KeyValuePairAttribute` の key は **106 のみ**（値 3:468,560／2:6,710／6:4,536／9:431／5:215）
- `uro:buildingStructureType`・`uro:BuildingTsunamiRiskAttribute`・`uro:TsunamiRiskAttribute`：**0**
- 2022年度のコードリストに `KeyValuePairAttribute_key.xml` の「10＝構造」の定義はあるが、値のコードリスト（key10）も値そのものも無い

コードリスト（2022年度、抜粋）：
- `Building_usage`：401 業務施設／402 商業施設／403 宿泊施設／404 商業系複合施設／411 住宅／412 共同住宅／413 店舗等併用住宅／414 店舗等併用共同住宅／415 作業所併用住宅／421 官公庁施設／422 文教厚生施設／431 運輸倉庫施設／441 工場／451 農林漁業用施設／452 供給処理施設／453 防衛施設／454 その他／461 不明
- `Building_class`：3001 普通建物／3002 堅ろう建物／3003 普通無壁舎／3004 堅ろう無壁舎／3000 分類しない建物／9999 不明
- `RiverFloodingRiskAttribute_rank`：1 0.5m未満／2 0.5〜3m／3 3〜5m／4 5〜10m／5 10〜20m／6 20m以上
- `RiverFloodingRiskAttribute_scale`：1 L1（計画規模）／2 L2（想定最大規模）

### 3.1 `bldg:class`（建物区分）の意味
公共測量標準図式の区分（検索で確認した要旨）：**堅ろう建物＝鉄筋コンクリート等で建築された地上3階以上（または3階相当以上の高さ）の建物**、**普通建物＝3階未満の建物、および3階以上の木造等の建物**。
- したがって「普通建物＝木造」ではない（2階建てのRC造も普通建物）。**構造種別の代わりにはならない**が、「堅ろう建物」は垂直避難先の候補を絞る根拠には使える
- 出典：[国土地理院 地図記号：堅ろう建物](https://www.gsi.go.jp/KIDS/map-sign-tizukigou-2022kenroutatemonodensikijunten.htm)、[国土地理院 地図記号：普通建物](https://www.gsi.go.jp/KIDS/map-sign-tizukigou-2022-futuutatemono.htm)、[3D都市モデル標準製品仕様書 4.2 建築物モデル](https://www.mlit.go.jp/plateaudocument/toc4/toc4_02/)

### 3.2 避難施設（PLATEAU外の公的データで補う）
- 国土地理院「指定緊急避難場所データ」の津波レイヤ `skhb05`（GeoJSONタイル z10）：`https://cyberjapandata.gsi.go.jp/xyz/skhb05/10/901/405.geojson` など（確認済み）
- 1点の例：`{"name": "ＦＱビル", "address": "愛知県名古屋市中川区尾頭橋3-4-3", "disaster5": 1}`、座標 `[136.892635, 35.143857]`
- 取得範囲（136.78〜136.95, 35.02〜35.20）で1,143点、うち住所が名古屋市の点は多数が民間ビル・商業施設・学校で、実質的に「津波避難ビル」の一覧に近い（推測。名古屋市の「津波避難ビル」公式一覧との照合は未実施）
- 指定緊急避難場所は市町村が指定し、国土地理院が公開しているもの。[指定緊急避難場所データ](https://www.gsi.go.jp/bousaichiri/hinanbasho.html)

---

## 4. ライセンス（条項）

### PLATEAU（3D都市モデル）
- G空間情報センターのライセンス欄：「PLATEAU Site Policy 『３．著作権について』に拠る」（`https://www.mlit.go.jp/plateau/site-policy/`、確認済み）
- サイトポリシーの要点（2026-09-24 に閲覧して要約）：
  - 3D都市モデルのオープンデータの著作権は**各地方公共団体に帰属**
  - **公共データ利用規約 第1.0版（PDL1.0）に準拠**した条件で利用できる（商用利用可。CKANの説明文にも「商用利用も含め、どなたでも無償で自由にご利用いただけます」）
  - **出典の記載が必須**（例：「出典：国土交通省 PLATEAUウェブサイト（URL）」）
  - **加工した場合は、出典とは別に加工した旨を記載**（例：「『○○』（国土交通省）を加工して作成」）。加工物を**国が作成したかのように公表・利用してはならない**
  - 測量法に基づく公共測量成果の利用に制約がある場合がある
- 表記案（A3・A4 で最終化）：
  > 出典：3D都市モデル（Project PLATEAU）名古屋市（2022年度）（国土交通省、https://www.geospatial.jp/ckan/dataset/plateau-23100-nagoya-shi-2022）。建築物モデルの CityGML を加工して作成。

### 国土地理院 指定緊急避難場所データ
- 地理院タイルとして配信。利用条件は[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)（出典明記で利用可）に従うものと考えるが、指定緊急避難場所データ固有の「免責事項・ご利用上の注意」の条文は**未確認**（A3 で確認してください）
- 表記案：「指定緊急避難場所データ（国土地理院）を加工して作成」

---

## 5. パイプライン（`scripts/plateau/`、Python 3 標準ライブラリのみ）

| ファイル | 役割 |
|---|---|
| `common.py` | データカタログAPI、HTTP Range で ZIP の中央ディレクトリを読み1ファイルずつ取り出す `RangeZip`、第3次メッシュ・XYZタイル計算 |
| `fetch_citygml.py` | カタログAPIから最新年度のZIPを引き、範囲に掛かる `udx/bldg/*.gml` だけを Range で取り出して gzip 保存（2.8GB の ZIP を丸ごと落とさない） |
| `fetch_evac.py` | 国土地理院 `skhb05`（津波の指定緊急避難場所）を取得 |
| `build_tiles.py` | CityGML を解析（8並列）→ 対象区で絞り込み → 避難場所を空間結合 → z16 で切り取り → `public/plateau/` へ出力 |
| `verify.py` | 件数・属性の充足率・リングの妥当性・指定地点付近のサンプルを表示 |

実行手順（生データは scratch に置き、リポジトリに入れない）：

```bash
CACHE=/private/tmp/claude-501/-Users-funakoshiakira-workspace-akirapapa-obsidian-1/6768928a-af00-4504-aebd-154a30e1faa5/scratchpad/A1
python3 scripts/plateau/fetch_citygml.py --cache $CACHE/citygml --workers 10   # 223メッシュ、転送 277MB（展開 5.5GB 相当を gzip で 401MB 保存）
python3 scripts/plateau/fetch_evac.py    --cache $CACHE
python3 scripts/plateau/build_tiles.py   --cache $CACHE --workers 10          # 約3分20秒（M系Mac）
python3 scripts/plateau/verify.py --evac $CACHE/evac_skhb05.geojson
```

- 対象範囲：`--bbox 136.78,35.02,136.95,35.20`（5区を包む矩形）に掛かるメッシュを取り、建物ごとの `uro:city`（23105/23109/23110/23111/23112）で5区に絞る。区は `--wards` で変更可
- 形状：`bldg:lod0FootPrint` を優先（257,815棟）。無い場合は `bldg:BuildingPart` ごとの lod0（636件）、それも無ければ `lod1Solid` の底面（169件）
- 属性の正規化：
  - `h`：`measuredHeight`（-9999 は null）、0.1m に丸め
  - `s`：`storeysAboveGround`（9999 は null）
  - `u`：用途コード→日本語名（「不明」は null）
  - `st`：`uro:buildingStructureType` の 601→wood、602→src、603→rc、604・605→steel、606・610→other、611→null（名古屋では該当なし）
  - `td`：`uro:BuildingTsunamiRiskAttribute`（または `TsunamiRiskAttribute`）の depth の最大（名古屋では該当なし）
  - `evac`：避難場所の点を含む建物（複数なら高い方）。含む建物が無ければ 10m 以内の最寄り建物。値は施設名、無ければ `false`
  - 拡張 `sc`：`bldg:class` → `ordinary`／`sturdy`／`shed`／`sturdy_shed`／null
  - 拡張 `fd`：洪水浸水想定の深さ。L2（想定最大規模）の最大、L2 が無ければ全規模の最大
- タイル：z16 XYZ。外周リングを Sutherland–Hodgman でタイル境界に切り取り、小数6桁、閉じたリング。タイルを跨ぐ建物は同じ `id` で複数タイルに入る（ユニーク258,234棟 → タイル上の記録 270,096件）

---

## 6. 出力の検証（`verify.py` の結果、2026-09-24）

- ファイル：`public/plateau/index.json`、`public/plateau/16/{x}_{y}.json` × **561**
- 容量：**76.5MB**（gzip 12.3MB）。1タイル平均 136kB、最大 387kB（`57682_25919.json`）
- 件数：ユニーク建物 **258,234棟**（5区の `uro:city` を持つ建物 258,245 のうち、同じ `buildingID` が2メッシュにあった11件を1件として数えた）
- 妥当性：リング不正 0、タイル外にはみ出した頂点 0、全記録のキーは10個で統一（`ring,h,s,st,u,td,evac,id,sc,fd`）

属性の充足率（ユニーク建物あたり）：

| 項目 | 件数 | 充足率 |
|---|---:|---:|
| `h` 実測高さ | 235,019 | 91.0% |
| `s` 地上階数 | 231,198 | 89.5% |
| `u` 用途 | 230,972 | 89.4% |
| `st` 構造種別 | 0 | 0.0%（属性なし） |
| `td` 津波浸水深 | 0 | 0.0%（属性なし） |
| `evac` 指定緊急避難場所（津波） | 902 | 0.3% |
| `sc` 建物区分（拡張） | 217,201 | 84.1%（普通 168,994／普通無壁舎 27,778／堅ろう 20,323／堅ろう無壁舎 106） |
| `fd` 洪水浸水深（拡張） | 190,030 | 73.6%（すべて >0m） |

- 用途の上位：住宅 146,750／共同住宅 22,587／工場 14,049／店舗等併用住宅 11,150／運輸倉庫施設 10,134／業務施設 8,431／文教厚生施設 7,453
- 高さ：中央値 7.9m、99パーセンタイル 29.4m、最大 246.9m（名古屋駅前の高層ビル）
- 避難場所の結合：取得1,143点のうち、建物の内側 880点、10m以内 26点、結合できず 237点（多くは対象5区外の点）。**5区の住所の点936のうち35点が結合できなかった**（例：一柳中学校、笠寺小学校、港南中学校、港北中学校、荒子小学校、県営万場東住宅南棟 など。点が校庭など建物から10m超の位置にあるため）

名古屋港付近（アプリのプリセット 35.0905, 136.8844 から近い400棟のうち高い順）：

| 距離 | id | h | s | u | sc | fd | evac |
|---:|---|---:|---:|---|---|---|---|
| 215m | 23100-bldg-309065 | 54.7 | 13 | 官公庁施設 | sturdy | null | 名古屋港管理組合本庁舎・名古屋港湾会館 |
| 317m | 23100-bldg-304585 | 62.8 | 6 | 文教厚生施設 | sturdy | null | false |
| 394m | 23100-bldg-304593 | 49.5 | 9 | 官公庁施設 | sturdy | null | 名古屋港湾合同庁舎本館 |
| 503m | 23100-bldg-361841 | 41.9 | 9 | 文教厚生施設 | sturdy | null | 臨港病院 |
| 521m | 23100-bldg-667152 | 41.9 | 12 | 共同住宅 | sturdy | null | 築地シティ住宅 |
| 458m | 23100-bldg-304589 | 38.9 | 9 | 業務施設 | sturdy | null | 名港ビルディング |

（名古屋港付近は洪水浸水想定区域の外なので `fd` は null。名古屋駅付近 35.1709, 136.8815 では、例：`23100-bldg-485353` h=246.9m s=47 業務施設 sturdy fd=2.06m）

---

## 7. 未解決事項と A2 への申し送り

1. **構造種別（木造かどうか）は PLATEAU 名古屋に無い**。`st` は全件 null。木造流失の判定には、`sc`（普通建物）＋`u`（住宅・併用住宅）＋`s`（1〜2階）を組み合わせた**推定**が現実的だが、これは PLATEAU の属性ではないので、画面・資料では「推定」と明記すること（推定ルールの採否は A2 の判断）
2. **建物ごとの津波浸水想定は PLATEAU 名古屋に無い**。`td` は全件 null。建物ごとの公式比較には、アプリ既存の `public/inundation/`（内閣府2025 ケース01、100m集約）を建物の重心で引くのが代替（A2 側の処理。PLATEAU属性ではないと明記）
3. `evac` は「指定緊急避難場所（津波）」で、**名古屋市の「津波避難ビル」公式一覧との照合はしていない**。5区の35点が建物に結合できていない（校庭の点など）。距離しきい値を広げると誤結合が増えるため 10m に留めた
4. 容量 76.5MB（gzip 12.3MB）。リポジトリに入れるか、デプロイ（dist 経由のS3）に含めるかは、ひかりの統合時に判断してください（`.gitignore` は未変更）
5. 2020年度の防災FGDB（1.52GB、7z）の中身は未確認
6. 3D Tiles の属性（batch table）の中身は未確認（CityGML と同じと推測）
7. `sc` と `fd` は契約の拡張。不要なら `build_tiles.py` の `rec` から外せば契約どおり8項目になる
