# BMKeyLogger

Beatmania IIDX／BMS向けの、配信画面用キー入力表示です。キーボードまたは専用コントローラーの入力を検出し、IIDX風の鍵盤にノートを流します。

このツールは譜面・スコア・beatorajaの画面を読み取りません。Windowsが受け取る入力だけを表示するため、beatoraja、INFINITASなどと並行して使えます。

## 入力取得とゲームへの影響

キーボードは Windows の **Raw Input** を観測専用で受信します。ゲームへのキー送信を止めたり、キーを置き換えたり、仮想入力を生成したりしません。具体的には次の方針です。

- バックグラウンドでも受け取るために `RIDEV_INPUTSINK` だけを指定します。
- 通常のキーボードメッセージを止める `RIDEV_NOLEGACY` は使用しません。
- 低レベルキーボードフックは使用しません。
- Raw Input を受けた専用スレッドで `perf_counter_ns()` を記録し、表示処理はイベントキューを消費するだけにします。
- コントローラーは Pyglet/DirectInput のボタン・軸イベントで処理し、従来の全ボタンを1msごとに走査する方式は使いません。

そのため、通常は INFINITAS／Oraja と同時起動してもゲーム側の入力を妨害しません。ただしゲームを管理者として実行しているときは、BMKeyLoggerも同じ権限で起動してください。特定ドライバーが排他的入力を使う環境では、Windows側の制約により観測できない場合があります。

## できること

- 1P・2Pを同時に表示（SPにもDPにも利用可能）
- 鍵盤ごとの総打鍵数、直近1秒のKPS、起動経過時間を表示
- キーボード、ジョイパッドのボタン、アナログ軸を任意に割り当て
- 表示の縦サイズ、ノートの流速、フォントを設定

## 動作環境

- Windows
- Python 3
- キーボードまたはXInput/DirectInputとして認識されるコントローラー

入力の取得にはWindows APIを使うため、macOS・Linuxでは動作しません。

## 起動までの手順

1. [Releases](../../releases) から配布ファイルを入手するか、このリポジトリをcloneします。
2. Pythonをインストールします。インストール時は **Add Python to PATH** を有効にしてください。
3. PowerShellでこのフォルダを開き、依存パッケージを入れます。

   ```powershell
   py -m pip install -r requirements.txt
   ```

4. 必要に応じて `config.json` を編集します。
5. 起動します。

   ```powershell
   py BMkeyLogger.py
   ```

ウィンドウを閉じる、または `Esc` を押すと終了します。

## OBSで使う

1. BMKeyLoggerを起動します。
2. OBSで「ウィンドウキャプチャ」ソースを追加し、`BMKeyLogger 20201107` のウィンドウを選びます。
3. 配信レイアウトに合わせてサイズと位置を調整します。

背景画像を含む通常のウィンドウキャプチャです。透過表示を行う場合は、OBS側でクロマキーなどのフィルターを設定してください。

## 曲中だけ表示する／曲名を取得する

`game_monitor` を設定すると、入力表示を曲中だけ出すことができます。ゲーム状態の取得方法は2つあります。

- **Oraja（推奨）**: Luaスキンから曲名とゲーム状態をJSONに出力します。画面レイアウトに依存せず、曲名もそのまま取得できます。
- **INFINITAS・Orajaのフォールバック**: 画面上の「曲中だけ現れる固定要素」をテンプレートとして選択します。スキンや解像度ごとにプロファイルを作成します。

どちらの方式でも、`"hide_when_not_playing": true` にすると、`playing` 以外のときはBMKeyLoggerのウィンドウを非表示にします。OBSには曲中だけ映ります。

### Oraja: Lua bridgeを使う

1. `beatoraja/bm_key_display_bridge.lua` を、利用するLuaスキンのフォルダにコピーします。
2. Luaファイル先頭付近に次を追加します。

   ```lua
   dofile(skin.path .. "bm_key_display_bridge.lua")
   ```

3. そのスキンの `update()` 内で毎フレーム `BMKEYDISPLAY_update()` を呼びます。
4. bridgeファイルの `BMKEYDISPLAY_STATE_PATH` を絶対パスに変更し、`config.json` と同じ場所を指定します。
5. `config.json` の `game_monitor` を次のように設定します。

   ```json
   "game_monitor": {
     "provider": "oraja_bridge",
     "bridge_state_path": "C:/BMKeyLogger/oraja-state.json",
     "poll_interval_ms": 250,
     "hide_when_not_playing": true,
     "calibration_hotkey": "F8"
   }
   ```

