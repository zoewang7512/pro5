// 純函式：姓名／電話／email 的前端驗證與正規化。
// 電話的正規化與格式規則刻意與 supabase/migrations/0002_booking_flow.sql 的
// create_appointment RPC 內部邏輯一致（去除非數字字元後長度 8-10、且以 0 開頭），
// 前端先擋一次可即時給使用者回饋，後端仍會重新驗證，不是唯一防線。

export type FieldValidationResult = { valid: true; value: string } | { valid: false; message: string };

export function validateName(raw: string): FieldValidationResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { valid: false, message: "請輸入姓名" };
  }
  if (value.length > 50) {
    return { valid: false, message: "姓名不可超過 50 個字" };
  }
  return { valid: true, value };
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function validatePhone(raw: string): FieldValidationResult {
  const digits = normalizePhone(raw);
  if (digits.length === 0) {
    return { valid: false, message: "請輸入電話" };
  }
  if (digits.length < 8 || digits.length > 10 || digits[0] !== "0") {
    return { valid: false, message: "電話格式不正確，請確認號碼" };
  }
  return { valid: true, value: digits };
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateEmail(raw: string): FieldValidationResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { valid: true, value: "" };
  }
  if (!EMAIL_PATTERN.test(value)) {
    return { valid: false, message: "Email 格式不正確" };
  }
  return { valid: true, value };
}
