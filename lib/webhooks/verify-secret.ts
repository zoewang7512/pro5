import { createHash, timingSafeEqual } from "node:crypto";

// 供 webhook（TASK-052／053，比對 SUPABASE_WEBHOOK_SECRET）與排程端點（TASK-054，
// 比對 CRON_SECRET）共用的密鑰驗證工具函式，涵蓋 cron 排程請求，不只狹義的
// webhook（architect 於 TASK-051 審查建議；維持 `lib/webhooks/` 這個檔案落點，
// 不另外搬到 `lib/auth/`，因為任務卡已核准這個路徑）。
//
// **常數時間比較**：兩個字串先各自雜湊成固定 32 bytes 的 SHA-256 digest 再用
// `crypto.timingSafeEqual` 比較，而不是直接對原始字串呼叫 `timingSafeEqual`——
// 原始字串長度不同時 `timingSafeEqual` 會直接 throw（必須兩個 buffer 等長），若
// 呼叫端因此用 try/catch 或先比較 `.length` 再決定是否呼叫 `timingSafeEqual`，
// 等於用「密鑰長度是否相符」這個提前分支洩漏時序資訊（攻擊者可用大量請求量測回應
// 時間反推密鑰長度，逐步縮小暴力破解範圍）。先雜湊成固定長度可讓比較函式本身永遠
// 走同一條長度相等的路徑，不論輸入長度為何。
// 已知限制：這個常數時間特性無法被一般黑箱單元測試直接驗證（測試只能斷言輸入/
// 輸出行為），依賴的是這段程式碼本身的實作方式——architect／security-reviewer 於
// TASK-051 審查已確認先雜湊再比較的路徑正確，之後修改這個函式須留意不要繞回
// 「先比較長度」或「捕捉 timingSafeEqual 的例外」這類看似等價、實則洩漏時序的寫法。
//
// `expected` 刻意接受 `string | null | undefined`（而非要求呼叫端自己處理
// `process.env.X` 的 `string | undefined` 型別）：security-reviewer 於 TASK-051
// 審查發現，若簽章要求 `string`，呼叫端在 TS strict 下被迫寫
// `process.env.CRON_SECRET!`（環境變數未設定時直接 throw TypeError，變成不明確的
// 500）或更危險的 `String(process.env.CRON_SECRET)`（環境變數未設定時得到字面值
// `"undefined"`，攻擊者只要送出 header 值 `"undefined"` 就會通過驗證，等同完全
// 沒有防護）。這裡把「未設定一律拒絕」的判斷收斂進函式本身，呼叫端只需要原樣傳入
// `process.env.CRON_SECRET`，不需要也不應該自己做任何字串轉換。
export function verifySecret(
  received: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  // expected 缺失（未設定環境變數）或空字串代表伺服器端設定錯誤，不論收到什麼都應該
  // 拒絕——這個提前 return 只取決於伺服器自己的設定值，與攻擊者可觀察的輸入
  // （received）無關，不構成時序側錄攻擊面。
  if (!expected) return false;

  const receivedDigest = createHash("sha256").update(received ?? "", "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(receivedDigest, expectedDigest);
}

// Vercel Cron 送出的排程請求帶 `Authorization: Bearer <CRON_SECRET>`（見
// .env.example 說明），共用工具函式一併提供 Bearer 前綴解析，避免 TASK-054 的
// 實作者自己手刻容易寫錯的版本（例如用 `.includes(secret)` 誤判、或忽略大小寫）
// （security-reviewer 於 TASK-051 審查建議）。前綴本身是公開的固定字串、不含密鑰
// 資訊，用一般字串比較（非常數時間）沒有安全疑慮，只有拆出來的密鑰部分會走
// `verifySecret` 的常數時間比較。
const BEARER_PREFIX = "Bearer ";

export function verifyBearerSecret(
  authorization: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!authorization || !authorization.startsWith(BEARER_PREFIX)) return false;
  return verifySecret(authorization.slice(BEARER_PREFIX.length), expected);
}