Luaスキンはユーザーが選んだものだけを手動で編集してください。アップデート前には元のLuaファイルをバックアップしてください。スキンによって状態変数の名前や値が異なる場合があるため、曲中判定が合わなければ bridge 内の `bmkeydisplay_phase()` だけを調整します。

### 画面テンプレートをマウスで設定する

この方式は、Lua連携を使わないOrajaとINFINITASで使います。先に以下の設定を追加します。

```json
"game_monitor": {
  "provider": "screen_template",
  "screen_profile_path": "profiles/infinitas.json",
  "poll_interval_ms": 250,
  "hide_when_not_playing": true,
  "calibration_hotkey": "F8"
}
```

1. ゲームを実際に**曲中**の画面にして、BMKeyLoggerを起動します。
2. `F8` を押します（設定は `calibration_hotkey` で変更できます）。通常表示とは別の**キャリブレーションモード**が最前面に開きます。ここでの選択を最後まで完了するまで、既存プロファイルは書き換えません。
3. まず曲名の領域をドラッグします。曲名を使わない場合は `S` でスキップします。
4. 次に、譜面名／難易度の領域をドラッグします。不要なら `S` でスキップします。
5. RANDOM配置認識も使う場合は、7鍵だけを横切る細い検出帯をドラッグします。不要なら `S` でスキップします。
6. 最後に、曲中にだけ見える**動かない小さな要素**をドラッグします。選択した画像がテンプレートになります。

`profiles/infinitas.json` とテンプレートPNGが保存されます。テンプレートは、選曲・リザルト画面では出ない固定アイコンや枠を選ぶのが重要です。画面レイアウトやスキンを変えた場合は、各環境用にプロファイルを作り直してください。

画面テンプレート方式で曲名も読むには、Tesseract OCR本体と日本語言語データをインストールし、プロファイルへ `"ocr_language": "jpn"` を追加します。IIDXの譜面種別は英字で読ませるため、同じプロファイルに `"chart_ocr_language": "eng"` を追加してください。Python側の `pytesseract` は `requirements.txt` に含まれます。OCRが未導入・失敗した場合でも、曲中判定はそのまま動きます。標準状態ではOCRを使わず、OrajaのLua bridgeだけが追加導入なしで曲名を取得します。

## 打鍵ログを保存する

曲中への遷移からリザルト等への遷移まで、レーンごとの押下・離鍵時刻をJSONとして保存できます。`config.json` に以下を設定してください。

```json
"replay_log": {
  "enabled": true,
  "game": "iidx"
}
```

保存先と名前は、プロジェクトフォルダを基準に次の形式です。

```text
./IIDX/yyyymmdd-hhmmss-(songname)-(N|H|A|L)-log.json
./Oraja/yyyymmdd-hhmmss-(songname)-(chartname)-log.json
```

IIDXは画面プロファイルの曲名・譜面種別領域をOCRで設定してください。`NORMAL`、`HYPER`、`ANOTHER`、`LEGGENDARIA` はそれぞれ `N`、`H`、`A`、`L` に変換します。OrajaではLua bridgeが取得するBMSのサブタイトルを譜面名として使います。文字として取得できない情報は `unknown-song`／`unknown-chart` になります。

ファイル内の `t_us` は、曲中を検出した時点を0とする入力イベントの相対マイクロ秒です。Raw Inputの到着時刻を保持しているため、表示フレームの更新間隔によって丸められません。画面検出やLua bridgeの検出遅延は別途の開始オフセットとして残るため、将来の譜面重ね合わせではキャリブレーション対象になります。

### IIDX: 小節線で譜面時刻を同期する

IIDXで譜面と打鍵を重ねる場合は、画面に流れる小節線を時刻アンカーとして記録できます。`replay_log` と `game_monitor` の `screen_template` を有効にしたうえで、次を追加します。

```json
"measure_sync": {
  "enabled": true,
  "capture_fps": 120,
  "bright_threshold": 210,
  "minimum_bright_fraction": 0.55,
  "cooldown_ms": 250
}
```

