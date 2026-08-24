// 對真實 Supabase 專案執行的整合測試（TASK-055），驗證 Email 通知與提醒 Epic
// （TASK-051～054）的 webhook／排程端點對真實資料庫的密鑰驗證與查詢邏輯，補足
// tests/api/appointment-events-webhook.test.ts／tests/api/appointment-reminders-cron.test.ts
// 兩份既有單元測試（全 mock Supabase／Resend）沒有涵蓋的一環：端點邏輯與真實資料庫
// schema／grant／查詢語法是否真的對得起來。不放進預設 `npm test`，只透過
// `npm run test:notifications` 執行——這個檔案不會在其他情境下被跑到，所以缺設定時
// 直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的誤導。
//
// **對 Resend 的呼叫全程 mock**（`sendEmail`，見下方 vi.mock）：任務卡「假設」段落
// 明訂自動化整合測試不寄真實信件，真實送達驗證改走本卡「手動」步驟（不併入本檔案／
// CI）。這裡驗證的是「該不該寄、寄給誰、內容分類是否正確」，不驗證「真的寄出去了」。
//
// **重要風險提示（排程端點測試專屬）**：`claimAppointmentsForReminder` 的查詢沒有
// service_id／任何測試專屬篩選條件——它本來就是設計成「一次掃描整張 appointments
// 表」的排程邏輯，這是這支函式的正確行為，不是測試的問題。這代表本檔案呼叫真正的
// GET handler 時，任何真實顧客在未來 0～26 小時內的 pending/confirmed 預約都可能被
// 一併 claim（reminder_sent_at 被設成非 null）。由於 sendEmail 全程 mock，這些真實
// 顧客不會真的收到提醒信，若不處理，會讓正式排程之後誤判「已經提醒過」而永久漏寄。
// 因此「時間窗篩選」那個 describe 區塊採用「執行前先讀出當下時間窗內所有符合條件的
// 既有 id（含真實資料）、執行後在 finally 區塊逐一釋放回 null」的快照/還原模式（比照
// project-map.md 記錄的 test:business-hours／test:store-settings／test:booking-policy
// 既有慣例，只是這裡快照的是「符合條件的 id 集合」而非固定列的欄位值）。**若執行過程
// 被強制中斷（例如程序被殺掉），還原不會執行**，需要人工檢查是否有非本檔案建立的
// 預約（customer_name 不含下方 TEST_MARKER 前綴）的 reminder_sent_at 在測試執行時間
// 附近被意外設成非 null，需要時手動改回 null。**不要對正式環境高頻率重複執行**。
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 依賴 Next.js 建置時才會設定的 "react-server" resolve condition，
// Vitest 走一般 Node 解析一律拿到會直接 throw 的版本，比照既有
// tests/api/appointment-events-webhook.test.ts／tests/api/appointment-reminders-cron.test.ts
// 的既有寫法 mock 成空模組。
vi.mock("server-only", () => ({}));

