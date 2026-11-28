# YMZZ Bead Atlas · 晏銘湛箴_拼豆圖譜

把一張圖片轉成能逐格製作、能逐格核色、能直接備料的拼豆圖紙。Claude Skill 格式，可安裝到 Codex、Claude Code、WorkBuddy、Cursor 等支援 Agent Skills 的環境。

倉庫：https://github.com/Ya-MiC/ymzz-bead-atlas

## 1. 解決什麼問題

1. 拼豆創作者真正的卡點不是把圖片縮小，而是把每一格換成買得到的色號，再一種一種數清楚。
2. 同類工具多為瀏覽器單頁應用，色卡寫死、只能選一個品牌、輸出沒有色差證據，也無法直接變成 Agent 可呼叫的能力。
3. YMZZ Bead Atlas 把這件事做成可安裝、可腳本化、可稽核的 Skill：多品牌色卡、使用者可改色值、可存成自己的色群預設、每格留下 ΔE00 證據。

## 2. 能力

1. 15 個品牌、2093 個色號：MARD、Hama Midi、Mini、Maxi、Perler、Mini、Caps、Nabbi、Artkal A/C/M/R/S、Yant、Diamond Dotz。
2. 每個色號都標明品牌、豆徑與色系，輸出材料表帶品牌欄，不會混淆不同品牌的同名色號。
3. CIEDE2000 色差匹配，附 Sharma 2005 參考組自檢，輸出逐格 ΔE00 與整體統計。
4. 使用者自訂色卡：覆寫色值、新增色號、載入整份自訂 CSV，並可存成「默認1」「默認2」或任意名稱的預設。
5. 交付七種檔案：圖紙 PNG、圖紙 SVG、預覽 PNG、材料 CSV、座標 CSV、用量 JSON、報告 MD。
6. 全程本機處理，不上傳圖片，不含帳號、金鑰或付費邏輯。

## 3. 安裝

```bash
python -m pip install -r requirements.txt
```

需要 Python 3.10 以上。除 Pillow 外沒有其他相依，不需要 Node、API Key 或網路。

## 4. 使用

```bash
python scripts/convert.py "圖片路徑" --output "輸出資料夾"
python scripts/convert.py "圖片路徑" --output "輸出資料夾" --brand hama --width 64 --max-colors 24
python scripts/convert.py --list-brands
python scripts/convert.py --list-presets
```

自訂色卡：

```bash
python scripts/convert.py "圖片路徑" --output "輸出資料夾" --override A1=#FAF5CD --extra-color X1=#FF7AB0|我的粉
python scripts/convert.py --save-preset "默認1" --brand mard --override A1=#FAF5CD
python scripts/convert.py "圖片路徑" --output "輸出資料夾" --preset "默認1"
```

自訂色群 CSV 欄位：`代號,名稱,R,G,B`。

## 5. 檔案結構

| 路徑 | 用途 |
|---|---|
| `SKILL.md` | Skill 指令與元資料 |
| `scripts/convert.py` | 轉換、色差匹配、匯出、預設管理 |
| `scripts/brands.json` | 品牌與色卡註冊表 |
| `scripts/data/*.csv` | 各品牌色卡，來源 maxcleme/beadcolors（MIT） |
| `scripts/presets/*.json` | 使用者自訂色群預設 |
| `tests/test_convert.py` | 單元與端到端測試 |
| `scripts/package.py` | 產生可上架的 ZIP 商品包 |
| `docs/product.md` | 產品定義與商業化 |
| `docs/evidence.md` | REA 取證紀錄與參考對照 |
| `NOTICE.md` | 第三方來源與授權 |

## 6. 商業化定位

1. 交付物是一個可獨立售賣的 Skill：買斷後使用者取得完整源碼與色卡，可自行修改、可自訂色群、可離線執行。
2. 差異化不在「會轉圖」，而在「色卡可信、顏色可改、證據可查、可變成 Agent 能力」。
3. 後續規劃：雲端作品庫與多人協作版、實體色卡校色工具、批次生產排版與成本估算。

