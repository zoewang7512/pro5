# 功能規格書

## Metadata

- 功能：設計師登入與帳號安全（對應 `tools/kanban/epics.json` 已登記的同名 Epic，已依人工
  要求擴增 MFA／改 email／大頭貼／密碼強度計量條，新增第四個 User Story「設定雙重驗證
  （MFA）」）
- 負責人：待指定
- 狀態：草稿（待人工核准）
- 風險等級：高（身分驗證與帳號安全相關變更，涉及密碼重設信、密碼變更、登入 email 變更、
  MFA 登入流程；`admins` 表刻意零 RLS policy 的既有安全設計需要新增 SECURITY DEFINER RPC
  才能讓管理員自行更新個人資料，屬於高風險項目，需架構、安全性、測試三方審查）
- 已與人工確認的範圍決策：
  - 登入頁（`app/login/login-form.tsx`）目前是純 inline style，尚未套用既有 MUI design
    system；本批次**一併**把登入頁改套用 design system，與新增的忘記密碼／重設密碼／帳號
    設定畫面風格一致。
  - 「修改密碼／個人資料」範圍擴增為：密碼、**登入 email**、顯示名稱、**大頭貼圖片**皆可
    修改；密碼相關表單（重設密碼頁、帳號設定頁）皆加入**密碼強度計量條**。
  - 新增 MFA（雙重驗證）：只做 **TOTP**（Authenticator App，Supabase Auth 內建原生支援，
    不需簡訊服務商）；MFA 為**選用**（設計師自行決定是否啟用，登入流程未啟用時不變）。
  - 大頭貼圖片存放於**新增的獨立 Storage bucket**（暫定 `admin-assets`），與「商店基本資料
    設定」Epic 的 `store-assets`（顧客可見的公開品牌資訊）職責分離。

## 問題

- 設計師登入／登出功能已存在（TASK-003 建立 `admins` 表與 `is_admin()`，後續任務建立
  `app/login/`、`app/admin/logout-button.tsx`），但：
  - 忘記密碼時完全沒有自助重設機制，只能請工程人員直接在 Supabase Dashboard 手動處理。
  - 沒有任何介面可以修改密碼、登入 email、顯示名稱或大頭貼（目前 `admins` 表只有
    `user_id`，後台 Sidebar 也只顯示固定文字「理髮廳後台」，看不出「目前是誰登入」）。
  - 帳號只靠一組帳密保護，遺失或外洩密碼即完全失守，沒有第二層驗證機制。
  - 登入頁沿用專案最早期（design system 定案前）的純 inline style 寫法，與後續所有後台
    頁面的視覺風格不一致。

## 使用者

- 設計師（唯一登入帳號）：直接使用者，登入／登出、忘記密碼時自助重設、修改密碼／email／
  顯示名稱／大頭貼、啟用或停用 MFA。

## 目標

- 登入頁套用既有 design system，與後台其他頁面視覺一致。
- 設計師忘記密碼時，能透過登入頁的連結自助觸發重設信、透過信件連結設定新密碼，不需要
  工程人員介入。
- 設計師登入後能在「帳號設定」頁修改密碼（含強度提示）、登入 email、顯示名稱、大頭貼。
- 設計師能自行啟用／停用 TOTP 雙重驗證；啟用後登入需額外完成 TOTP 驗證才能進入後台。
- 後台介面（Sidebar）顯示目前登入設計師的顯示名稱與大頭貼（未設定時有合理預設）。

## 非目標

- **SMS 簡訊雙重驗證**——已與人工確認，只做 TOTP；SMS 需另外申請簡訊服務商（如
  Twilio）並產生費用，`.env.example` 目前也無相關金鑰欄位，不在本批次範圍。
- **強制要求所有登入都啟用 MFA**——已與人工確認為選用，設計師可自行決定是否啟用；不做
  「首次登入強制註冊 MFA」的流程。
