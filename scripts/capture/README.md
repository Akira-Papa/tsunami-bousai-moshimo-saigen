# 動画素材の撮影パイプライン（A7）

PLATEAU AWARD 2026 応募動画（3分以内）の素材を、実際のアプリ画面から撮影します。`src/` は一切変更せず、dev サーバーだけにある `window.__t` フックを使います。

## 準備
```bash
# 1) dev サーバー（__t フックは dev 時のみ有効）
npx vite --host 127.0.0.1 --port 5361 --strictPort

# 2) 撮影専用の puppeteer-core（リポジトリの依存には入れない）
npm i --prefix ~/tmp/capture-deps puppeteer-core
```
- Google Chrome（`/Applications/Google Chrome.app`）と ffmpeg が必要です。別の場所なら `CHROME=` を指定します。
- 別のポートなら `CAPTURE_BASE=http://127.0.0.1:xxxx`。連番の一時置き場は `CAPTURE_WORK=`（既定は `$TMPDIR/tsunami-capture-frames`）。

## 撮る
```bash
export PUPPETEER_CORE_DIR=~/tmp/capture-deps
node scripts/capture/run.mjs              # 全10カット（地点ごとに1セッション）
node scripts/capture/run.mjs 2 3 7        # 指定カットだけ撮り直す（同じ地点の前のカットは早送りで通過）
node scripts/capture/run.mjs 5 --hmr=block  # 最初から Vite のホットリロードを止めて撮る
node scripts/capture/assemble.mjs         # 仮編集版（無音・2分50秒以内）
```
出力は `docs/award/video/footage/`：`cutNN_*.mp4`、`cuts.json`（撮影条件の記録）、`カット一覧.md`、`仮編集_全カット_無音.mp4`、`cuts_edit.json`。

## しくみ
| 部品 | 内容 |
|---|---|
| `lib.mjs` | ヘッドレス Chrome（`--enable-unsafe-webgpu`・1920×1080）で開き、`renderer.setAnimationLoop(null)` で止めて、`app.frame(1/30)` を1コマずつ回して `page.screenshot`（JPEG）。連番を ffmpeg で 30fps の H.264 にする |
| 早送り | `app.st.speed`（動画1秒あたりのシミュレーション秒）と `app.st.maxSteps`（1コマの上限）を撮影中だけ上げる。撮らずに進めるときは `fastForward` |
| カメラ | `app.setView(...)` で各視点の位置と注視点を読み、Node 側で回り込み（方位角）と寄り（距離の倍率）を毎コマ計算して `app.camera` / `app.controls.target` に入れる |
| 地点選択（カット1） | 地図のアニメーションが実時間で動くので、ページの時計（performance.now・Date.now・requestAnimationFrame）を0.08倍に遅くして撮り（`installSlowClock`／`recordSlow`）、ページ時計のタイムスタンプで30fpsに並べ直す。マウスは本物の入力、カーソルは DOM の矢印で描く（CDP の仮想時間を止める方式はスクリーンショットが返らなくなることがあり不採用） |
| UI | トースト通知と fps 表示は DOM の表示だけ切り替えて隠す。早送りボタンの強調は実際の倍率に最も近いボタンへ合わせる |
| ホットリロード | 既定（`--hmr=retake`）はリロードを検知したらその地点を最初から撮り直し、2回続いたら HMR ソケットを止めて（読み込んだ時点のコードのまま）撮る |

`__t.shot` は広域表示で縞が出る既知の問題があるため使いません。

## カットと地点（`run.mjs` の `sessions`）
| # | 地点（URL） | シミュレーション時刻・倍率・視点 |
|---|---|---|
| 1 | `/` | 地点選択 → プリセット「ガーデンふ頭」→「この地点で再現する」→ 読み込み画面 |
| 10 | ガーデンふ頭 | 計算前・避難候補のハイライトと HUD の最寄り3棟・地点のまわりを回り込み |
| 2 | ガーデンふ頭 `?lat=35.0905&lon=136.8844&auto=1&n=768&manual=1` | 4:30→9:30・×20・俯瞰 |
| 3 | 同 | 9:30→12:55・×20・衝突 |
| 4 | 同 | 12:55→17:25・×20・目線 |
| 7 | 同 | 最後（約39分）まで早送り → 自動で開く結果画面を上から下へスクロール |
| 9 | ガーデンふ頭（読み直し） | 15:00→20:00・×20・南西の住宅地で木造家屋が流失 |
| 5 | 善進本町 `?lat=35.1008&lon=136.8560&auto=1&n=768&manual=1` | 10:30→29:30・×60・俯瞰・深さで色分け |
| 8 | 名古屋駅 `?lat=35.1709&lon=136.8815&auto=1&n=768&manual=1` | 計算前・俯瞰から回り込み・UI非表示 |
| 6 | 同 | 3:00→60:00・約×190・広域・深さで色分け |

時刻は A2 の機能追加などで変わりうるので、撮り直したら `カット一覧.md` のサムネイル確認を推奨します。
