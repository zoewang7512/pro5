// 純函式：密碼強度計算與新密碼基本格式檢查，供 PasswordStrengthMeter（重設密碼頁、
// TASK-042 帳號設定頁修改密碼）與各自的表單驗證共用。只做前端視覺提示與基本檢查，
// 不取代 Supabase Auth 本身的密碼規則（例如最短長度），伺服器端規則以 Supabase 回傳的
// 錯誤為準。

export type PasswordStrength = "weak" | "medium" | "strong";

export const PASSWORD_STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: "弱",
  medium: "中",
  strong: "強",
};

// Supabase 專案設定的密碼最短長度預設為 6 碼，前端先擋掉明顯過短的輸入，避免送出後才
// 從伺服器錯誤得知；不在前端重複維護更嚴格的規則（例如必須包含符號），那些交給
// Supabase 專案設定與伺服器端錯誤訊息處理。
export const MIN_PASSWORD_LENGTH = 6;

// GoTrue（Supabase Auth）用 bcrypt 雜湊密碼，bcrypt 演算法本身只吃前 72 bytes，超過的部分
// 會被靜默截斷；GoTrue 對此的處理是直接拒絕超過 72 字元的密碼並回傳錯誤。前端先擋，避免
// 使用者送出一個「看起來被接受、但實際上跟預期不同」的密碼（security-reviewer TASK-042
// 審查建議）。
export const MAX_PASSWORD_LENGTH = 72;

export function calculatePasswordStrength(password: string): PasswordStrength {
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const varietyCount = [hasLower, hasUpper, hasNumber, hasSymbol].filter(Boolean).length;

  if (password.length >= 12 && varietyCount >= 3) return "strong";
  if (password.length >= 8 && varietyCount >= 2) return "medium";
  return "weak";
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password.length > 0 && password === confirmPassword;
}