## 7. 授權與來源

MIT。色卡資料來自 maxcleme/beadcolors（MIT），逐檔雜湊與完整授權見 `NOTICE.md`。參考專案與 REA 取證說明見 `docs/evidence.md`。

## 8. Install Bead Atlas in DSH（在 DeepSeek Harness 裡用圖形介面）

上面的 Skill 用法不變。另外，這個倉庫也是一個 DSH（DeepSeek Harness）插件包，套件名 `@ymzz/bead-atlas`：裝好後，DSH 左側導航會出現「拼豆圖譜」，選圖、調設定、生成、預覽、改色、下載都在圖形介面完成，不需要敲命令。

> 目前狀態：已在 Linux 上的 DSH Web 0.2.2-rc.5 實測（安裝、生成、互動圖紙、改色重生、下載、重新啟動後保留紀錄）。DSH 桌面版、macOS、Windows 尚未實測。npm 上的 `@ymzz/bead-atlas` 要等作者發佈後才能用「方法 A」；在那之前請用「方法 B」本機打包安裝。發佈狀態以 <https://www.npmjs.com/package/@ymzz/bead-atlas> 為準。

### 8.1 需要的環境

1. DSH 0.2.2-rc.5 以上、0.3 以下（`npm install -g @deepseek-ai/dsh`），以及 `PATH` 上可用的 `pnpm`（DSH 安裝插件時會呼叫它）。
2. Node 24.9 以上（DSH 本身的要求）。
3. Python 3.10 以上，以及 Pillow 12.1 以上（建議直接 `python -m pip install -r requirements.txt`，會裝 13.0.0）。插件不會替你安裝 Python 或 Pillow。

### 8.2 安裝

方法 A：從 npm 安裝（發佈後可用）

```bash
dsh plugin --profile <profile 名稱> add @ymzz/bead-atlas
# 例：dsh plugin --profile web add @ymzz/bead-atlas
```

方法 B：從本倉庫打包安裝（現在就能用）

```bash
pnpm install
pnpm run build
npm pack                      # 產生 ymzz-bead-atlas-<版本>.tgz，內含 Python 引擎與 15 份色卡
dsh plugin --profile web add /絕對路徑/ymzz-bead-atlas-<版本>.tgz
```

兩種方法裝好後都會自動啟用。重新啟動 DSH（例如 `dsh web`），左側就會出現「拼豆圖譜」；也可以在「插件」頁的已安裝列表看到它。

### 8.3 第一次打開：環境檢查

面板右上方會自動檢查本機環境：

1. 一切就緒時顯示一行 `Python 3.x.x · Pillow x.x.x`。
2. 找不到 Python 或版本低於 3.10：顯示 Python 官方下載連結。
3. 缺 Pillow，或 Pillow 低於 12.1：顯示要在插件資料夾執行的安裝／升級命令（`python -m pip install --upgrade -r requirements.txt`）。
4. 自動找不到 Python 時，可在「Python 執行檔路徑」填入絕對路徑（例如 `C:\Users\你\AppData\Local\Programs\Python\Python313\python.exe` 或 `/usr/bin/python3`），按「儲存路徑」。
5. 裝好後按「重新檢測」。環境沒就緒時「生成拼豆圖紙」按鈕不能按。

### 8.4 生成圖紙

1. 「選擇圖片」或把圖片拖進虛線框（PNG、JPG、WebP、BMP；GIF 只轉第一幀；單檔 15 MB 以內）。換圖時會先顯示「正在讀取新圖片」，讀完才能生成，不會誤送舊圖。
2. 設定品牌（15 個品牌色卡）、圖紙寬度（格）、高度（留 0 依比例）、最多顏色數；進階裡有豆徑、半透明背景色、底板尺寸、每包顆數、備損比例，以及已存在的自訂色群。
3. 按「生成拼豆圖紙」。生成中可以「取消」；介面不顯示假的百分比。一次只跑一個任務，有任務進行中時按鈕會停用並說明原因。
4. 完成後右側顯示品牌、網格、用豆數、空背景格數、顏色種類、預估尺寸、底板數、含備損採購顆數；下方是材料表。