- **MFA 遺失裝置的自助復原機制（備用碼／recovery codes）**——Supabase Auth TOTP 的用戶端
  API 沒有內建「一次性備用碼」產生機制；若設計師遺失驗證裝置且已登出，需要工程人員透過
  Supabase Dashboard／service role 手動移除該 MFA factor 才能恢復登入。本批次不自建一套
  備用碼系統增加範圍與攻擊面，此為已知且可接受的限制（見「安全性與隱私」）。
- **多組管理員帳號／角色權限分級**——沿用本專案「僅一位設計師帳號」的既有假設
  （`is_admin()` 判斷邏輯不變），不新增角色系統。
- **登入 email 變更以外的其他 Supabase Auth 進階設定**（例如自訂 email 樣板、變更 Auth
  provider）——沿用 Supabase 專案既有預設設定。
- **登入失敗鎖定／速率限制／可疑登入通知**——沿用 Supabase Auth 內建的預設保護機制，本批次
  不另外實作應用層的鎖定或通知邏輯。
- **頭像圖片裁切／編輯工具**——比照「商店基本資料設定」Epic 對 Logo／封面圖的既有決策，
  上傳的圖片直接使用，不提供裁切、旋轉等編輯功能。

## 使用者故事（User Stories）

| 故事 | 身為／我想要／以便 | 驗收標準 |
|---|---|---|
| 設計師登入／登出 | 身為設計師，我想要用帳密登入後台管理系統（若已啟用 MFA 則額外完成 TOTP 驗證），並可登出 | 登入頁改套用 design system；帳密正確且未啟用 MFA 時直接進入後台；帳密正確且已啟用 MFA 時進入 TOTP 驗證步驟，驗證碼正確才進入後台，錯誤則顯示錯誤提示且不進入後台；登出行為維持既有實作不變 |
| 忘記密碼／重設密碼 | 身為設計師，我想要在忘記密碼時能自行透過 email 重設密碼，以便不需要等待工程人員協助就能重新登入 | 登入頁有「忘記密碼？」連結；輸入 email 後系統寄送重設密碼信（不論該 email 是否存在都顯示相同成功訊息）；點擊信件連結進入重設密碼頁，輸入並確認新密碼（含強度計量條）後可用新密碼登入；重設連結逾時或已使用時有明確錯誤提示 |
| 修改密碼／個人資料 | 身為設計師，我想要登入後自行修改密碼、登入 email、顯示名稱與大頭貼，以便帳號安全自主管理、後台介面顯示可辨識的個人資訊 | 後台「帳號設定」頁可修改密碼（需輸入目前密碼＋新密碼＋確認新密碼，含強度計量條）；可修改登入 email（依 Supabase Auth 既有確認機制）；可修改顯示名稱；可上傳／更換／移除大頭貼；後台 Sidebar 顯示目前設計師的顯示名稱與大頭貼（未設定時顯示合理預設） |
| 設定雙重驗證（MFA） | 身為設計師，我想要能自行啟用或停用以 Authenticator App 為基礎的 TOTP 雙重驗證，以便在密碼外多一層帳號保護 | 帳號設定頁可啟動 MFA 註冊流程（顯示 QR Code／密鑰，輸入 App 產生的驗證碼確認完成註冊）；註冊完成後登入需額外通過 TOTP 驗證；已啟用時可停用 MFA（需再次密碼或 TOTP 驗證身分）；停用後登入流程恢復僅需帳密 |

## 使用者旅程

```text
旅程一：忘記密碼
身為設計師，我某天忘記了後台密碼，以便不用打電話請工程人員幫我重設，我可以自己在幾分鐘內
恢復登入。我打開登入頁，點擊「忘記密碼？」，輸入我的 email 並送出，畫面顯示「若此 email
存在，重設信已寄出」。我到信箱點開重設密碼信裡的連結，進入重設密碼頁，輸入兩次新密碼（畫面
即時顯示密碼強度）並送出，畫面顯示密碼已重設成功，導回登入頁。我用新密碼登入成功。

旅程二：啟用 MFA 並修改個人資料
身為設計師，我想讓帳號更安全，也想讓後台看起來更像「我的」後台。我登入後點「帳號設定」，
先把顯示名稱改成我的名字、上傳一張大頭貼，Sidebar 立即顯示「Alex」與頭像。接著我點「啟用
雙重驗證」，畫面顯示一組 QR Code，我用手機 Authenticator App 掃描後輸入 App 顯示的 6 位數
驗證碼，確認完成註冊。下次登入時，輸入帳密後畫面多問我一次 App 上的驗證碼，輸入正確才真正
進入後台。
```

