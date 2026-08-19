import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "./appointments";

// 帳號設定頁與 Sidebar 個人資料顯示的資料存取。admins 表刻意零 RLS policy（見
// 0001_core_schema.sql 既有註解），讀寫皆透過 0007_admin_profile.sql 建立的
// SECURITY DEFINER RPC（get_admin_profile／update_admin_profile），不直接查 admins 表。

const INTERNAL_ERROR = { message: "發生未預期的錯誤，請稍後再試。" };

export type AdminProfile = {
  displayName: string | null;
  avatarUrl: string | null;
};

// get_admin_profile() 回傳 table(display_name, avatar_url)：呼叫者非管理員（或未登入）
// 時回傳空結果集（0 筆），不是錯誤——這裡一律轉成「兩個欄位皆為 null」的 AdminProfile，
// 與「查得到但欄位未設定」的降級顯示邏輯共用同一套處理，呼叫端不需要另外分支。
export async function getAdminProfile(supabase: SupabaseClient): Promise<Result<AdminProfile>> {
  const { data, error } = await supabase.rpc("get_admin_profile");
  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { display_name: string | null; avatar_url: string | null }
    | undefined;

  return {
    ok: true,
    data: { displayName: row?.display_name ?? null, avatarUrl: row?.avatar_url ?? null },
  };
}

// Sidebar／帳號設定頁顯示大頭貼時，只信任 admin-assets bucket 底下的網址，比照
// lib/store-settings.ts trustedAssetUrl 的既有慣例（TASK-032 security-reviewer 審查發現
// 的既有防線：update_admin_profile RPC 對 avatar_url 本身不做格式限制，顯示層需要自己
// 把關，避免未來任何寫入路徑的邏輯缺陷讓頁面被導向任意外部圖片網址）。用 URL 解析比對
// origin 與 pathname 前綴，而非純字串 startsWith：純字串比對對 "…/admin-assets/../../x"
// 這類路徑沒有防護（雖然瀏覽器正規化後仍落在同一 origin，風險有上限，但用 URL 解析更
// 明確表達「同網域＋指定路徑前綴」的意圖），且能同時擋下 NEXT_PUBLIC_SUPABASE_URL 未設定
// 時退化成字面 "undefined/…" 前綴誤判通過的邊界情況（security-reviewer TASK-038 審查建議）。
export function resolveAdminAvatarUrl(url: string | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;

  try {
    const parsed = new URL(trimmed);
    const allowedOrigin = new URL(supabaseUrl).origin;
    const allowedPathPrefix = "/storage/v1/object/public/admin-assets/";
    return parsed.origin === allowedOrigin && parsed.pathname.startsWith(allowedPathPrefix) ? trimmed : null;
  } catch {
    return null;
  }
}

// Sidebar 顯示名稱未設定時的預設文字，與大頭貼預設縮寫圖示共用同一份「未設定」判斷
// （trim 後為空視為未設定，比照既有 resolveStoreDisplay 的 name.trim() 既有慣例）。
export function resolveAdminDisplayName(displayName: string | null): string {
  const trimmed = displayName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "設計師";
}

// 上限對齊 0007_admin_profile.sql 的 admins_display_name_length constraint（50 字），
// 前端先擋，資料庫層 constraint／update_admin_profile 內部驗證是最終防線（比照
// lib/store-settings.ts validateStoreName 的既有慣例：必填＋長度上限）。
const DISPLAY_NAME_MAX_LENGTH = 50;

export function validateAdminDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "顯示名稱為必填";
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) return `顯示名稱長度須在 ${DISPLAY_NAME_MAX_LENGTH} 字以內`;
  return null;
}

