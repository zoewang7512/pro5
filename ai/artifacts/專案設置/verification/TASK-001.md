# 驗證報告

## 摘要

- 任務：TASK-001 技術骨架初始化
- 結果：通過
- 驗證者：實作 agent（Claude Code）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `npm install` | 通過 | 387 個套件，0 個已知漏洞 |
| `npm run lint` | 通過 | ESLint（`eslint-config-next`），無錯誤 |
| `npx tsc --noEmit` | 通過 | 型別檢查無錯誤 |
| `npm run build` | 通過 | Next.js production build 成功，`/` 與 `/_not-found` 皆為靜態預先渲染 |
| `npm test` | 通過 | Vitest，1 個 smoke test 通過（驗證測試管線可執行，尚無真實業務邏輯測試） |
| `npm run dev` + 手動請求首頁 | 通過 | `curl http://localhost:3000` 回應 200；頁面標題與內文為預期的「理髮廳線上預約系統」placeholder 內容（見下方 UI 證據） |
| `bash scripts/check-governance.sh` | 通過 | 確認治理套件既有結構未被破壞 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 桌面版 | 無法產生圖片截圖（本次連線的瀏覽器工具面板未能顯示畫面，截圖動作逾時） | 改以 `get_page_text` 取得頁面渲染後的文字內容作為佐證：標題「理髮廳線上預約系統」、內文「專案骨架初始化完成，功能將依看板任務卡逐步實作。」與預期一致 |
| 行動裝置版 | 未測試 | 目前僅為預設 placeholder 首頁，無實質版面可驗證響應式；待 UI 設計系統 S5 產出真正版面後再驗證 |

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| `next dev` 內建功能會自動在根目錄 `AGENTS.md` 尾端附加一段「agent-rules」區塊，污染治理用的 AGENTS.md | 中 | 已修復：於 `next.config.ts` 設定 `agentRules: false` 停用該功能，並將 `AGENTS.md` 還原為原始內容 |
| 螢幕截圖工具在本次連線環境下逾時，無法取得桌面/行動裝置版的圖片截圖 | 低 | 已知限制，改以 `get_page_text` 佐證渲染內容；不影響本卡驗收標準（首頁可開啟即可） |

## 殘留風險

- 尚未設定 E2E 測試框架（Playwright）：任務卡原規劃「單元測試 + E2E」，但目前專案只有一個 placeholder 首頁、沒有實際使用者流程可測，故延後到有真實頁面／流程時再引入，避免現在裝一個沒有內容可測的空殼。此決策記錄於此，供之後的任務卡或審查者知悉。
- 尚未有 `.env.example`（由 TASK-002 負責）。
- 尚未連接實際 Vercel 專案（帳號綁定需人工在 Vercel 後台操作，不在 agent 可執行範圍內）。
