import { describe, expect, it } from "vitest";
import { verifyBearerSecret, verifySecret } from "@/lib/webhooks/verify-secret";

describe("verifySecret", () => {
  it("收到的密鑰與預期密鑰完全相符時回傳 true", () => {
    expect(verifySecret("correct-secret-value", "correct-secret-value")).toBe(true);
  });

  it("收到的密鑰內容不符時回傳 false（即使長度相同）", () => {
    expect(verifySecret("wrong-secret-values", "correct-secret-value")).toBe(false);
  });

  it("收到的密鑰長度不同時回傳 false，不拋出例外（不能直接對不等長字串呼叫 timingSafeEqual）", () => {
    expect(verifySecret("short", "correct-secret-value")).toBe(false);
    expect(verifySecret("this-is-a-much-longer-string-than-expected", "correct-secret-value")).toBe(false);
  });

  it("缺少密鑰（null／undefined）時回傳 false", () => {
    expect(verifySecret(null, "correct-secret-value")).toBe(false);
    expect(verifySecret(undefined, "correct-secret-value")).toBe(false);
  });

  it("收到空字串時回傳 false", () => {
    expect(verifySecret("", "correct-secret-value")).toBe(false);
  });

  it("預期密鑰為空字串（環境變數未設定）時一律回傳 false，即使收到的也是空字串", () => {
    expect(verifySecret("", "")).toBe(false);
    expect(verifySecret("anything", "")).toBe(false);
    expect(verifySecret(null, "")).toBe(false);
  });

  // expected 直接接受 undefined／null（對應 process.env.X 未設定時的原始型別），
  // 呼叫端不需要（也不應該）自己做 `String(process.env.X)` 這類轉換——那樣做在
  // 環境變數未設定時會得到字面值 "undefined"，攻擊者只要送出 header 值 "undefined"
  // 就會通過驗證，等同完全沒有防護（security-reviewer 於 TASK-051 審查發現的
  // MUST FIX）。這裡確認函式本身已經在型別層級消除了這個陷阱。
  it("預期密鑰為 undefined／null（環境變數未設定，呼叫端未做任何轉換）時一律回傳 false", () => {
    expect(verifySecret("anything", undefined)).toBe(false);
    expect(verifySecret("anything", null)).toBe(false);
  });

  it("即使收到的密鑰字面值剛好是字串 \"undefined\"，只要 expected 有效設定，也不會誤判為通過", () => {
    expect(verifySecret("undefined", "correct-secret-value")).toBe(false);
  });

  it("密鑰含非 ASCII 字元（中文／emoji）時仍能正確比對，不因多位元組字元出錯", () => {
    expect(verifySecret("正確密鑰🔑", "正確密鑰🔑")).toBe(true);
    expect(verifySecret("錯誤密鑰🔑", "正確密鑰🔑")).toBe(false);
  });

  it("極長密鑰（10000 字元）仍能正確比對，不受輸入長度影響行為", () => {
    const long = "a".repeat(10_000);
    expect(verifySecret(long, long)).toBe(true);
    expect(verifySecret(`${long}b`, long)).toBe(false);
  });

  it("純空白字元組成的字串不會被誤判為與空字串等價", () => {
    expect(verifySecret("   ", "correct-secret-value")).toBe(false);
    expect(verifySecret("   ", "   ")).toBe(true);
  });

  // 已知限制（test-engineer 於 TASK-051 審查指出）：純黑箱測試無法區分「安全的雜湊後
  // 定長比較」與「先比較 .length 再決定要不要呼叫 timingSafeEqual」這種看似等價、
  // 實則洩漏時序資訊的不安全實作——兩者在上面所有案例的回傳值都完全相同。原本規劃用
  // vi.spyOn 直接斷言 timingSafeEqual 收到的兩個 buffer 恆為 32 bytes 做白盒驗證，
  // 但 Node 內建模組的 ESM named export 在 Vitest 下不可重新定義
  // （"Module namespace is not configurable in ESM"），無法直接 spy。常數時間特性
  // 因此依賴 lib/webhooks/verify-secret.ts 檔頭註解與 architect／security-reviewer
  // 於 TASK-051 審查的 code review 確認，而非自動化測試證明；日後修改這支函式時，
  // 審查者需要重新人工確認實作路徑仍是「先雜湊成固定長度再比較」。
});

describe("verifyBearerSecret", () => {
  it("正確解析 Bearer 前綴並比對密鑰", () => {
    expect(verifyBearerSecret("Bearer correct-secret-value", "correct-secret-value")).toBe(true);
  });

  it("密鑰內容不符時回傳 false", () => {
    expect(verifyBearerSecret("Bearer wrong-value", "correct-secret-value")).toBe(false);
  });

  it("缺少 Bearer 前綴時回傳 false，即使密鑰本身正確", () => {
    expect(verifyBearerSecret("correct-secret-value", "correct-secret-value")).toBe(false);
  });

  it("header 完全缺失（null／undefined）時回傳 false", () => {
    expect(verifyBearerSecret(null, "correct-secret-value")).toBe(false);
    expect(verifyBearerSecret(undefined, "correct-secret-value")).toBe(false);
  });

  it("大小寫不同的前綴（bearer 小寫）視為不符，回傳 false", () => {
    expect(verifyBearerSecret("bearer correct-secret-value", "correct-secret-value")).toBe(false);
  });
});