## 功能需求

使用可測試的語言撰寫。

### 忘記密碼／重設密碼

- WHEN 未登入使用者在登入頁點擊「忘記密碼？」並輸入 email 送出 THE SYSTEM SHALL 呼叫
  Supabase Auth 內建的重設密碼信機制（`resetPasswordForEmail`，`redirectTo` 指向本站
  `/reset-password`），不論該 email 是否對應既有帳號，皆顯示相同的成功提示文案。
- WHEN 使用者點擊重設密碼信中的連結 THE SYSTEM SHALL 導向 `/reset-password` 頁，若連結
  有效則顯示新密碼輸入表單（新密碼＋確認新密碼＋密碼強度計量條），若連結已逾時或已被
  使用則顯示明確錯誤提示與「重新申請」連結。
- WHEN 使用者在 `/reset-password` 頁輸入新密碼並確認一致、符合密碼格式規則後送出
  THE SYSTEM SHALL 呼叫 `updateUser({ password })` 更新密碼，成功後顯示成功提示並導回
  登入頁。

### 登入（含 MFA 條件分支）

- WHEN 使用者在登入頁輸入正確帳密送出 AND 該帳號尚未啟用 MFA THE SYSTEM SHALL 直接完成
  登入並導向 `/admin`（既有行為不變）。
- WHEN 使用者在登入頁輸入正確帳密送出 AND 該帳號已啟用 MFA THE SYSTEM SHALL 顯示 TOTP
  驗證碼輸入畫面，輸入正確的 6 位數驗證碼後才完成登入並導向 `/admin`；驗證碼錯誤時顯示
  錯誤提示，不導向 `/admin`，允許重新輸入。
- WHEN 使用者在登入頁輸入錯誤帳密 THE SYSTEM SHALL 顯示既有錯誤提示，不進入 MFA 驗證步驟
  （既有行為不變）。

### 修改密碼／個人資料

- WHEN 已登入設計師在「帳號設定」頁輸入目前密碼、新密碼與確認新密碼並送出
  THE SYSTEM SHALL 即時顯示新密碼的強度計量（弱／中／強，依長度與字元組合計算），驗證
  新密碼與確認密碼一致、符合密碼格式規則，通過後更新密碼，成功後顯示成功提示；目前密碼
  錯誤時顯示對應錯誤，不更新密碼。
- WHEN 已登入設計師在「帳號設定」頁修改登入 email 並送出 THE SYSTEM SHALL 呼叫
  `updateUser({ email })`，沿用 Supabase 專案既有的 email 變更確認機制（可能為新／舊
  email 皆需點擊確認連結），送出後顯示「請至新信箱完成確認」的待確認狀態提示，變更在
  完成確認前不生效（登入 email 維持原值）。
- WHEN 已登入設計師在「帳號設定」頁編輯顯示名稱並送出 THE SYSTEM SHALL 驗證非純空白，
  通過後更新 `admins.display_name`，成功後顯示成功提示、Sidebar 即時反映新名稱。
- WHEN 已登入設計師上傳大頭貼圖片 THE SYSTEM SHALL 驗證檔案格式（jpg／png／webp）與大小
  上限（比照 `store-assets` 既有慣例，5MB），通過後上傳至 `admin-assets` bucket 並更新
  `admins.avatar_url`，顯示上傳後的預覽；格式或大小不符時顯示對應錯誤訊息。
- WHEN 已登入設計師移除大頭貼 THE SYSTEM SHALL 清空 `admins.avatar_url`，Sidebar 回退為
  預設頭像樣式（例如姓名縮寫或預設圖示）。
- WHEN 後台任何頁面渲染 Sidebar THE SYSTEM SHALL 顯示目前登入設計師的顯示名稱與大頭貼；
  兩者未設定時顯示合理預設（顯示名稱預設文字、大頭貼預設圖示），不顯示空白或錯誤。

