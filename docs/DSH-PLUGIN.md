# Bead Atlas DSH 插件說明

這份文件說明 `ymzz-bead-atlas` 作為 DeepSeek Harness（DSH）插件包時的結構、資料流、安全邊界與已知限制。Skill 本身的用法見 `README.md` 與 `SKILL.md`，兩者互不影響。

## 1. 狀態

| 項目 | 狀態 |
|---|---|
| 發佈 | 未發佈到 npm，也未上架 DSH 插件市場。`package.json` 設 `private: true`，防止誤發佈。 |
| 已實測環境 | Linux、`@deepseek-ai/dsh` 0.2.2-rc.5（npm `latest`）、`dsh web`、Chrome、Python 3.13.5、Pillow 13.0.0 |
| 未驗證 | DSH 桌面版、macOS、Windows、DSH master（0.2.3-alpha）、插件頁「添加插件」按鈕的安裝路徑 |
| 相容範圍 | `engines.dsh`: `>=0.2.2-rc.5 <0.3.0` |

## 2. 結構

同一個 npm 包同時是 DSH bundle 與插件：

| 路徑 | 作用 |
|---|---|
| `package.json` → `dsh.bundle.patch` | 指向 `dsh-plugin/cordis.patch.yml`，把插件列 `bead-atlas` 插入 profile 的 Cordis 樹 |
| `package.json` → `dsh.client` | 宣告瀏覽器端（`platform: web`） |
| `locale/zh.json`、`locale/en.json` | 插件頁顯示的名稱與說明 |
| `dsh-plugin/icon.svg` | 插件頁圖示 |
| `dsh-plugin/src/host/` | Host 端（Node，在 DSH 行程內執行） |
| `dsh-plugin/src/client/` | Client 端（React，在 DSH 網頁內執行） |
| `dsh-plugin/src/remote/` | 兩端共用的型別與驗證 |
| `dsh-plugin/styles/bead-atlas.module.css` | 面板樣式 |
| `dsh-plugin/scripts/build.mjs` | 產生 `dsh-plugin/lib/index.js`（Host ESM）與 `dsh-plugin/lib/client.js`（DSH module loader 格式） |
| `scripts/convert.py`、`scripts/brands.json`、`scripts/data/*.csv`、`scripts/presets/*.json` | Python 引擎與色卡，原樣打包，TS 端不複製任何色卡資料 |

## 3. 資料流

1. 瀏覽器讀取使用者選的圖片，以 base64 放進 JSON，經 DSH 的 Connection RPC 通道 `/bead-atlas/<endpoint>` 送到 Host。圖片只在本機 DSH 行程與本機磁碟之間流動。
2. Host 驗證：檔案大小（≤ 15 MiB）、魔數判斷格式（PNG、JPEG、WebP、GIF、BMP）、從檔頭讀出寬高（單邊 ≤ 12000 px、總像素 ≤ 4000 萬）、設定值範圍、品牌與預設必須出現在 `convert.py --list-brands / --list-presets` 的輸出裡。
3. Host 建立 `$DSH_HOME/bead-atlas/jobs/<job-id>/`，把圖片寫成 `input/source.<ext>`。路徑全由 Host 產生；使用者的檔名只作顯示，不參與任何路徑。
4. Host 透過 `ctx.subprocess.spawn` 執行 `python scripts/convert.py <input> --output <job>/output ...`：明確的 argv、不經 shell、逾時 120 秒、stdout / stderr 各保留 64 KiB、可取消。子行程環境由 DSH subprocess 服務清理憑證類變數，插件只額外加上 `PYTHONIOENCODING`、`PYTHONUTF8`、`PYTHONDONTWRITEBYTECODE`。
5. 結束後 Host 檢查七個輸出是否齊全，讀 `usage.json` 做摘要與材料表，寫入 `job.json`。
6. 瀏覽器需要預覽或下載時，依任務 id 與固定檔名（白名單）取檔；Host 以 `realpath` 確認檔案仍在該任務資料夾內才回傳。

同一時間只跑一個轉換。DSH 在轉換中途關閉時，下次啟動會把該任務標成「中斷」。

## 4. 通道端點