// update_admin_profile(p_display_name, p_avatar_url) 是單一 UPDATE 語句同時寫入兩個欄位，
// 呼叫端必須每次都帶入「想保留不變的那個欄位目前值」，不能只傳其中一個、留另一個給資料庫
// 預設值（不存在這種機制）——否則會把沒打算動的欄位意外寫成 null。displayName／avatarUrl
// 兩個參數皆刻意允許 null（對齊 admins 表本身欄位可為 null 的語意），避免把「未設定」
// 這個合法狀態強制轉成空字串再寫回去。
export async function updateAdminProfile(
  supabase: SupabaseClient,
  displayName: string | null,
  avatarUrl: string | null,
): Promise<Result<void>> {
  const { data, error } = await supabase.rpc("update_admin_profile", {
    p_display_name: displayName,
    p_avatar_url: avatarUrl,
  });

  if (error || data !== true) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: undefined };
}

// 大頭貼格式／大小限制對齊 0007_admin_profile.sql 的 admin-assets bucket 設定
// （file_size_limit=5MB、allowed_mime_types=jpg/png/webp；bucket 層是伺服器端強制的最終
// 防線，這裡只是體驗優化）。上傳路徑固定為 avatar/<uuid>.<ext>，不接受使用者輸入的檔名，
// 避免路徑穿越，也對齊 bucket policy 只允許 avatar/ 前綴的限制（比照
// lib/store-settings.ts uploadStoreImage 的既有慣例）。
const AVATAR_ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const AVATAR_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export function validateAdminAvatarFile(file: File): string | null {
  // 用 Object.hasOwn 而非 `in`：避免 file.type 恰好等於 Object.prototype 繼承屬性名稱時
  // 誤判白名單命中（比照 lib/store-settings.ts validateStoreImageFile 的既有慣例）。
  if (!Object.hasOwn(AVATAR_ALLOWED_MIME_TYPES, file.type)) return "檔案格式需為 JPG／PNG／WebP";
  if (file.size > AVATAR_MAX_FILE_SIZE_BYTES) return "檔案大小需小於 5MB";
  return null;
}

