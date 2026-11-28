# 變更紀錄 / Changelog

這份文件記錄 YMZZ Bead Atlas（晏銘湛箴_拼豆圖譜）每個版本做了什麼。Python Skill（`scripts/convert.py`、色卡、`brands.json`、presets）與 SkillPay ZIP 在這些版本中**沒有修改**；SkillPay ZIP 的 `content_sha256` 維持 `ca028db2d6d0827095edb305e532b6b1583e569175bf276e1259835ec6df4c54`。

## 0.1.0 — DSH 原生 GUI 插件（PR #2）

把原本需要敲命令的 Skill，加上一個可以安裝在 DeepSeek Harness（DSH）裡的圖形化插件，npm 套件名 `@ymzz/bead-atlas`。

### 新增
1. **DSH 插件包**：同一個套件兼任 DSH bundle（`dsh-plugin/cordis.patch.yml`）與插件（Host + Client）。左側導航「拼豆圖譜」與主面板共用 panel id `bead-atlas`。支援 DSH 0.2.2-rc.5 以上、0.3 以下。
2. **Host（本機服務）**：偵測 Python ≥ 3.10、Pillow ≥ 12.1 與引擎檔案；驗證圖片（格式魔數、15 MB、單邊 12000 px、4000 萬像素）；每個任務獨立資料夾；用 DSH 的 subprocess 服務以明確 argv 執行 `convert.py`（不經 shell、逾時 120 秒、輸出上限、可取消）；任務紀錄與設定存在 `$DSH_HOME/bead-atlas/`；所有端點只給本機擁有者使用。
3. **Client（介面）**：選圖／拖入 → 設定 → 生成 → 預覽（效果圖、逐格圖紙、SVG、原圖）→ 下載 7 種檔案；任務紀錄可查看、重新生成、確認後刪除；繁中／英文；淺色與深色（文潤 雲箋／暮靄）；窄視窗可用。
4. **互動圖紙**：Canvas 2D 分層繪製，數萬格仍流暢；懸停的格子原位浮起（無粒子、無發光、支援減少動態效果）；同色號聯動高亮並顯示色號、HEX、總顆數；透明處以棋盤格標示「空背景（不放豆）」且不計入用豆；從 Python 引擎讀出的品牌色卡挑色，單格或同色號替換，材料表即時更新，可復原；「以改色重新生成圖紙」把改色網格交回原引擎產生全部 7 個檔案（新任務，原任務不變）。
5. **文件**：README 第 8 節完整使用教程與常見問題；`docs/DSH-PLUGIN.md` 技術說明；本 CHANGELOG。
6. **測試**：Host 測試走真實 Python；Client 測試在 jsdom；新增 SkillPay ZIP 不含插件檔案的 Python 測試。

### 修正（PR #2 自動審查的 7 條）
1. 並發建立任務時可能同時啟動兩個 Python：改為在第一個 `await` 前佔住唯一名額。
2. Pillow 低於 12.1 時要到生成才失敗：改為環境檢查就判為未就緒並顯示升級命令。
3. 讀圖失敗會卡在「提交中」：改為重置狀態並顯示錯誤。
4. 取消請求失敗後取消鈕永久停用：改為恢復可按並提示錯誤。
5. 查詢狀態偶發失敗就停止追蹤：改為保留進行中狀態並有限次重試，超過上限提供「繼續追蹤」。
6. 自訂色群名稱限制比 Python 嚴格：改為與 `convert.py` 相同規則（允許 `+`、超過 40 字元）。
7. 換圖解碼期間可能送出舊圖：改為立即切換並標記解碼中，解碼完成前不能生成。

### 與 DSH 上游規範的相容處理
- DSH 0.2.2-rc.5 的 `connection.rpc.handle` 在插件內呼叫會失敗（上游 master 已修），插件改掛同格式的 webServer 路由，並保留登入與擁有者檢查。詳見 `docs/DSH-PLUGIN.md` 第 5 節。

### 尚未驗證
- DSH 桌面版、macOS、Windows；DSH 0.2.3 系列；從 npm 安裝（發佈後才能驗證）。
