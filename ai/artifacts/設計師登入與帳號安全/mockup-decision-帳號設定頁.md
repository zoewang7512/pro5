# Mockup 決策

## Metadata

- 功能：設計師登入與帳號安全
- 畫面：後台帳號設定頁（暫定 `/admin/account`）
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A | 單頁捲動，五張獨立卡片（個人資料、密碼、登入 Email、大頭貼併入個人資料卡、MFA），各自獨立儲存按鈕，比照「商店基本資料設定」Epic 已核准的卡片模式 | 與既有 `StoreSettingsForm.tsx` 模式一致，實作風險低、學習成本低；所有設定一目了然，不需切換即可看到全貌 | 五個區塊堆疊后頁面偏長，MFA 註冊（QR Code）等較重的內容會把頁面拉得更長，捲動負擔較高 |
| B | 內部分頁籤（個人資料／帳號安全／雙重驗證三個 tab），帳號安全 tab 內合併密碼與 Email 兩個子區塊 | 單一畫面高度固定，不需長捲動；三個 tab 對應三種不同的心智模型（我是誰／我怎麼登入／額外保護），資訊分組更清楚 | 需要新做 tab 版面（元件庫 inventory 目前無此模式）；密碼與 Email 合併在同一 tab，狀態組合（例如密碼區塊出錯同時 Email 待確認）視覺上需要仔細排版 |

## 設計系統對照

- 重用的 token／元件：兩變體皆由既有 token 與元件庫 inventory（Card、Button、Input、
  Modal/Dialog、ImageUploadField、Toast/Alert、Skeleton、Sidebar）組成。
- 新做並登記回 inventory 的元件：Avatar（MUI 直接使用，補登記）、OTP 驗證碼輸入（與登入
  流程畫面共用）。變體 B 額外需要 Tab 版面（本頁面專屬，暫不登記入 `components/ui/`，見
  screen-spec 說明）。

## 選定的變體

- 變體：A（單頁捲動五卡片）
- 為何選這個：人工核准變體 A。
- 實作前要求的修改：無。

## 人工核准

- 核准者：使用者
- 日期：2026-08-18
- 備註：核准變體 A（單頁捲動，五張卡片各自獨立儲存，與商店設定頁既有模式一致）。

## 實作期偏離紀錄（TASK-042）

- 偏離內容：登入 Email 卡片新增「目前密碼」輸入欄位（`mockups/account-settings-variant-a.html`
  的登入 Email 卡片原本只有單一 email 欄位）。
- 理由：TASK-042 security-reviewer 審查發現，登入 email 是忘記密碼流程的救援管道，若變更
  email 不需要任何再驗證，攻擊者只要拿到一段有效 session 就能把救援信箱換成自己的（且視
  Supabase 專案的 Secure email change 設定，舊信箱可能完全收不到通知）。原本的設計（密碼
  修改需要驗證、email 修改卻不用）防護等級與威脅嚴重度恰好相反。
- 判定：不需要退回 mockup 核准關卡重跑——這不是版面替代方案的選擇，而是安全審查驅動的
  必要欄位新增，落在已核准的「A 單頁捲動五卡片、各自獨立儲存」版型內部，未改變任何已核准
  的結構決策（architect TASK-042 審查確認此判斷）。
- 對應更新：`screen-spec-帳號設定頁.md` 的狀態表與互動表已同步補上「目前密碼」欄位與
  「目前密碼錯誤」狀態；實作見 `app/admin/_components/AccountSettingsView.tsx` 登入 Email
  卡片。

## 實作期偏離紀錄（TASK-043）

- 偏離內容：MFA 停用二次確認對話框改為輸入「目前驗證碼」（6 碼 OTP），不是
  `mockups/account-settings-variant-a.html` 狀態 4 原本畫的「目前密碼」欄位。
- 理由：任務卡情境包原先假設「輸入目前密碼」即可停用（比照 TASK-042 密碼驗證邏輯）。
  實作期對真實 Supabase 專案走查（Browser 工具，真實 TOTP 驗證碼由密鑰以標準演算法算出）
  發現：`mfa.unenroll()` 移除一個已驗證（verified）factor 時，GoTrue 伺服器端一律要求
  session 處於 aal2（回傳 422 `insufficient_aal`），`signInWithPassword` 建立的重新驗證
  session 只有 aal1，不論密碼是否正確都會被拒絕。這不是「安全性強度可取捨」的選項，而是
  純密碼驗證路徑在真實環境下 100% 無法完成停用的功能性錯誤，必須修正。改用驗證碼確認後，
  `challenge()`／`verify()` 驗證成功的同時會把 session 升級到 aal2，緊接著呼叫
  `unenroll()` 才能真正成功——已於 Browser 工具實測驗證整條路徑（含頁面重新整理後再次
  確認 Supabase 端狀態確實變回「未啟用」）。
- 判定：不需要退回 mockup 核准關卡重跑——版面本身（二次確認 Modal＋單一輸入欄位）未變，
  只是輸入欄位的驗證方式從密碼換成驗證碼，落在已核准的「A 單頁捲動五卡片」版型內部。
- 對應更新：實作見 `lib/admin/account.ts` `unenrollMfaWithCode`（含完整說明與偏離記錄的
  程式碼註解）與 `app/admin/_components/AccountSettingsView.tsx` MFA 停用對話框（改用
  `OtpInput`）。