### 8.5 互動圖紙：懸停、同色高亮、空背景、改色

結果區預設分頁是「互動圖紙」：

1. **懸停浮起**：滑鼠移到某一格，那一格會在原位微微浮起；提示框顯示色號、HEX、以及這個色號全圖共幾顆。按住滑鼠拖過，可以一格一格連續查看。系統開啟「減少動態效果」時不位移，只加描邊。
2. **同色號高亮**：懸停或選中某格時，全圖同一色號的格子保持原色，其他格子被淡化，方便看這個顏色分佈在哪裡。
3. **空背景（不放豆）**：原圖透明的地方畫成棋盤格，標示「空背景（不放豆）」，不算進用豆數與材料表。
4. **改色**：點一顆豆 → 下方「改色」區列出目前品牌的色卡（由 Python 引擎讀出，含你選的自訂色群）→ 選「只改這一格」或「全部同色號」→ 點替代色號。圖紙與材料表會立刻更新，並標示「含改色（尚未重新生成）」。可「復原上一步」或「還原全部」。
5. **把改色結果變成檔案**：按「以改色重新生成圖紙」。Python 引擎會依改色後的網格重新產生全部 7 個檔案，存成新任務；原任務不變。新任務頁會註明它來自哪個任務。
6. 鍵盤也能操作：在圖紙上用方向鍵移動、Enter 選取、Esc 取消。

其他分頁：效果預覽、逐格圖紙（PNG）、SVG 圖紙、原圖。

### 8.6 下載與任務紀錄

1. 「下載檔案」可下載 7 種輸出：逐格圖紙 PNG、向量圖紙 SVG、效果預覽 PNG、材料表 CSV、逐格座標 CSV、用量 JSON、製作報告 MD。檔案存到瀏覽器的下載位置。
2. 「最近任務」列出最近 200 筆，可查看、用同一張圖與設定重新生成、刪除（需確認）。
3. 紀錄存在 `$DSH_HOME/bead-atlas/`（未設定 `DSH_HOME` 時為 `~/.dsh/bead-atlas/`），重新啟動 DSH 後仍在。

### 8.7 移除

```bash
dsh plugin --profile web remove @ymzz/bead-atlas
```

任務紀錄不會自動刪除，需要時自行刪除 `$DSH_HOME/bead-atlas/`。

### 8.8 常見問題

1. **左側沒有「拼豆圖譜」**：確認安裝時用的 `--profile` 與啟動的 DSH 相同，並重新啟動 DSH。`dsh plugin --profile web list` 可查看已安裝的插件。
2. **一直顯示「還不能生成圖紙」**：照面板的提示安裝 Python 3.10+ 或升級 Pillow 到 12.1+，再按「重新檢測」；或填入 Python 的絕對路徑。
3. **按了生成沒反應**：可能正在讀取剛選的圖片，或已有任務在跑；看按鈕旁的說明文字。
4. **查詢狀態暫時失敗**：面板會自動重試幾次並保留「取消」；若仍失敗，會出現「繼續追蹤」按鈕。
5. **改色後下載的還是舊顏色**：改色只先更新畫面與材料表；按「以改色重新生成圖紙」後，新任務的下載檔才是改色版。
6. **有些色號在改色清單裡是灰的**：那些色號的色值和清單中更早的色號完全相同，引擎會把它歸為較早的那個，請直接選那一個。
7. **HEX 和實體豆子顏色不同**：HEX 是螢幕參考值，購買前請用實體色卡核對。
8. **圖片會不會上傳到網路**：不會。圖片只在本機 DSH 與本機磁碟之間流動，轉換由本機 Python 完成。

技術細節、安全邊界與已知限制見 [`docs/DSH-PLUGIN.md`](docs/DSH-PLUGIN.md)；每個版本做了什麼見 [`CHANGELOG.md`](CHANGELOG.md)。
