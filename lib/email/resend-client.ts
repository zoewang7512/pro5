import "server-only";
import { Resend } from "resend";

// Resend API 薄封裝。寄送失敗一律回傳 { ok: false, error }（不 throw），讓呼叫端
// （TASK-052／053／054 的 webhook／排程端點）能自行決定「記錄 log 但不影響主流程」——
// 例如確認信寄送失敗不應該讓 create_appointment 已經成功寫入的預約整個回滾或報錯給
// 顧客，寄信只是預約成立後的附加動作，不是交易的一部分。
//
// 僅限伺服器端使用：EMAIL_API_KEY 是 Resend 的私密金鑰，`import "server-only"`
// 讓這個模組一旦出現在 client component 的匯入鏈上就會建置失敗（比照
// lib/supabase/service-role.ts 的既有寫法，architect 於 TASK-051 審查提出）。
//
// **`html` 參數視為已信任的最終 HTML，本函式不做任何 escape**：呼叫端組信件內容時，
// 任何非系統計算的值（顧客姓名、服務名稱、備註等使用者輸入）在內插進 HTML 之前都
// 必須先呼叫 `lib/email/format.ts` 的 `escapeHtml`，理由與風險說明見該函式註解
// （security-reviewer 於 TASK-051 審查發現的 MUST FIX：`create_appointment` 對
// customer_name 只檢查長度、不過濾字元，若確認信直接內插姓名到 HTML 會形成
// email HTML injection／釣魚管道）。

export type EmailErrorCode = "MISSING_CONFIG" | "SEND_FAILED" | "TIMEOUT" | "INTERNAL_ERROR";
export type EmailError = { message: string; code: EmailErrorCode };
export type Result<T> = { ok: true; data: T } | { ok: false; error: EmailError };

const GENERIC_MESSAGE = "發生未預期的錯誤，請稍後再試。";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export type SendEmailResult = { id: string };

// Resend SDK（6.22.0）底層走裸 fetch，沒有內建 timeout，也沒有開放任何 per-call
// signal／自訂 fetch 注入點（已確認型別定義 CreateEmailRequestOptions／PostOptions
// 皆無 signal 欄位），無法直接把 AbortSignal 傳進 SDK；改用 Promise.race 搭配逾時
// promise 實作——逾時後這裡會先回傳失敗結果讓呼叫端不再等待，但原本的 fetch request
// 仍會在背景繼續進行到完成或連線層級逾時，不是真正取消。TASK-054 若在迴圈中批次
// 寄送提醒信，單一請求卡住會拖垮整批，是這裡要優先解決的問題（architect／
// security-reviewer 於 TASK-051 審查提出）。
const SEND_TIMEOUT_MS = 10_000;
const TIMEOUT_MARKER = Symbol("resend-client-timeout");

export async function sendEmail(input: SendEmailInput): Promise<Result<SendEmailResult>> {
  const apiKey = process.env.EMAIL_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;

  if (!apiKey || !fromAddress) {
    console.error("sendEmail: 缺少 EMAIL_API_KEY 或 EMAIL_FROM_ADDRESS 環境變數設定");
    return { ok: false, error: { message: GENERIC_MESSAGE, code: "MISSING_CONFIG" } };
  }

  try {
    const resend = new Resend(apiKey);
    const sendPromise = resend.emails.send({
      from: fromAddress,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    const timeoutPromise = new Promise<typeof TIMEOUT_MARKER>((resolve) => {
      setTimeout(() => resolve(TIMEOUT_MARKER), SEND_TIMEOUT_MS);
    });

    const outcome = await Promise.race([sendPromise, timeoutPromise]);
    if (outcome === TIMEOUT_MARKER) {
      console.error(`sendEmail: Resend API 超過 ${SEND_TIMEOUT_MS}ms 未回應`);
      return { ok: false, error: { message: GENERIC_MESSAGE, code: "TIMEOUT" } };
    }

    const { data, error } = outcome;
    if (error || !data) {
      // 只記錄結構化的非個資欄位（錯誤名稱／HTTP 狀態碼）：Resend 的驗證類錯誤
      // message 常會回述有問題的欄位值，可能包含收件人 email（個資），不應完整
      // 寫進伺服器 log（security-reviewer 於 TASK-051 審查發現）。
      console.error("sendEmail: Resend API 回傳錯誤", { name: error?.name, statusCode: error?.statusCode });
      return { ok: false, error: { message: GENERIC_MESSAGE, code: "SEND_FAILED" } };
    }

    return { ok: true, data: { id: data.id } };
  } catch (caught) {
    // Resend SDK 幾乎不對 API 層級的失敗 throw（一律以 { data: null, error } 回傳），
    // 這裡主要捕捉網路層級例外；例外物件本身不含 API key 或收件人資訊
    // （已確認 SDK 原始碼），可安全記錄完整內容供除錯。
    console.error("sendEmail: 呼叫 Resend API 時發生例外", caught);
    return { ok: false, error: { message: GENERIC_MESSAGE, code: "INTERNAL_ERROR" } };
  }
}
