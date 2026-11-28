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

上面的 Skill 用法不變。另外，這個倉庫也是一個 DSH（DeepSeek Harness）插件包：裝好後，DSH 左側導航會出現「拼豆圖譜」，可以選圖、調設定、生成、預覽、下載，不需要敲命令。

> 目前狀態：**尚未發佈到 npm 或 DSH 插件市場**，只能用本機打包的檔案安裝。已在 Linux 上的 DSH Web 0.2.2-rc.5 實測；DSH 桌面版、macOS、Windows 尚未驗證。

需要：

1. DSH 0.2.2-rc.5 以上、0.3 以下（`npm install @deepseek-ai/dsh`），以及 `PATH` 上可用的 `pnpm`（DSH 安裝插件時會呼叫它）。
2. Python 3.10 以上，並已安裝 Pillow（`python -m pip install -r requirements.txt`）。插件不會替你安裝 Python 或 Pillow；找不到時面板會說明該怎麼做，也可以在面板裡填 Python 執行檔的絕對路徑。
3. Node 24.9 以上（DSH 本身的要求，打包也用同一個 Node）。

步驟：

```bash
# 1. 在本倉庫打包插件（產生 ymzz-bead-atlas-0.1.0.tgz，內含 Python 引擎與色卡）
pnpm install
pnpm run build
npm pack

# 2. 安裝到 DSH 的 profile（以 web 為例），安裝後會自動啟用
dsh plugin --profile web add /絕對路徑/ymzz-bead-atlas-0.1.0.tgz

# 3. 重新啟動 DSH
dsh web
```

使用：打開 DSH → 左側「拼豆圖譜」→ 選擇或拖入圖片 → 調整品牌、寬度、顏色數等 → 「生成拼豆圖紙」→ 預覽效果圖、逐格圖紙、SVG → 下載七種檔案中的任何一種。任務紀錄保存在 `$DSH_HOME/bead-atlas/`（未設定 `DSH_HOME` 時為 `~/.dsh/bead-atlas/`），重新啟動 DSH 後仍在。

移除：`dsh plugin --profile web remove ymzz-bead-atlas`。任務紀錄不會自動刪除，需要時自行刪除 `$DSH_HOME/bead-atlas/`。

技術細節、安全邊界與已知限制見 [`docs/DSH-PLUGIN.md`](docs/DSH-PLUGIN.md)。
