import type { SupabaseClient, User } from "@supabase/supabase-js";

// 判斷目前 session 的 Authenticator Assurance Level（aal）是否已滿足——用於伺服器端三個
// 關鍵入口點（app/login/page.tsx 登入後重導向、lib/supabase/middleware.ts 的
// /admin/:path* 路由守門、app/admin/layout.tsx 頁面層檢查），修正 TASK-044
// security-reviewer 發現的 C1：使用者在登入頁 MFA 驗證碼畫面重新整理頁面，會被
// app/login/page.tsx 的 is_admin() 判斷直接導向 /admin，完全繞過尚未完成的 TOTP 驗證。
//
// 【實作期修正，見下方說明】原本用 supabase.auth.mfa.getAuthenticatorAssuranceLevel()
// 不帶 jwt 參數的版本，直接比對它回傳的 currentLevel／nextLevel。security-reviewer
// 審查發現：該版本的 nextLevel 是從本地、未經伺服器驗證的 session.user.factors
// （瀏覽器 cookie 快取的使用者物件，不是簽章過的 JWT 內容）推算出來的——攻擊者只要
// 編輯瀏覽器的 sb-*-auth-token cookie、把 user.factors 清空，就能讓 nextLevel
// 看起來跟 currentLevel 一樣，三個入口點會同時誤判為「已滿足」而放行，等於完全沒有
// 真正修好 C1（實測 PoC 已確認可行）。
//
// 修正後改用呼叫端本來就會呼叫的 supabase.auth.getUser()（會真的打 Supabase Auth
// API 驗證 token 並回傳伺服器端權威資料，不是本地快取）取得已驗證的 factor 清單，
// 判斷「這個帳號是否啟用了 MFA（需要 aal2）」；currentLevel 則交給
// getAuthenticatorAssuranceLevel() 不帶 jwt 版本取得——這部分沒有信任問題，因為
// currentLevel 是從本地 session 的 access_token（簽章過的 JWT）解碼 aal claim 而來，
// 攻擊者無法偽造簽章內容（能竄改的只有 JWT 之外、cookie 裡另外快取的 user 物件）。
// user 由呼叫端傳入（已經呼叫過 getUser()，不在本函式內重複呼叫），避免同一個請求內
// 對 Supabase Auth API 打兩次一樣的 /user 請求。
//
// 重要前提（第二輪 security-reviewer 審查確認）：呼叫端必須先呼叫
// supabase.auth.getUser() 成功（回傳非 null 的 user）才能呼叫本函式，且要用同一個
// request／同一個 supabase client 實例——currentLevel 的解碼本身不驗簽，安全性建立在
// 「同一個 access_token 已經被上面那次 getUser() 呼叫向 Auth 伺服器驗證過」這個前提
// 上：若 access_token 是偽造的，getUser() 會先失敗、user 為 null，呼叫端就不會走到
// isAalSatisfied 這一步。日後若重構調換呼叫順序（例如先判斷 aal 再呼叫
// getUser()），這個安全論證就不成立，請勿調換。
//
// 呼叫本身可能直接 throw（而非回傳 { error }）——例如 cookie 內容異常導致本地解碼
// session 時拋出例外，這條路徑原本沒有 catch 住，會讓呼叫端（尤其是
// lib/supabase/middleware.ts，掛載於每個 /admin/* 請求）整個請求變成未處理例外／500
// 錯誤，而不是預期的「fail closed 導向 /login」（architect 審查發現，F1：實際嚴重度
// 影響全站 /admin 可用性，非僅未過關的使用者體驗問題）。
export async function isAalSatisfied(supabase: SupabaseClient, user: User): Promise<boolean> {
  try {
    const requiresAal2 = (user.factors ?? []).some(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    );

    const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !aal || !aal.currentLevel) {
      return false;
    }

    if (!requiresAal2) {
      // 未啟用 MFA：aal1 即已滿足，登入行為不變。
      return true;
    }
    return aal.currentLevel === "aal2";
  } catch {
    return false;
  }
}