const sendEmailMock = vi.fn();
vi.mock("@/lib/email/resend-client", () => ({
  sendEmail: sendEmailMock,
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;
const cronSecret = process.env.CRON_SECRET;

if (!url || !serviceRoleKey || !webhookSecret || !cronSecret) {
  throw new Error(
    "[notifications.integration.test] 缺少 Supabase 專案設定或 SUPABASE_WEBHOOK_SECRET/" +
      "CRON_SECRET，請確認 .env.local 已填妥（見 .env.example）。",
  );
}

const TEST_MARKER = `__TEST__notifications-${Date.now()}`;
const WEBHOOK_ENDPOINT = "https://example.invalid/api/webhooks/appointment-events";
const CRON_ENDPOINT = "https://example.invalid/api/cron/appointment-reminders";

function postWebhook(body: unknown, headers: Record<string, string> = { "x-webhook-secret": webhookSecret! }) {
  return new NextRequest(WEBHOOK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function getCron(headers: Record<string, string> = { authorization: `Bearer ${cronSecret}` }) {
  return new NextRequest(CRON_ENDPOINT, { method: "GET", headers });
}

const insertPayload = (record: Record<string, unknown> | null) => ({
  type: "INSERT",
  table: "appointments",
  schema: "public",
  record,
  old_record: null,
});

const updatePayload = (record: Record<string, unknown> | null, oldRecord: Record<string, unknown> | null) => ({
  type: "UPDATE",
  table: "appointments",
  schema: "public",
  record,
  old_record: oldRecord,
});

// 比照既有整合測試檔案的 testPhone() 慣例：執行時間戳當前綴＋遞增序號，避免與前次
// 失敗未清乾淨的測試資料撞號。appointments.customer_phone 為 not null（見
// 0001_core_schema.sql），本檔案的 fixture 皆需要一個合成電話。
const phoneRunSeed = String(Date.now() % 100_000).padStart(5, "0");
let phoneSeq = 0;
function testPhone(): string {
  phoneSeq += 1;
  return `09${phoneRunSeed}${String(phoneSeq).padStart(3, "0")}`;
}

describe("Email 通知與提醒：前後端串接整合測試（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let testServiceId: string;
  let POST: typeof import("../app/api/webhooks/appointment-events/route").POST;
  let GET: typeof import("../app/api/cron/appointment-reminders/route").GET;

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: service, error: serviceError } = await serviceRoleClient
      .from("services")
      // is_active: false——本檔案全程用 service role 直接 insert appointments，不經過
      // get_available_slots／create_appointment，不需要顧客前台能查到這個測試服務；
      // 設成 false 可避免它在測試執行期間短暫出現在顧客前台的服務清單上
      // （security-reviewer 於本卡總覽審查提出的 NICE TO HAVE）。
      .insert({ name: `${TEST_MARKER} service`, price: 100, duration_minutes: 30, is_active: false })
      .select("id")
      .single();
    if (serviceError) throw serviceError;
    testServiceId = service.id;

    // vi.mock 已在檔案頂端 hoist 完成，這裡才 import route handler 確保拿到 mock 過的
    // sendEmail／server-only（比照 tests/api/appointment-events-webhook.test.ts 的既有
    // 寫法，差別是這裡不需要每個 it() 各自重新 import，全域 mock 一次即可）。
    ({ POST } = await import("../app/api/webhooks/appointment-events/route"));
    ({ GET } = await import("../app/api/cron/appointment-reminders/route"));
  });

  beforeEach(() => {
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({ ok: true, data: { id: "test-email-id" } });
  });

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];

    if (testServiceId) {
      const { error: deleteAppointmentsError } = await serviceRoleClient
        .from("appointments")
        .delete()
        .eq("service_id", testServiceId);
      if (deleteAppointmentsError) cleanupErrors.push(deleteAppointmentsError);

      const { error: deleteServiceError } = await serviceRoleClient.from("services").delete().eq("id", testServiceId);
      if (deleteServiceError) cleanupErrors.push(deleteServiceError);
    }

    if (cleanupErrors.length > 0) {
      throw new Error(
        `[notifications.integration.test] afterAll 清除失敗，殘留測試資料未被清乾淨：${JSON.stringify(cleanupErrors)}`,
      );
    }
  });

  // **關鍵**：一律先用 customer_email: null 建立列，需要非 null email 的情境再用
  // 「只改 customer_email 這一欄」的獨立 UPDATE 補上——這支測試檔案是對正式共用的
  // Supabase 專案執行，這張表上真的掛著 0011/0012 migration 建立的 Database
  // Webhook trigger，只要 INSERT 當下 customer_email 非 null 就會真的觸發，
  // pg_net 會把請求送到 Vault 設定的正式部署網址，讓正式環境用真實 Resend key
  // 寄信（或至少嘗試寄信）——這是本檔案 `vi.mock("@/lib/email/resend-client")`
  // 完全防不到的側路，因為那支 trigger 呼叫的是另一個行程（Vercel 上的正式部署），
  // 不是這個測試行程本身（security-reviewer 於本卡總覽審查發現的 MUST FIX）。
  // 拆成兩步後：INSERT 當下 customer_email 為 null，`0011` migration 的
  // `when (new.customer_email is not null)` 不成立，trigger 不會觸發；之後單獨
  // UPDATE customer_email 這一欄，`0012` migration 的 WHEN 子句只在
  // status／start_at／end_at 實際改變時才成立，只改 email 不會滿足條件，UPDATE
  // trigger 同樣不會觸發。兩步都不會驚動正式環境，本測試檔案自己對 POST/GET
  // handler 的呼叫（見下方 mocked sendEmail）才是唯一真正被驗證的路徑。
  async function insertAppointment(params: {
    name: string;
    startAt: string;
    endAt: string;
    status?: "pending" | "confirmed" | "completed" | "cancelled";
    customerEmail?: string | null;
  }): Promise<string> {
    const { data, error } = await serviceRoleClient
      .from("appointments")
      .insert({
        service_id: testServiceId,
        customer_name: `${TEST_MARKER} ${params.name}`,
        customer_phone: testPhone(),
        customer_email: null,
        start_at: params.startAt,
        end_at: params.endAt,
        ...(params.status ? { status: params.status } : {}),
      })
      .select("id")
      .single();
    if (error) throw error;

    const desiredEmail = params.customerEmail === undefined ? `${TEST_MARKER}@example.invalid` : params.customerEmail;
    if (desiredEmail !== null) {
      const { error: emailUpdateError } = await serviceRoleClient
        .from("appointments")
        .update({ customer_email: desiredEmail })
        .eq("id", data.id);
      if (emailUpdateError) throw emailUpdateError;
    }

    return data.id;
  }

  async function fetchAppointment(
    id: string,
  ): Promise<{ confirmation_sent_at: string | null; reminder_sent_at: string | null; status: string }> {
    const { data, error } = await serviceRoleClient
      .from("appointments")
      .select("confirmation_sent_at, reminder_sent_at, status")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  }

  // 離「現在」很近的固定時間點：service_id 已限定在本檔案自建的測試服務，時段本身
  // 是否與真實顧客的預約重疊不影響任何 exclusion constraint（appointments_no_overlap
  // 不分服務，但本檔案的 fixture 刻意挑選深夜時段降低真的撞期的機率）；即使撞期，
  // insert 也只會因 constraint 違反而報錯、不會寫入錯誤資料，重跑即可。
  function hoursFromNow(hours: number): string {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  describe("Webhook 端點（/api/webhooks/appointment-events）：密鑰驗證", () => {
    it("密鑰缺失時回傳 401，不查詢也不寄信", async () => {
      const res = await POST(postWebhook(insertPayload({ id: "11111111-1111-4111-8111-111111111111" }), {}));
      expect(res.status).toBe(401);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("密鑰錯誤時回傳 401", async () => {
      const res = await POST(postWebhook(insertPayload({ id: "11111111-1111-4111-8111-111111111111" }), {
        "x-webhook-secret": "wrong-secret",
      }));
      expect(res.status).toBe(401);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("密鑰正確、來源表格不是 appointments 時略過處理", async () => {
      const res = await POST(postWebhook({ type: "INSERT", table: "services", schema: "public", record: null, old_record: null }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, skipped: "unrecognized_source" });
    });
  });

  describe("Webhook 端點：INSERT 事件（確認信）對真實資料庫的查詢與去重", () => {
    it("有效 INSERT payload：寄出確認信、設定 confirmation_sent_at", async () => {
      const startAt = hoursFromNow(200);
      const endAt = hoursFromNow(200.5);
      const id = await insertAppointment({ name: "confirmation", startAt, endAt });

      const res = await POST(postWebhook(insertPayload({ id })));
      expect(res.status).toBe(200);

      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const [[sendArgs]] = sendEmailMock.mock.calls;
      expect(sendArgs.to).toBe(`${TEST_MARKER}@example.invalid`);
      expect(sendArgs.subject).toContain("預約確認");

      const after = await fetchAppointment(id);
      expect(after.confirmation_sent_at).not.toBeNull();
    });

    it("重複觸發同一筆 INSERT（confirmation_sent_at 已設定）：不重複寄信", async () => {
      const startAt = hoursFromNow(201);
      const endAt = hoursFromNow(201.5);
      const id = await insertAppointment({ name: "confirmation-dup", startAt, endAt });

      const first = await POST(postWebhook(insertPayload({ id })));
      expect(first.status).toBe(200);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);

      sendEmailMock.mockClear();

      const second = await POST(postWebhook(insertPayload({ id })));
      expect(second.status).toBe(200);
      const body = await second.json();
      expect(body).toEqual({ ok: true, skipped: "not_claimed" });
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("customer_email 為 null：仍設定 confirmation_sent_at（去重佔位），但不寄信", async () => {
      const startAt = hoursFromNow(202);
      const endAt = hoursFromNow(202.5);
      const id = await insertAppointment({ name: "confirmation-no-email", startAt, endAt, customerEmail: null });

      const res = await POST(postWebhook(insertPayload({ id })));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, skipped: "no_email" });
      expect(sendEmailMock).not.toHaveBeenCalled();

      const after = await fetchAppointment(id);
      expect(after.confirmation_sent_at).not.toBeNull();
    });

    it("寄信失敗：釋放 confirmation_sent_at 佔位供後續補寄", async () => {
      sendEmailMock.mockResolvedValueOnce({ ok: false, error: { code: "SEND_FAILED", message: "boom" } });

      const startAt = hoursFromNow(203);
      const endAt = hoursFromNow(203.5);
      const id = await insertAppointment({ name: "confirmation-fail", startAt, endAt });

      const res = await POST(postWebhook(insertPayload({ id })));
      expect(res.status).toBe(200);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);

      const after = await fetchAppointment(id);
      expect(after.confirmation_sent_at).toBeNull();
    });

    it("record.id 非合法 UUID：回傳 400 invalid_payload，不查詢資料庫", async () => {
      const res = await POST(postWebhook(insertPayload({ id: "not-a-uuid" })));
      expect(res.status).toBe(400);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("record.id 對應的預約不存在：回傳 skipped not_claimed", async () => {
      const res = await POST(postWebhook(insertPayload({ id: "00000000-0000-4000-8000-000000000000" })));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, skipped: "not_claimed" });
      expect(sendEmailMock).not.toHaveBeenCalled();
    });
  });

  describe("Webhook 端點：UPDATE 事件（取消／改期／標記完成）對真實資料庫的分派", () => {
    it("取消：分派到取消通知信", async () => {
      const startAt = hoursFromNow(210);
      const endAt = hoursFromNow(210.5);
      const id = await insertAppointment({ name: "cancel", startAt, endAt, status: "confirmed" });

      const oldSnapshot = { status: "confirmed", start_at: startAt, end_at: endAt };
      const newSnapshot = { id, status: "cancelled", start_at: startAt, end_at: endAt };

      const res = await POST(postWebhook(updatePayload(newSnapshot, oldSnapshot)));
      expect(res.status).toBe(200);

      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const [[sendArgs]] = sendEmailMock.mock.calls;
      expect(sendArgs.to).toBe(`${TEST_MARKER}@example.invalid`);
      expect(sendArgs.subject).toContain("預約已取消");
    });

    it("改期：分派到改期通知信", async () => {
      const oldStartAt = hoursFromNow(220);
      const oldEndAt = hoursFromNow(220.5);
      const newStartAt = hoursFromNow(230);
      const newEndAt = hoursFromNow(230.5);
      const id = await insertAppointment({ name: "reschedule", startAt: newStartAt, endAt: newEndAt, status: "confirmed" });

      const oldSnapshot = { status: "confirmed", start_at: oldStartAt, end_at: oldEndAt };
      const newSnapshot = { id, status: "confirmed", start_at: newStartAt, end_at: newEndAt };

      const res = await POST(postWebhook(updatePayload(newSnapshot, oldSnapshot)));
      expect(res.status).toBe(200);

      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const [[sendArgs]] = sendEmailMock.mock.calls;
      expect(sendArgs.subject).toContain("預約已改期");
    });

    it("標記完成（狀態變更但時段不變）：分類為 none，不寄信", async () => {
      const startAt = hoursFromNow(240);
      const endAt = hoursFromNow(240.5);
      const id = await insertAppointment({ name: "complete", startAt, endAt, status: "confirmed" });

      const oldSnapshot = { status: "confirmed", start_at: startAt, end_at: endAt };
      const newSnapshot = { id, status: "completed", start_at: startAt, end_at: endAt };

      const res = await POST(postWebhook(updatePayload(newSnapshot, oldSnapshot)));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, skipped: "no_notification_needed" });
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("customer_email 為 null：分類為取消仍略過寄信", async () => {
      const startAt = hoursFromNow(250);
      const endAt = hoursFromNow(250.5);
      const id = await insertAppointment({ name: "cancel-no-email", startAt, endAt, status: "confirmed", customerEmail: null });

      const oldSnapshot = { status: "confirmed", start_at: startAt, end_at: endAt };
      const newSnapshot = { id, status: "cancelled", start_at: startAt, end_at: endAt };

      const res = await POST(postWebhook(updatePayload(newSnapshot, oldSnapshot)));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, skipped: "no_email" });
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("UPDATE payload 缺少 old_record 欄位：回傳 400 invalid_payload", async () => {
      const res = await POST(postWebhook(
        updatePayload({ id: "11111111-1111-4111-8111-111111111111", status: "cancelled", start_at: "x", end_at: "y" }, null),
      ));
      expect(res.status).toBe(400);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("DELETE 事件：略過處理，回 200", async () => {
      const res = await POST(postWebhook({ type: "DELETE", table: "appointments", schema: "public", record: null, old_record: null }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, skipped: "type_not_handled" });
      expect(sendEmailMock).not.toHaveBeenCalled();
    });
  });

  describe("Cron 端點（/api/cron/appointment-reminders）：密鑰驗證", () => {
    it("Authorization header 缺失：回傳 401", async () => {
      const res = await GET(getCron({}));
      expect(res.status).toBe(401);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("Authorization header 密鑰錯誤：回傳 401", async () => {
      const res = await GET(getCron({ authorization: "Bearer wrong-secret" }));
      expect(res.status).toBe(401);
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it("Authorization header 缺少 Bearer 前綴：回傳 401", async () => {
      const res = await GET(getCron({ authorization: cronSecret! }));
      expect(res.status).toBe(401);
    });
  });

  // 見檔案頂端「重要風險提示」：這個區塊會呼叫真正的排程 GET handler，其查詢涵蓋整張
  // appointments 表，不限於本檔案建立的測試資料。
  //
  // **還原策略（security-reviewer 於本卡總覽審查修正過一版後的設計）**：不採用「執行前
  // 先快照當下符合條件的既有 id」——那個快照的時間窗是用測試開始當下的 `now()` 算的，
  // 但真正的 GET handler 在它自己被呼叫的當下重新呼叫 `computeReminderWindow(new
  // Date())`（本測試會呼叫兩次），兩個時間點的窗口會有些微飄移；更嚴重的是，若測試
  // 執行期間剛好有真實顧客透過顧客前台新建立一筆時段落在窗內的預約，那筆全新的資料
  // 不可能出現在「執行前」的快照裡，會被真的 claim 卻永遠不會被還原。
  // 改用「記錄測試開始前的時間戳，執行後把 reminder_sent_at 大於等於這個時間戳的所有
  // 列都還原回 null」——不論是本測試自建的 fixture、真實顧客的既有預約，還是測試執行
  // 期間才新增的真實預約，只要 reminder_sent_at 是在這段測試期間內被設定的，一律還原
  // （fixture 反正會在 afterAll 依 service_id 整批刪除，還原與否不影響）。
  // **已知殘留風險**：若正式 Vercel Cron（`vercel.json` 排定 `0 1 * * *` UTC）剛好與
  // 本測試同時執行，這個還原會誤把正式排程真的寄出去的提醒信對應的 reminder_sent_at
  // 也重設回 null，讓那些顧客隔天重複收到一次提醒信——避免在 UTC 01:00（台北時間
  // 09:00）前後執行本測試即可規避。
  describe("Cron 端點：時間窗篩選與 reminder_sent_at 去重（對真實資料庫）", () => {
    it("只 claim 時間窗內、狀態為 pending/confirmed 的預約；已取消或超出時間窗的不受影響", async () => {
      const testStartedAt = new Date().toISOString();

      const withinWindowId = await insertAppointment({
        name: "reminder-within-window",
        startAt: hoursFromNow(5),
        endAt: hoursFromNow(5.5),
        status: "confirmed",
      });
      const outsideWindowId = await insertAppointment({
        name: "reminder-outside-window",
        startAt: hoursFromNow(40),
        endAt: hoursFromNow(40.5),
        status: "confirmed",
      });
      const cancelledWithinWindowId = await insertAppointment({
        name: "reminder-cancelled-within-window",
        startAt: hoursFromNow(6),
        endAt: hoursFromNow(6.5),
        status: "cancelled",
      });

      try {
        const res = await GET(getCron());
        expect(res.status).toBe(200);
        const body = await res.json();
        // 不對 claimed／sent 斷言精確相等：時間窗內可能同時存在真實顧客的預約
        // （見檔案頂端風險提示），只驗證「至少涵蓋了本測試新建立的那一筆」。
        expect(body.ok).toBe(true);
        expect(body.claimed).toBeGreaterThanOrEqual(1);

        const withinAfter = await fetchAppointment(withinWindowId);
        expect(withinAfter.reminder_sent_at).not.toBeNull();

        const outsideAfter = await fetchAppointment(outsideWindowId);
        expect(outsideAfter.reminder_sent_at).toBeNull();

        const cancelledAfter = await fetchAppointment(cancelledWithinWindowId);
        expect(cancelledAfter.reminder_sent_at).toBeNull();

        expect(sendEmailMock).toHaveBeenCalled();
        const calledEmails = sendEmailMock.mock.calls.map(([args]) => args.to);
        expect(calledEmails).toContain(`${TEST_MARKER}@example.invalid`);

        // 去重：緊接著再呼叫一次，剛剛已 claim 的這筆不應該被重新處理（sendEmail
        // 呼叫次數不會再為它增加一次）。
        sendEmailMock.mockClear();
        const second = await GET(getCron());
        expect(second.status).toBe(200);
        const secondCalledEmails = sendEmailMock.mock.calls.map(([args]) => args.to);
        const occurrences = secondCalledEmails.filter((email) => email === `${TEST_MARKER}@example.invalid`).length;
        expect(occurrences).toBe(0);
      } finally {
        // 還原：見上方 describe 區塊註解——把「這段測試期間內」被設定 reminder_sent_at
        // 的所有列（含可能的真實顧客預約）釋放回 null。
        const { error } = await serviceRoleClient
          .from("appointments")
          .update({ reminder_sent_at: null })
          .gte("reminder_sent_at", testStartedAt);
        if (error) {
          throw new Error(
            `[notifications.integration.test] 還原 reminder_sent_at 失敗，需要人工檢查` +
              `${testStartedAt} 之後是否有預約被誤標記為已提醒：${error.message}`,
          );
        }
      }
    });
  });
});
