# REA 取證紀錄

## 1. 目的

建立一個新的、多品牌、可讓使用者改色值的拼豆 Skill 前，先用 REA 對同類開源產品的線上構建產物做靜態分析，取得其模組結構、資料流與能力邊界，作為產品設計的基準，而不是憑印象猜測同類產品做到哪裡。

## 2. 對象

1. 專案：Jett-Wu/Perler_Beads_Generator，MIT 授權，https://github.com/Jett-Wu/Perler_Beads_Generator
2. 線上版本：https://jett-wu.github.io/Perler_Beads_Generator/
3. 分析對象：線上部署的已建置模組 `src/main.js`、`src/App.js`、`src/WorkspaceCanvas.js`、`src/ThreePreview.js`、`src/imageToBeads.js`、`src/exporters.js`、`src/palette.js`、`src/project.js`、`src/usage.js`、`src/types.js`。

## 3. 工具與命令

```bash
npx -y rea-agents@6.7.0 analyze-javascript-application <目標資料夾> --json
```

REA 版本 6.7.0，MIT 許可，https://github.com/morluto/rea 。

## 4. 分析結果摘要

1. 目標根產物 SHA-256：`90e14a25c729f2a3d4656849f1c113f89d08e2d1f8d569051923743fc91324d3`。
2. 統計：相關檔案 11、解析成功的 JavaScript 檔案 10、跳過 0、解析失敗 0、走訪 AST 節點 46,024、findings 101。
3. 應用程式圖：節點 75、邊 122；語意指紋圖：節點 33,231、關係 38,960。
4. Electron 邊界：瀏覽器視窗 0、preload 進入點 0、IPC 通道 0、原生綁定 0，確認該產物是純前端單頁應用，沒有桌面殼層或後端服務。
5. 靜態還原出的模組職責：`imageToBeads` 負責取樣與配色、`palette` 負責色卡與色差、`exporters` 負責 PDF/PNG/CSV/XLSX 匯出、`usage` 負責用量與孤豆檢查、`project` 負責圖層與草稿。

## 5. 從分析中確認的產品事實

1. 色卡為硬編碼於 `palette.js` 的單一 MARD 色卡，沒有可替換的外部色卡來源。
2. 色差函式為 redmean 加權 RGB 距離，非感知均勻色空間（CIEDE2000 / ΔE00）。
3. 交付形態為瀏覽器單頁應用，沒有命令列或腳本介面，無法作為 Agent 能力被安裝與批次調用。
4. 用量輸出只給顆數與包數，沒有逐格色差，無法讓使用者核對匹配可信度。
5. 互動編輯、圖層、3D 預覽與 PDF 匯出是其強項，屬於設計師工作台定位。

## 6. YMZZ Bead Atlas 的差異化決策

1. 色卡：15 品牌 2093 色，每色標明品牌、豆徑、色系。
2. 色差：CIEDE2000，並以 Sharma 2005 參考組做自檢，輸出逐格 ΔE00。
3. 使用者可改：覆寫色值、新增色號、載入整份自訂色群、存成具名預設。
4. 交付形態：Claude Skill 格式，含命令列、測試與打包腳本，可安裝進 Agent 直接呼叫。
5. 稽核：每份輸出帶品牌、資料來源、預設與覆寫記錄，可被服務端覆核。

## 7. 分析限制

REA 的分析為靜態分析，官方在結果的 limitations 中明確列出：綁定關係僅在已盤點的產物容器內解析；圖覆蓋率不完整，未解析的事實不得解讀為不存在；JavaScript 與 HTML 以惰性文字解析，從未執行 bundle 啟動程式碼；靜態匯入關係不代表執行期行為。因此本文件只把分析結果當作「結構事實」，不當作執行期行為證明。

## 8. 產出檔案

1. `docs/rea-analysis-summary.json`：摘要後的可提交證據。
2. 全量 REA 輸出體積約 59 MB，未納入版本控制。