### MFA 註冊與停用

- WHEN 已登入設計師在「帳號設定」頁點擊「啟用雙重驗證」 THE SYSTEM SHALL 呼叫 Supabase
  Auth `mfa.enroll()`（TOTP factor），顯示 QR Code 與可手動輸入的密鑰文字，並提供驗證碼
  輸入欄位。
- WHEN 已登入設計師輸入 Authenticator App 產生的驗證碼確認註冊 THE SYSTEM SHALL 呼叫
  `mfa.challenge()`／`mfa.verify()` 驗證該驗證碼，成功後該 MFA factor 轉為已驗證狀態，
  帳號設定頁顯示「雙重驗證已啟用」，之後登入需通過 TOTP 驗證；驗證碼錯誤時顯示錯誤提示，
  允許重新輸入或取消整個註冊流程（取消時移除尚未完成驗證的 factor，不留下半成品狀態）。
- WHEN 已啟用 MFA 的設計師在「帳號設定」頁點擊「停用雙重驗證」 THE SYSTEM SHALL 要求再次
  輸入目前密碼或當前有效的 TOTP 驗證碼確認身分，通過後移除該 MFA factor，之後登入恢復
  僅需帳密。
- WHEN 非管理員（含 anon 與已登入但非 `is_admin()` 的 authenticated 使用者）嘗試呼叫更新
  `admins.display_name`／`admins.avatar_url` 的機制 THE SYSTEM SHALL 拒絕該操作。

## 畫面

| 畫面 | 狀態 | 備註 |
|---|---|---|
| 登入頁（既有 `app/login/`，本批次改套用 design system） | 預設、輸入中、登入中、登入失敗（帳密錯誤）、含「忘記密碼？」連結、**MFA 驗證步驟**（帳密正確且已啟用 MFA 時顯示） | 走 `ui-mockup-gate`；MFA 驗證步驟是登入頁內的第二階段，不是獨立路由 |
| 忘記密碼頁（新畫面，暫定登入頁內模式切換或獨立路由，實作階段依 mockup 決定） | 預設（輸入 email）、送出中、送出成功（不論 email 是否存在皆同一訊息） | 走 `ui-mockup-gate` |
| 重設密碼頁（新頁面，暫定 `/reset-password`） | 連結有效（輸入新密碼表單＋強度計量條）、驗證錯誤、送出中、送出成功、連結已逾時／已使用 | 走 `ui-mockup-gate` |
| 帳號設定頁（後台新頁面，暫定 `/admin/account`） | 載入中、預設（密碼／email／顯示名稱／大頭貼／MFA 五個區塊）、密碼修改驗證錯誤（含強度計量條）、email 修改待確認、顯示名稱驗證錯誤、大頭貼上傳中／上傳錯誤、MFA 註冊中（QR Code＋驗證碼輸入）、MFA 已啟用、MFA 停用確認、儲存中、儲存成功 | 走 `ui-mockup-gate`，沿用既有後台頁面骨架模式；狀態較多，mockup 需完整覆蓋五個區塊各自的狀態組合 |
| 後台 Sidebar（既有 `components/ui/Sidebar.tsx`／`AdminShell.tsx`） | 顯示名稱／大頭貼已設定、皆未設定（預設） | 既有元件新增顯示登入者名稱與大頭貼的區塊，不大幅改版既有 Sidebar 版面 |

## 資料與 API

- 輸入：
  - `admins` 資料表新增欄位（新 migration，暫定 `0007_admin_profile.sql`，接續目前實際
    存在的最大編號 `0006`；`0005` 已被另一張規劃中但尚未核准實作的任務卡預留，本次不使用
    該編號避免衝突）：
    - `display_name text`（選填，`null` 代表未設定）
    - `avatar_url text`（選填，`null` 代表未設定，僅接受 `admin-assets` bucket 底下的網址）
  - 新增 Supabase Storage public bucket `admin-assets`（比照 `store-assets` 既有模式：
    `file_size_limit`／`allowed_mime_types` 限制、只有 `is_admin()` 可寫入，公開讀取）。
  - 密碼變更／重設、email 變更、MFA 註冊／驗證／移除皆透過 Supabase Auth 內建 API
    （`resetPasswordForEmail`／`updateUser`／`mfa.enroll`／`mfa.challenge`／`mfa.verify`／
    `mfa.unenroll`），不自建密碼儲存、email 驗證或 TOTP 秘鑰產生邏輯。