`F8` のキャリブレーションでは、曲中画面で小節線が通過する高さに、レーン幅を横切る**細い横長の領域**を選びます。小節線がその領域を横切るたび、同じ `perf_counter_ns` 時間基準で `sync_markers` としてログへ保存されます。譜面ビューアーは複数のマーカーを譜面の小節線へ対応させ、最後に手動オフセットスライダーで数ms単位の補正をします。

高fpsキャプチャにはWindows Desktop Duplication対応の `dxcam` を使います。初期実装では**メインディスプレイ**を対象にします。IIDXを別ディスプレイで実行する場合、または小節線の色・背景により誤検出する場合は、`bright_threshold` と `minimum_bright_fraction` を調整してください。これは同期補助であり、表示キャプチャ遅延を完全に消すものではないため、ビューアーの手動補正は必須です。

## 譜面ビューアー（開発版）

`viewer/` は、譜面とこのツールの入力ログを重ねて検証するためのローカルWebアプリです。Textage Chart Viewerのような「譜面を再生しながら研究する」使い方を目標に、まずBMSのローカルファイルを対象にしています。

```powershell
cd viewer
npm install
npm run dev
```

ブラウザで表示されたURLを開き、次の順番で読み込んでください。

1. `.bms`／`.bme` を選択します。小節長とBPM変化、SP 7鍵＋スクラッチのノートを再生します。
2. `Oraja/` または `IIDX/` に保存された `*-log.json` を選択します。
3. 黄色の枠が実際の押下です。Hi-Speed、緑数字、小節線、手動の入力補正スライダーでずれを確認します。

画面は参照ビューアーと同じ黒・グレーを基調に、左のPlaylist／中央の譜面／右のOptionsで構成しています。白鍵ノートは白、黒鍵ノートは青、スクラッチは赤です。

- **Hi-Speed**: 譜面のスクロール倍率です。曲の進行時間や打鍵時刻は変えません。
- **緑数字**: IIDX基準のノーツ表示時間です。通常の時間倍率1.00×では、300が500 msに対応します。値を小さくするとHi-Speedが上がります。参照ビューアーの表示範囲に合わせ、BPM 200／HS 1.00で810、緑数字300でHS 2.70となります。Hi-Speedを固定したままBPMが変わると緑数字も変わります。Orajaのミリ秒表記とは単位が違うため、表示時間も併記しています。
- **Playside**: 1Pは皿が左、2Pは皿が右です。鍵盤1〜7は左右反転しません。入力ログの記録元サイドは、Optionsの「入力ログ」から別に選択できます。
- **時間倍率**: 曲の時間をスロー／倍速にする独立した操作です。Hi-Speedと緑数字は元のBPMを基準に表示します。
- **Measure**: 開始・終了小節を指定できます。譜面下の±1小節ボタン、タイムライン、Spaceで移動・再生できます。

狭い画面では曲情報のPlaylist／Optionsボタンから各パネルを開きます。検証用のテストは `viewer/` で `npm test`、ビルドは `npm run build` です（Node.js 24以上）。

外部サイトからIIDX譜面を一括取得・再配布はしません。INFINITASの譜面は、利用許諾が明確なデータ提供元を選んだうえで、ユーザーが指定したURLを読むアダプターとして追加する方針です。BGA、音源、動画連携、IIDX譜面アダプターは次の段階です。

## RANDOM配置認識

RANDOM配置の推定コアを追加しました。`inf_daken_counter_obsw` と同じく、ゲームや入力に介入せず、画面から観測した同時押しの列を使います。

1. まずREGULARまたはMIRRORのプレーで、7鍵の同時押し列を正規譜面として登録します。
2. 同じ譜面をRANDOM／R-RANDOMでプレーし、画面上の同時押し列と照合します。
3. 7!通りのレーン写像を消去していき、確定前でも `W`（白鍵）、`B`（黒鍵）、`?` を含む部分結果を返します。