| 端點 | 作用 |
|---|---|
| `getEnvironmentStatus` | 檢查 Python ≥ 3.10、Pillow、引擎檔案；`refresh: true` 重新檢查 |
| `listBrands` | 由 `convert.py --list-brands`、`--list-presets` 取得 |
| `createJob` | 建立並開始一個轉換 |
| `getJob` | 讀取任務；`waitMs`（≤ 25 秒）可等待到狀態改變，介面不顯示假的百分比 |
| `cancelJob` | 取消執行中的任務 |
| `listJobs` | 最近 200 筆 |
| `getResultFile` | 七個輸出之一或原圖，base64 |
| `deleteJob` | 刪除一個任務資料夾，必須帶 `confirmed: true` |
| `getConfig`、`updateConfig` | Python 路徑（只接受絕對路徑且檔名為 python / python3 / py）與表單預設值 |

所有端點只接受 owner Peer（本機使用者）；其他 Peer 一律回 `bead-atlas/forbidden`。不存在任意路徑或任意命令的端點。

## 5. 與上游規範的差異與相容處理

1. **Connection RPC 在 0.2.2-rc.5 的已知問題**：rc.5 的 `connection.rpc.handle` 在註冊時於 Cordis effect 內讀取 `owner.webServer`，對插件 context 會拋出 `cannot get property "webServer" without inject`。上游 master 已改為 `owner.get('webServer')`。rc.5 自己沒有任何 Host 套件用到 `rpc.handle`。插件先呼叫 `rpc.handle`；失敗時改用 `dsh-plugin/src/host/rpc-route.ts`，把同一個通道直接掛在 `webServer` 上（與 rc.5 的 open-in-app、`/api` 路由相同作法），每個請求先過 `connection.admit(req)`（Host / Origin 檢查與登入驗證），線上格式與 Connection RPC 完全相同，所以 Client 端照常使用 `connection.rpc.call`。
2. **平台模組名稱**：rc.5 的模組表用 `@deepseek-ai/dsh-client-ui-primitives` 這類完整套件名，master 原始碼改為無 scope 的 `dsh-client-ui-primitives`。本插件以實際執行的 rc.5 為準。
3. **Typert Remote**：Typert 的型別產生器只在上游 monorepo 內可用，插件改用官方的 Connection RPC 通道。
4. **Client 打包**：上游的 tsdown preset 位於 monorepo 內部，本插件用 rolldown + lightningcss 產生相同的 `window.__ModuleLoader__.load({ id, factory })` 形態，CSS Modules 以 `<style data-plugin data-plugin-css>` 注入，與 rc.5 官方 client 包一致。

完整比對見交付報告中的上游規範核對表。

## 6. 開發與測試

```bash
pnpm install
pnpm run typecheck
BEAD_ATLAS_TEST_PYTHON=/path/to/python pnpm test   # Vitest：Host 走真實 Python；Client 在 jsdom
python -m unittest discover -s tests -v              # 原有 Python 測試 + SkillPay ZIP 排除檢查
pnpm run build && npm pack --dry-run                 # 檢查打包內容
```

Host 測試用 `dsh-plugin/tests/helpers/node-subprocess.ts`（以 `child_process` 實作的測試替身）跑真實的 `convert.py`；只有本機沒有的環境（找不到 Python、版本過舊、缺 Pillow、引擎沒寫出檔案）用模擬，測試名稱有標明。Client 測試用 `dsh-plugin/tests/shims/primitives.tsx` 代替 DSH 的 Button / Modal，真正的元件只在 DSH 內出現。

SkillPay ZIP（`scripts/package.py`）用明確清單打包，不含 `dsh-plugin/`、`package.json`、`node_modules/`、`locale/`；`tests/test_skillpay_package.py` 會檢查這一點。

## 7. 已知限制

1. 下載由瀏覽器處理，存到瀏覽器的下載位置；尚未接 DSH 原生的「選擇資料夾」。
2. 圖形介面不能新增或修改自訂色群預設、覆寫色值或新增色號；這些仍用命令列（見 README）。介面可以選用已存在的預設。
3. 一次只能跑一個轉換。
4. 任務 id 中的時間是 UTC。
5. GIF 只轉第一幀。
6. 插件不會安裝 Python 或 Pillow，也不會改動系統套件。