- 輸出：
  - Sidebar／帳號設定頁讀取目前登入使用者的 `admins.display_name`／`admins.avatar_url`。
  - 帳號設定頁讀取目前登入使用者的 MFA factor 清單（`mfa.listFactors()`）判斷是否已啟用。
- 驗證：
  - 新密碼長度與格式規則沿用 Supabase Auth 預設密碼原則，前端另加強度計量提示（依長度、
    是否混合大小寫／數字／符號計算，純視覺提示，不阻擋通過 Supabase 本身密碼規則的送出）。
  - 顯示名稱：trim 後長度需 > 0 才允許儲存，長度上限（例如 50 字）。
  - 大頭貼：格式限制 jpg／png／webp，大小上限 5MB，比照 `store-assets` 既有規則。
  - TOTP 驗證碼：6 位數字，交由 Supabase Auth `mfa.verify()` 驗證正確性，本專案不自行
    實作 TOTP 演算法。
- 錯誤：
  - Supabase Auth 錯誤（帳密錯誤、連結逾時、驗證碼錯誤等）轉換為使用者可理解的中文提示，
    不直接顯示原始英文錯誤訊息。

## 安全性與隱私

- 身分驗證：忘記密碼／重設密碼、email 變更、MFA 註冊與驗證皆走 Supabase Auth 內建機制，
  不自建 token 產生、TOTP 秘鑰產生或驗證邏輯；帳號設定頁沿用既有 `is_admin()` +
  authenticated 邊界。
- 權限：
  - `display_name`／`avatar_url` 的更新**不透過新增 RLS policy 直接開放 `admins` 表
    讀寫**——`admins` 表目前刻意零 policy，本批次延續此既有安全姿態，新增
    `SECURITY DEFINER` RPC（例如 `update_admin_profile(p_display_name text,
    p_avatar_url text)`），函式內部驗證 `auth.uid()` 對應的列存在才更新，不新增任何直接
    開放的 table-level policy。
  - `admin-assets` Storage bucket 政策比照 `store-assets`：只有 `is_admin()` 可寫入，
    公開讀取（大頭貼在後台介面顯示，不需要簽章 URL；雖然是「個人」圖片但非顧客個資，
    公開讀取無隱私疑慮，比照既有 Logo／封面圖的公開姿態）。
  - 【2026-08-19 修正，原判斷已證實錯誤，見下方】MFA 的登入流程檢查（是否需要 TOTP
    才能完成登入）**不能只靠應用層（登入頁 UI 流程）判斷**：TASK-044 security-reviewer
    審查發現，使用者在登入頁 MFA 驗證碼畫面單純重新整理頁面（不需任何攻擊意圖），
    `app/login/page.tsx` 的 `is_admin()` 檢查就會直接通過並導向 `/admin`，完全繞過
    尚未完成的 TOTP 驗證——這推翻了本段落原先「前端登入流程已能有效阻擋未完成 MFA
    的使用者」的假設。已與人工確認：改為在**關鍵伺服器端入口點**強制要求已啟用 MFA
    的帳號達到 `aal2`（`app/login/page.tsx` 的登入後重導向邏輯、`lib/supabase/
    middleware.ts` 的 `/admin/:path*` 路由守門、`app/admin/layout.tsx` 的頁面層檢查
    三處一致比對 `getAuthenticatorAssuranceLevel()`），**不**逐一修改個別 RLS policy／
    `admins` 表相關的 SECURITY DEFINER RPC（範圍僅止於「能不能進入 `/admin` 底下的
    頁面」這一層，不含資料庫層的 `auth.jwt()->>'aal'` 檢查，避免過度工程化單一帳號
    情境，且目前後台功能皆透過頁面層 gate 或 SECURITY DEFINER RPC 存取、沒有直接
    暴露给前端的 table-level RLS policy 需要單獨補強）。只有已啟用 MFA 的帳號才受此
    檢查影響，未啟用 MFA 的帳號登入行為不變（無 factor 可比對 aal2，沿用純密碼登入）。
    詳見 TASK-059 任務卡。