この計算コアは `key_display/random_lane.py` にあり、ゲーム共通です。F8キャリブレーションで検出帯を保存するところまで実装済みです。次の実装段階では、IIDXではオプション表示テンプレート、Orajaではスキン／BMSメタデータをアダプターにして、REGULAR／RANDOMの自動判別とライブ画面キャプチャを接続します。画面取得の参照実装は [inf_daken_counter_obsw のRANDOMレーン認識](https://github.com/dj-kata/inf_daken_counter_obsw/blob/main/src/random_lane_analysis.py) を確認しています。

## `config.json` の設定

設定を変えるときは、アプリを終了してから `config.json` を編集し、再起動してください。

```json
{
  "font_name": "",
  "speed": 720,
  "screen_height": 720,
  "threshold": 0.9,
  "joypad": [],
  "keyboard": []
}
```

|項目|意味|
|---|---|
|`font_name`|打鍵数などに使うWindowsフォント名。空文字ならPygletの既定フォントです。|
|`speed`|ノートの落下速度。大きいほど速く流れます。|
|`screen_height`|ウィンドウの高さ（px）。OBSに合わせる場合は配信解像度に合わせて調整します。|
|`threshold`|アナログ軸を押下と見なすしきい値。`0`〜`1`で指定し、誤反応する場合は大きくします。|
|`keyboard`|キーボードの割り当て。各レーンにVirtual-Keyコードを16進文字列で指定します。|
|`joypad`|コントローラーの割り当て。接続順ごとにボタン番号またはアナログ軸を指定します。|
|`game_monitor`|曲中判定・曲情報取得の任意設定。詳細は上記を参照。|
|`replay_log`|曲中の打鍵ログ保存の任意設定。`enabled` と対象ゲームの `game`（`"iidx"`／`"oraja"`）を指定します。|
|`measure_sync`|IIDXの小節線を高fpsで検出し、譜面同期用マーカーとしてログへ保存する任意設定。`screen_template` のゲーム監視時だけ有効にできます。|

### レーンの順番

`keyboard` とコントローラー1台分の設定は、必ず18個の配列で指定します。順番は次のとおりです。

|配列の位置|表示する入力|
|---:|---|
|0〜1|1Pスクラッチ（回転方向ごと）|
|2〜8|1P 鍵盤1〜7|
|9〜15|2P 鍵盤1〜7|
|16〜17|2Pスクラッチ（回転方向ごと）|

各レーンには複数の入力を登録できます。例えば、レーン2を `Z` キーとコントローラーボタン1の両方で反応させる場合は、対応する `keyboard` と `joypad` のレーンにそれぞれ設定します。

### キーボードを割り当てる

Virtual-Keyコードを16進数の文字列で指定します。たとえば `"5A"` は `Z` キー、`"A0"` は左Shiftです。

```json
"keyboard": [
  ["A0"], [], ["5A"], ["53"], ["58"], ["44"], ["43"], ["46"], ["56"],
  ["BC"], ["4C"], ["BE"], ["BB"], ["BF"], ["BA"], ["E2"], ["A1"], []
]
```

キーボード配列によってキー名とコードの対応が異なることがあります。コードは[MicrosoftのVirtual-Keyコード一覧](https://learn.microsoft.com/windows/win32/inputdev/virtual-key-codes)で確認できます。

### コントローラーを割り当てる

`joypad` の一番外側の配列は、接続順のコントローラーを表します。1台目は `joypad[0]`、2台目は `joypad[1]` です。

- ボタンは **1始まり** の整数で指定します。例: `[4]` は4番ボタンです。
- アナログ軸は `"-x"`、`"+x"`、`"-y"`、`"+y"` を指定できます。
- 未使用レーンは `[]` にします。

例: 1台目のスクラッチ方向にX軸を使い、レーン2に4番ボタンを割り当てる場合。

```json
"joypad": [
  [["-x"], ["+x"], [4], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []]
]
```

コントローラーは、アプリを起動する前に接続してください。認識順を変えたい場合は、一度アプリを終了してコントローラーを接続し直してから起動します。

## 困ったときは

### ウィンドウが起動しない

PowerShellで `py -m pip install -r requirements.txt` を実行し、依存パッケージが入っているか確認してください。`py` が見つからない場合は、Pythonの再インストール時にPATH設定を有効にしてください。

### キーが反応しない

- `config.json` のレーン順とVirtual-Keyコードを確認してください。
- ゲームを管理者として起動している場合は、BMKeyLoggerも同じ権限で起動してください。
- 別の入力変換ツールを使っている場合は、BMKeyLoggerが実際に受け取るキー／ボタンを設定してください。

### スクラッチが勝手に反応する

`threshold` を `0.9` より大きくして、アナログ軸の遊びによる誤反応を抑えてください。

## 開発

```powershell
py -m unittest discover -s tests -v
```

MIT Licenseのもとで公開しています。フォークして自分の配信環境向けに改造できます。
