---
name: ymzz-bead-atlas
description: "晏銘湛箴_拼豆圖譜（YMZZ Bead Atlas）。把 JPG、PNG、WebP、BMP、GIF 圖片轉成可直接製作的多品牌拼豆圖紙：逐格讀取來源 RGB 與 #RRGGBB，以 CIEDE2000 色差對應 MARD、Hama、Perler、Artkal、Nabbi、Yant、Diamond Dotz 等 15 個品牌共 2093 個色號，輸出帶色號的 PNG/SVG 圖紙、效果預覽、逐格座標與 ΔE00、逐色顆數與備損採購清單。支援使用者依實體色卡覆寫預設色值、新增自訂色，並把自己的色群存成具名預設（默認1、默認2 或自訂名稱）重複使用。適用於圖片轉拼豆、像素畫轉色號、HEX 查色卡、拼豆備料與成本估算。不適用於保證實物零色差、跨品牌色號互通，或在未接服務端時宣稱已完成付費扣款。"
metadata:
  version: "1.0.0"
  author: "晏銘湛箴 / YanMing Cao"
  license: MIT
  category: 圖像與圖紙生成
  tags: ["perler-beads", "mard", "hama", "perler", "artkal", "color-matching", "pattern", "material-list"]
---

# YMZZ Bead Atlas · 晏銘湛箴_拼豆圖譜

把一張圖片轉成能逐格製作、能逐格核色、能直接備料的拼豆圖紙。全程在本機完成，不上傳圖片，不含任何帳號、金鑰或付費邏輯。

## 1. 需要什麼

1. Python 3.10 以上，與唯一執行期相依 Pillow。
2. 安裝：`python -m pip install -r requirements.txt`（在 Skill 根目錄執行）。
3. 不需要 Node、瀏覽器外掛、API Key、網路或付費帳號。

## 2. 一鍵轉換

```bash
python scripts/convert.py "圖片絕對路徑" --output "輸出資料夾絕對路徑"
```

預設使用 MARD 221 色系的完整 MARD 色卡（291 色）、48 格寬、最多 32 色。

自訂品牌與參數：

```bash
python scripts/convert.py "圖片絕對路徑" --output "輸出資料夾絕對路徑" --brand hama --width 64 --max-colors 24 --bead-mm 5 --pack-size 1000 --spare-percent 10
```

查詢可用品牌與色數：

```bash
python scripts/convert.py --list-brands
```

## 3. 色卡與品牌

1. 內建 15 個品牌色卡，共 2093 色，每個色號都標明所屬品牌、豆徑與色系。
2. 色卡資料來自社群對實物豆的取樣平均，只作螢幕參考；實物批次、材質、透光與熨燙都會造成色差。
3. 使用者手上的實體色卡與資料庫不一致時，以使用者的色卡為準，不要用資料庫值否定使用者的實測值。

## 4. 使用者自訂色卡

1. 覆寫單一色號的色值：`--override A1=#FAF5CD`，可重複參數。
2. 新增自訂色號：`--extra-color X1=#FF7AB0|我的粉`，可重複參數。
3. 載入整份自訂色群：`--palette-file /路徑/我的色卡.csv`，欄位為 `代號,名稱,R,G,B`。
4. 存成具名預設，供之後重複使用：

```bash
python scripts/convert.py --save-preset "默認1" --brand mard --override A1=#FAF5CD --extra-color X1=#FF7AB0|我的粉
```

5. 預設檔存放在 `scripts/presets/<名稱>.json`，可直接編輯或交給使用者自行維護。
6. 使用預設：`--preset "默認1"`；查詢既有預設：`python scripts/convert.py --list-presets`。
7. 套用預設後，材料清單與圖紙會標示哪些色號來自使用者覆寫，來源欄位為 `user`。

## 5. 交付檔案

1. `pattern.png`：逐格標示色號的製作圖。
2. `pattern.svg`：可無損放大與列印的向量圖。
3. `preview.png`：按該品牌參考色生成的效果預覽。
4. `materials.csv`：品牌、色號、名稱、參考 HEX、來源、顆數、比例、備損、採購顆數、估算包數。
5. `coordinates.csv`：逐格來源 HEX、來源 RGB、品牌、色號、參考 HEX、ΔE00。
6. `usage.json`：品牌與資料來源、套用的預設、覆寫與新增色、網格、總豆數、空格數、色數、底板數、ΔE00 統計。
7. `report.md`：可直接閱讀的製作報告。

## 6. 回覆使用者時必須說明

1. 網格尺寸、實際用豆數、空格數、使用色數、預估成品尺寸、底板數與輸出路徑。
2. 使用了哪個品牌色卡、套用了哪個預設、有哪些顏色是使用者自己覆寫的。
3. HEX 是螢幕參考值，購買前以實體色卡核對；ΔE00 越小代表螢幕參考色越接近，不代表實物材質相同。
4. 包數是按每色獨立同規格估算，不代表任何店鋪的庫存、售價或販售組合。

## 7. 邊界與異常

1. 圖片無法解碼、全部透明、參數超出範圍、輸出資料夾已有內容時，停止並回報具體原因，不產生無效交付物。
2. 輸出資料夾已有內容必須換新資料夾，或由使用者明確同意後加 `--overwrite`。
3. 缺少 Pillow 時先取得使用者同意再安裝，不擅自改動系統環境。
4. 不臆造色號、顆數、色差或付費狀態。