- 敏感資料：密碼與 TOTP 秘鑰完全交給 Supabase Auth 管理，不落地存在本專案資料庫；顯示
  名稱與大頭貼為低敏感度資訊，不涉及顧客個資。
- 濫用情境：
  - 忘記密碼流程不得透過回應差異洩漏「這個 email 是否對應真實帳號」，一律顯示相同成功
    文案。
  - 重設密碼連結需符合 Supabase Auth 內建的一次性使用與逾時機制，沿用專案預設值。
  - 帳號設定頁修改密碼、修改 email、停用 MFA 皆需要求再次驗證身分（目前密碼或當前有效
    TOTP），避免已登入裝置被他人趁隙修改後鎖死原帳號或關閉保護機制。
  - MFA 遺失裝置的復原僅能由工程人員透過 Supabase Dashboard／service role 手動處理（見
    「非目標」），此為已知風險，需在部署文件中記錄應變流程（例如記錄在
    `ai/context/decisions.md` 或 README，非本卡程式碼範圍，但實作階段應留意提醒）。
  - 大頭貼上傳需檢查 MIME type 與副檔名一致性、大小上限，避免上傳惡意檔案；儲存路徑使用
    固定命名（比照 `store-assets` 既有做法），避免路徑穿越。

## 驗收標準

- 登入頁套用既有 design system，視覺與後台其他頁面一致，登入/登出既有行為（未啟用 MFA
  情境）無回歸。
- 設計師可透過「忘記密碼？」連結完成完整重設密碼流程並用新密碼登入。
- 設計師登入後可在「帳號設定」頁修改密碼（含強度計量條）、登入 email（依 Supabase 確認
  機制）、顯示名稱、大頭貼。
- 設計師可啟用 TOTP MFA（QR Code 掃描＋驗證碼確認），啟用後登入需額外通過 TOTP 驗證；
  可停用 MFA（需再次身分驗證），停用後登入恢復僅需帳密。
- 後台 Sidebar 正確顯示目前登入設計師的顯示名稱與大頭貼，未設定時顯示合理預設。
- 非管理員無法呼叫更新 `display_name`／`avatar_url` 的機制，無法上傳至 `admin-assets`。
- 既有測試（`test:rls`／`test:booking`／`test:admin-booking`／`test:business-hours`／
  `test:store-settings`）重跑無回歸；既有登入/登出流程（未啟用 MFA）不受影響。

## 驗證計畫

- 單元測試：密碼格式／顯示名稱／大頭貼格式驗證純函式；密碼強度計量的計算邏輯。
- 整合測試：對真實 Supabase 專案驗證 `update_admin_profile` RPC 與 `admin-assets`
  Storage bucket 的權限邊界（非管理員呼叫／上傳被拒、管理員可成功更新／上傳）；MFA
  factor 的建立/驗證/移除呼叫的權限邊界（僅本人可操作自己的 factor，這是 Supabase Auth
  內建保證，測試層級驗證呼叫本身正常運作）。忘記密碼／email 變更涉及真實寄信，不易在
  自動化整合測試中完整模擬，實作階段決定驗證深度。
- E2E：Browser 工具走查登入頁改版、帳號設定頁五個區塊（密碼／email／顯示名稱／大頭貼／
  MFA）的修改流程、Sidebar 即時反映變更、MFA 啟用後登入流程需額外驗證步驟。
- 視覺：登入頁（含 MFA 驗證步驟）、忘記密碼頁、重設密碼頁、帳號設定頁的畫面狀態表，比照
  `design-craft` 檢查表。
- 手動：確認忘記密碼與 email 變更流程的實際收信與連結可用性（至少各一次真實 email
  收發驗證）；至少一次使用真實 Authenticator App（例如 Google Authenticator）完成 MFA
  註冊與登入驗證的手動走查。