// currentDisplayName：呼叫端傳入目前的顯示名稱，讓這次上傳只更新 avatar_url、不動
// display_name（見 updateAdminProfile 的說明）。
export async function uploadAdminAvatar(
  supabase: SupabaseClient,
  currentDisplayName: string | null,
  file: File,
): Promise<Result<string>> {
  const validationError = validateAdminAvatarFile(file);
  if (validationError) {
    return { ok: false, error: { message: validationError } };
  }

  const extension = AVATAR_ALLOWED_MIME_TYPES[file.type];
  const path = `avatar/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("admin-assets")
    .upload(path, file, { contentType: file.type });
  if (uploadError) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const { data: publicUrlData } = supabase.storage.from("admin-assets").getPublicUrl(path);

  const result = await updateAdminProfile(supabase, currentDisplayName, publicUrlData.publicUrl);
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: publicUrlData.publicUrl };
}

// 「移除」只清空 admins.avatar_url，不刪除 Storage 裡的舊檔案物件——已知的孤兒檔案殘留
// 風險，比照 lib/store-settings.ts removeStoreImage 的既有慣例與其任務卡記錄的取捨。
export async function removeAdminAvatar(
  supabase: SupabaseClient,
  currentDisplayName: string | null,
): Promise<Result<void>> {
  return updateAdminProfile(supabase, currentDisplayName, null);
}

// Supabase Auth 沒有提供「驗證目前密碼、但不建立新 session」的獨立 API，這裡用目前登入者
// 的 email（向伺服器現查，不接受呼叫端傳入——見下方 updateAdminPassword／updateAdminEmail
// 的說明）＋輸入的「目前密碼」重新呼叫一次 signInWithPassword 確認身分，通過才繼續執行
// 真正的變更（見任務卡情境包記錄的既定作法）。
//
// 已知限制（security-reviewer TASK-042 審查發現，記錄於此避免之後被誤認為已無死角）：
// 這個關卡完全在瀏覽器端執行。Supabase 專案在預設設定（Dashboard 未開啟 Secure password
// change）下，updateUser({ password }) 只要求呼叫者持有任一有效 access token，並不會檢查
// 是否剛完成 re-auth——換言之，任何已取得目前 session token 的人（不只是「趁機打開沒鎖的
// 筆電」，也包含能讀 document.cookie 或攔截請求的攻擊者）理論上都能繞過這裡的檢查、直接對
// Supabase REST API 送出密碼變更請求。這個關卡能有效防護的是「機會型」的實體接觸，不是
// 「已取得 session」等級的攻擊者；徹底的防護需要伺服器端強制（例如改用不持久化 session 的
// client 驗證＋service role key 呼叫 admin API），本卡評估後選擇先接受這個已知限制（單一
// 管理員帳號、非公開對外服務），未執行更大的架構改動。若未來要在 Supabase Dashboard 開啟
// Secure password change，注意 GoTrue 屆時會要求 reauthenticate() 產生的 email nonce，
// 這裡的呼叫方式沒有帶 nonce，只會收到 reauthentication_needed 錯誤（降級為本函式的
// internal_error 分支），需要屆時一併改寫，不會自動相容。
async function reauthenticateAdmin(
  supabase: SupabaseClient,
  currentPassword: string,
): Promise<{ ok: true } | { ok: false; reason: "wrong_password" | "internal_error" }> {
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();
  if (getUserError || !user?.email) {
    return { ok: false, reason: "internal_error" };
  }

  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (error) {
    // 只有真的是密碼錯誤才顯示「目前密碼錯誤」；其餘（例如 Supabase 對 /token 端點的
    // rate limit、暫時性網路錯誤）一律走通用失敗分支，避免使用者被限流時誤以為密碼被
    // 別人改掉、反而更頻繁重試而加重限流（security-reviewer TASK-042 審查發現：原本把
    // signInWithPassword 的任何錯誤都歸類成「目前密碼錯誤」，會讓限流與真正的密碼錯誤
    // 無法區分，也讓「密碼真的被入侵者改掉」這個訊號被錯誤訊息蓋掉）。
    return { ok: false, reason: error.code === "invalid_credentials" ? "wrong_password" : "internal_error" };
  }
  return { ok: true };
}

export type UpdatePasswordFailureReason = "wrong_password" | "weak_password" | "same_password" | "internal_error";

// 回傳型別刻意不用共用的 Result<T>：呼叫端（UI）需要明確區分「目前密碼錯誤」（顯示在
// 目前密碼欄位旁的行內錯誤，讓使用者原地修正）、「新密碼被伺服器拒絕」（顯示可行動的
// 表單錯誤）與「其他失敗」（顯示通用 Toast），改用明確的 reason 判別式比對齊 TypeScript
// 的窮舉檢查，訊息文案調整不會悄悄破壞呼叫端的分支邏輯。
//
// 注意：signInWithPassword 重新驗證成功時會核發一組新的 session token 並由 browser
// client 自動持久化；這只刷新目前分頁的 session，不需要重新整理頁面。但緊接著的
// updateUser({ password }) 成功時，Supabase 依其既有行為會登出「除了目前這個 session
// 以外」的所有其他 session——也就是說，改密碼成功後，設計師手機或其他瀏覽器上原本的
// 登入會被踢掉（這是 Supabase 的既定行為，不是 bug；先前版本的註解誤把這個效果歸因成
// signInWithPassword 本身的 refresh token rotation，已更正）。UI 層目前只顯示「已儲存」，
// 沒有告知這個副作用，記錄在任務卡完成證據的殘留風險，未來如果有多裝置登入情境應該在
// 成功訊息補上提示。
export async function updateAdminPassword(
  supabase: SupabaseClient,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; reason: UpdatePasswordFailureReason }> {
  const reauthResult = await reauthenticateAdmin(supabase, currentPassword);
  if (!reauthResult.ok) {
    return reauthResult;
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.code === "weak_password") return { ok: false, reason: "weak_password" };
    if (error.code === "same_password") return { ok: false, reason: "same_password" };
    return { ok: false, reason: "internal_error" };
  }
  return { ok: true };
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// 與 lib/booking/validation.ts 的 validateEmail 分開一份：那邊的 email 欄位在顧客訂位
// 流程中選填（空字串視為合法），這裡的登入 email 語意相反（必填），共用同一份會讓其中一邊
// 的「空字串合法」語意跟著錯置，寧可各自維護一份極簡的正規式驗證（比照
// lib/admin/account.ts 其他驗證函式的既有慣例：每個網域自己管自己的驗證規則）。
export function validateAdminEmail(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return "Email 為必填";
  if (!EMAIL_PATTERN.test(trimmed)) return "Email 格式不正確";
  return null;
}

// 登入 email 是帳號救援管道（忘記密碼流程會寄信到這個地址）；若變更 email 不需要任何
// 再驗證，攻擊者只要拿到一段有效 session 就能把救援信箱換成自己的，且視 Supabase 專案的
// Secure email change 設定，舊信箱可能完全收不到通知——形同無聲換鎖。因此比照
// updateAdminPassword，變更 email 前一樣要求重新驗證目前密碼（security-reviewer
// TASK-042 審查發現：原本密碼變更需要驗證、email 變更卻不用，防護等級與威脅嚴重度恰好
// 相反）。
//
// updateUser({ email }) 沿用 Supabase 專案既有的 email 變更確認機制（單重或雙重確認皆
// 適用，本函式不假設特定機制，也不查詢或斷言 Dashboard 設定——anon key 本來就查不到）；
// 呼叫成功只代表「變更請求已送出」，實際登入 email 要等使用者完成信件內連結確認後才會
// 生效。回傳新的 pendingEmail（來自 Supabase 回應的 user.new_email）供呼叫端顯示「待確認」
// 狀態，讓這個狀態能透過 AdminProfileContext.refresh() 之後仍然可見（不是純前端的樂觀
// UI，重新整理頁面也看得到），細節見 AccountSettingsView.tsx。
export type UpdateEmailFailureReason =
  | "wrong_password"
  | "email_exists"
  | "email_address_invalid"
  | "rate_limited"
  | "internal_error";

export async function updateAdminEmail(
  supabase: SupabaseClient,
  currentPassword: string,
  newEmail: string,
): Promise<{ ok: true; pendingEmail: string | null } | { ok: false; reason: UpdateEmailFailureReason }> {
  const reauthResult = await reauthenticateAdmin(supabase, currentPassword);
  if (!reauthResult.ok) {
    return reauthResult;
  }

  const { data, error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) {
    // 比照 updateAdminPassword 把可行動的錯誤碼拆出來（architect TASK-042 審查發現：
    // 原本 email 路徑把這幾個可行動錯誤都塌成同一句通用失敗，與剛修好的密碼路徑不一致）。
    // over_email_send_rate_limit 在本專案特別容易踩到：忘記密碼（TASK-040）與這裡共用
    // 同一份 Supabase 預設 SMTP 寄信配額，若沿用通用錯誤訊息，使用者只會不斷重試、
    // 讓配額更快耗盡。
    if (error.code === "email_exists") return { ok: false, reason: "email_exists" };
    if (error.code === "email_address_invalid") return { ok: false, reason: "email_address_invalid" };
    if (error.code === "over_email_send_rate_limit") return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "internal_error" };
  }
  return { ok: true, pendingEmail: data.user?.new_email ?? null };
}

// MFA（TASK-043）：帳號設定頁「雙重驗證」卡片的資料存取，皆為 Supabase Auth `mfa.*` API
// 的薄封裝。停用需要重新驗證身分，重用上方 reauthenticateAdmin（不複製貼上一份），對齊
// 任務卡「不得觸碰 TASK-042 負責的密碼驗證邏輯，透過匯入函式重用」的要求。

export type MfaFactor = { id: string; status: "verified" | "unverified" };

// 只回傳 totp 類型的 factor（本專案目前唯一支援的 MFA 方式）；不論 verified／unverified
// 皆回傳，讓呼叫端自行判斷（例如偵測到殘留的 unverified factor 時可提示重新整理）。
export async function listMfaFactors(supabase: SupabaseClient): Promise<Result<MfaFactor[]>> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  const totpFactors = data.all.filter((factor) => factor.factor_type === "totp");
  return { ok: true, data: totpFactors.map((factor) => ({ id: factor.id, status: factor.status })) };
}

export type MfaEnrollment = { factorId: string; qrCode: string; secret: string };

// mfa.enroll() 建立一個 unverified 的 totp factor，回傳 QR Code（SVG data URI，直接當
// <img src> 使用，見 Supabase SDK 官方範例——不用 dangerouslySetInnerHTML 插入 SVG 原始碼，
// 避免不必要的 HTML 注入風險）與可手動輸入的密鑰文字。
export async function enrollMfa(supabase: SupabaseClient): Promise<Result<MfaEnrollment>> {
  // 清除殘留的 unverified factor 再建立新的：使用者點擊「啟用」後若中途關分頁／重新整理／
  // 網路中斷，cancelMfaEnrollment 不會被呼叫，伺服器端會留下一個 unverified factor；不清
  // 理的話多次嘗試後會撞上 Supabase 的 MFA_MAX_ENROLLED_FACTORS 上限，導致使用者在畫面上
  // 完全無法啟用 MFA 且沒有任何自救手段（security-reviewer TASK-043 審查發現）。這裡個別
  // unenroll 呼叫刻意不檢查回傳結果——即使某筆清除失敗，仍應繼續嘗試建立新的 factor，讓
  // 使用者至少能繼續走完註冊流程。
  const existingFactors = await listMfaFactors(supabase);
  if (existingFactors.ok) {
    const staleUnverified = existingFactors.data.filter((factor) => factor.status === "unverified");
    await Promise.all(staleUnverified.map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })));
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error || !data) {
    if (error?.code === "too_many_enrolled_mfa_factors") {
      return { ok: false, error: { message: "已達雙重驗證裝置數量上限，請洽系統管理者協助清除既有設定。" } };
    }
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

export type VerifyMfaCodeFailureReason = "invalid_code" | "rate_limited" | "internal_error";

// challenge() 取得 challengeId，再 verify() 驗證使用者輸入的 6 位數碼；成功後 Supabase
// 會把目前 session 的 authenticator level 升為 aal2（既定行為）。註冊確認與停用前的
// 驗證碼確認共用同一套 challenge/verify 呼叫，抽成私有函式避免重複。
//
// rate_limited（over_request_rate_limit）獨立拆出來，不歸類到 internal_error：比照
// updateAdminEmail 對 over_email_send_rate_limit 的既有慣例（reauthenticateAdmin 註解也有
// 同樣說明）——限流時若顯示通用失敗文案，使用者會誤以為是暫時性故障而更頻繁重試，反而
// 讓限流更快觸發、真正的失敗訊號也被蓋掉（security-reviewer TASK-043 審查發現：MFA 路徑
// 原本沒有沿用這個既有原則）。
async function challengeAndVerifyMfaCode(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: VerifyMfaCodeFailureReason }> {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) {
    return { ok: false, reason: challengeError?.code === "over_request_rate_limit" ? "rate_limited" : "internal_error" };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (verifyError) {
    if (verifyError.code === "mfa_verification_failed") return { ok: false, reason: "invalid_code" };
    if (verifyError.code === "over_request_rate_limit") return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "internal_error" };
  }
  return { ok: true };
}

export type VerifyMfaEnrollmentFailureReason = VerifyMfaCodeFailureReason;

// 註冊確認：見 challengeAndVerifyMfaCode 說明。
export async function verifyMfaEnrollment(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: VerifyMfaEnrollmentFailureReason }> {
  return challengeAndVerifyMfaCode(supabase, factorId, code);
}

// 註冊流程中點擊「取消」：移除尚未驗證的 factor，避免殘留半成品（見任務卡「未知事項」
// 段落）。不需要重新驗證身分——這個 factor 本來就還沒生效，移除它不會降低帳號保護程度。
//
// 呼叫前先確認目標 factor 真的是 unverified：不能只信任呼叫端傳入的 factorId 就直接
// unenroll——今天唯一呼叫端傳的是剛 enroll() 拿到的 id，是安全的，但這個不變式必須放進
// 函式本身，不能只靠呼叫端自律。若未來任何路徑（重構誤用、新增呼叫端）誤用一個已驗證
// （verified）的 factorId 呼叫這支函式，等同零驗證移除已啟用的 MFA——這正是任務卡風險
// 等級點名的「停用不需要身分驗證」情境（security-reviewer TASK-043 審查發現）。
export async function cancelMfaEnrollment(supabase: SupabaseClient, factorId: string): Promise<Result<void>> {
  const factorsResult = await listMfaFactors(supabase);
  if (!factorsResult.ok) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  const target = factorsResult.data.find((factor) => factor.id === factorId);
  if (!target || target.status !== "unverified") {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: undefined };
}

export type UnenrollMfaFailureReason = "wrong_password" | "invalid_code" | "rate_limited" | "internal_error";

// 停用已啟用的 MFA：任務卡原先的情境包假設「輸入目前密碼」即可停用（比照 TASK-042 的
// reauthenticateAdmin 密碼驗證），但實作期對真實 Supabase 專案走查發現：mfa.unenroll()
// 移除一個 verified factor 時，GoTrue 會回傳 422 insufficient_aal（"AAL2 required to
// unenroll verified factor"）——signInWithPassword 建立的 session 只有 aal1，不論密碼多正確
// 都無法通過這道伺服器端檢查，這不是「安全性強度取捨」而是功能性錯誤：純密碼驗證的停用
// 路徑在真實環境下 100% 會失敗，必須改用驗證碼升級到 aal2 才能真正停用。此為實作期偏離
// 任務卡原始假設的記錄，見完成證據「已知限制」。
//
// 同時採納 security-reviewer TASK-043 審查建議，改為「目前密碼」＋「目前驗證碼」兩者皆
// 必須通過（不是二選一）：停用 MFA 只需要一個 6 位數驗證碼，等於只驗證「持有物」（拿到
// 已登入裝置＋能看到 Authenticator App 的人，例如同一支手機的兩個 App，就能無聲關掉第二
// 道防線）；加回密碼驗證「知識」這一層，防護等級才與密碼／Email 修改一致。
//
// 呼叫順序有嚴格限制，順序寫反會回到 422 insufficient_aal：必須先 reauthenticateAdmin()
// 驗證密碼，再 challengeAndVerifyMfaCode() 升級 aal2，最後才 unenroll()——因為
// signInWithPassword 會核發一組全新的 aal1 session，若順序寫反（先升級 aal2 再驗證密碼），
// 密碼驗證這步會把剛升級的 aal2 洗掉。
export async function unenrollMfaWithPasswordAndCode(
  supabase: SupabaseClient,
  currentPassword: string,
  factorId: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: UnenrollMfaFailureReason }> {
  const reauthResult = await reauthenticateAdmin(supabase, currentPassword);
  if (!reauthResult.ok) {
    return reauthResult;
  }

  const stepUpResult = await challengeAndVerifyMfaCode(supabase, factorId, code);
  if (!stepUpResult.ok) {
    return stepUpResult;
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    return { ok: false, reason: "internal_error" };
  }
  return { ok: true };
}
