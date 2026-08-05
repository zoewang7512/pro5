# 驗證報告

## 摘要

- 任務：TASK-002 環境變數與金鑰設定
- 結果：通過
- 驗證者：實作 agent（Claude Code）+ `security-reviewer` 子代理

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `git check-ignore -v .env.example` | 通過 | 修正前該檔案曾被 `.env.*` 萬用規則誤擋（見審查發現），修正後正確判定為「未被忽略」 |
| `npm run build`（無 `.env.local`） | 通過 | 目前尚無任何程式碼讀取這些環境變數（讀取邏輯屬 TASK-003），build 正常完成，不受影響 |
| `bash scripts/check-governance.sh` | 通過 | 治理結構未受影響 |
| security-reviewer 子代理審查 `.env.example`／`.gitignore`／README | 通過 | 掃描過 repo 內所有 git 可見檔案，未發現任何真實金鑰或憑證字串（JWT、`sk-`、`AKIA`、`ghp_`、PEM 區塊、supabase.co 網域等樣式皆無命中） |

## UI 證據

不適用（本任務無 UI 變更）。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 既有的 `.env.*` 萬用忽略規則會連 `.env.example` 本身都一併忽略，導致範本檔案永遠無法進版控，違反本任務目標 | 高 | 已修復：在 `.gitignore` 加入 `!.env.example` 例外規則，並以 `git check-ignore -v` 驗證修復後 `.env.local`／`.env.production` 等仍正確被忽略，`.env.example` 正確可被追蹤 |
| `.gitignore` 缺少其他常見金鑰載體樣式（`.envrc`、`*.pem`、`*.key`、`*.p12`、`secrets.json`、`service-account*.json`） | 低 | 已修復：補上對應規則 |
| `.claude/settings.local.json` 只被使用者的全域 gitignore 排除，本 repo 的 `.gitignore` 沒有排除，其他協作者的 repo clone 可能不小心把它 commit 進去 | 低 | 已修復：加入 repo 的 `.gitignore` |
| README 宣稱「anon key 受 RLS 規則限制」，但 RLS 尚未實際建立（屬 TASK-003 範圍） | 低（文件準確性） | 記錄為 TASK-003 的明確驗收標準（見 `ai/artifacts/專案設置/task-cards/TASK-003.md` 更新），不在本卡修復範圍內 |

## 殘留風險

- CI 尚未加入自動化 secret scanning（如 gitleaks/trufflehog）；目前僅靠人工複查與本次子代理掃描。屬於 CI pipeline 層級的加強項目，超出本張「環境變數與金鑰設定」任務卡範圍，建議另立任務卡評估。
- Email 服務商尚未選定，`EMAIL_API_KEY` 目前為通用佔位名稱，選定後可能需要改名（如 `RESEND_API_KEY`），屆時在對應 Epic 任務卡中更新即可，影響範圍小。
