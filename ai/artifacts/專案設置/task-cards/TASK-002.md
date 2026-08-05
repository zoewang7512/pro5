# AI-Ready 任務卡

## Metadata

- 任務：環境變數與金鑰設定
- 上層規格：無（Epic 0 基礎工程）
- 上層 Epic：專案設置
- 上層 User Story：環境變數與金鑰設定
- 分軌：不適用
- 前置任務（dependsOn）：無
- 狀態：就緒
- 風險等級：高
- Agent owner：待指定
- 人工核准者：待指定

## 目標

建立 `.env.example` 與金鑰存放規範，涵蓋 Supabase 連線資訊與 Email 服務金鑰，確保任何真實金鑰都不進版控，並記錄正式環境金鑰的存放位置（Vercel 環境變數）。

## 情境包（Context Pack）

- 相關檔案：
  - `.env.example`（新建）、`.gitignore`（確認已排除 `.env*.local`）、README 金鑰設定說明章節。
- 既有模式：
  - 無（全新專案）。
- 假設：
  - Supabase 需要 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。
  - Email 服務金鑰名稱視 TASK-003／通知功能實作時選定的服務商而定，先預留 `EMAIL_API_KEY`（或 SMTP 相關變數）佔位。
- 未知事項：
  - 尚未選定 Email 寄送服務商（於「Email 通知與提醒」Epic 實作時決定）。
- 允許變更的檔案：
  - `.env.example`、`.gitignore`、README。
- 不得觸碰：
  - 任何含真實金鑰的檔案內容（不得建立、不得提交）。

## 需求

- 列出目前已知所需的環境變數並建立 `.env.example`（僅佔位，不含真實值）。
- 確認 `.gitignore` 已排除本機環境變數檔案。
- README 記錄「真實金鑰只存在 Vercel 專案的環境變數設定，不進版控」的規範與各變數用途說明。

## 驗收標準

- repo 內不存在任何真實金鑰或密鑰值。
- `.env.example` 存在，且涵蓋 Supabase 與 Email 服務所需變數（以佔位字串呈現）。
- README 有金鑰設定與存放規範說明。
- `git log` 中不含任何金鑰字串（若有疑慮需人工複查）。

## 實作備註

- 高風險項目，實作前後都要對照 `ai/checklists/security-checklist.md`。

## 驗證契約

- 單元測試：不適用。
- 整合測試：不適用。
- E2E 測試：不適用。
- 型別檢查：不適用。
- Lint：不適用。
- Build：確認缺少 `.env.local` 時 build 仍可完成（或明確報錯提示需設定環境變數，不可靜默失敗洩漏行為）。
- 螢幕截圖：不適用。
- 安全性檢查：`ai/checklists/security-checklist.md` 逐項確認；人工複查 diff 確認無金鑰洩漏。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：不適用。
- 已知限制：待實作後填寫。
- 後續任務：TASK-003（將實際使用這些環境變數連接 Supabase）。
