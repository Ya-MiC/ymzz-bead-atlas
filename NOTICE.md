# 第三方来源与许可

## 1. 色卡数据

来源项目：https://github.com/maxcleme/beadcolors
固定提交：`f97ff4283d03cef5cd7e1071a86f5892e0c0c61b`
许可：MIT，版权属于 maxcleme。

MIT License

Copyright (c) 2020 maxcleme

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

色卡檔案與 SHA-256：

| 檔案 | 品牌 | 色數 | SHA-256 |
|---|---|---:|---|
| mard.csv | MARD | 291 | `108a0118bc209e4a74fbfc2433c20a3b8ac6e8b91be0bbd412a1636ee05fb12b` |
| hama.csv | Hama Midi | 92 | `878ba9aa8bfb9da57b99dd4f524d757b8e165bd9d14fdb0e59831a5cbbb9c5de` |
| hama_mini.csv | Hama Mini | 78 | `80c974402b112801ae9db14247553bb8664967daf36a416c00c82b470436fae9` |
| hama_maxi.csv | Hama Maxi | 25 | `bb825a21b56ba0b73449f9c8e130370efba7c820bc2a306e34523a770f5988c5` |
| perler.csv | Perler | 103 | `757aae3e0553ed3a74db691cf930ea3e27eed47d038c5cc74bcef71acf3d24d0` |
| perler_mini.csv | Perler Mini | 41 | `5449068ebcc13101337965139186568bd19d88b6685dfc690b88faeb8b4fd5f6` |
| perler_caps.csv | Perler Caps | 26 | `78d558dc3cb166920fabe947ce8c5d17a2dfa08c1ef39a6bfebc2ec94618bd54` |
| nabbi.csv | Nabbi | 30 | `48d317885f7cd6f3c05b20d4d595b51f3194abcaea540acf2f5786b935ffc4e2` |
| artkal_a.csv | Artkal A | 145 | `2787b18315d05c47b61883dc903328aa45ff0c3cac2dc28016b7378881657893` |
| artkal_c.csv | Artkal C | 174 | `3bceb6deb079a300c1f102265f972d98b04aef420f7c3f19ed066b6f3273915a` |
| artkal_m.csv | Artkal M | 220 | `50eb21da763607112b4a7b1c35dc922f9063a672ba554314f2ffa72598220627` |
| artkal_r.csv | Artkal R | 89 | `e83ec0089d1b360425548f8dbb58bb32e9286b722d87088810cb90d6cc545ae8` |
| artkal_s.csv | Artkal S | 199 | `490d0994e7657e24f3efaab6af47b5beefe0f50ef188f29f0ef132f9534ab4a1` |
| yant.csv | Yant | 119 | `42a337e9d9f050db55df2aa0aa7cd33b180ac6d812c11f8594395afbf41a233d` |
| diamondDotz.csv | Diamond Dotz | 461 | `c870a62bd057c976f2857c4714ff7c258617219735d21abc336779e2425c2640` |

資料格式為 `代號,名稱,R,G,B,貢獻者`。全部色值為社群對實物豆的取樣平均，是螢幕參考值，不等同廠商保證的實物顏色；使用者可用預設或覆寫調整為自己手上的色卡。

## 2. 取證工具

REA（Reverse Engineer Anything），MIT 许可，https://github.com/morluto/rea 。本次以 `rea-agents@6.7.0` 的 JavaScript 應用分析器對參考專案的線上構建產物做靜態分析，命令與結果摘要記錄於 `docs/evidence.md` 與 `docs/rea-analysis-summary.json`。

## 3. 參考專案

Jett-Wu/Perler_Beads_Generator，MIT 许可，https://github.com/Jett-Wu/Perler_Beads_Generator 。

本專案僅分析其公開構建產物以理解同類產品的做法與能力邊界，未複製其任何程式碼、演算法參數或原始檔案。YMZZ Bead Atlas 的實作、資料結構、介面與輸出格式皆為獨立撰寫。

## 4. 執行期相依

Pillow==13.0.0，HPND 授權。
