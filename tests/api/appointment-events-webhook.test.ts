import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 依賴 Next.js 建置時才會設定的 "react-server" resolve condition，
// Vitest 走一般 Node 解析一律拿到會直接 throw 的版本，比照既有
// tests/lib/email-resend-client.test.ts／supabase-service-role.test.ts 的既有寫法 mock 成空模組。
vi.mock("server-only", () => ({}));

// createServiceRoleClient／sendEmail 用 vi.hoisted 建立可在測試案例間重新指派的
// 參照：vi.mock 的 factory 會被提升到檔案最頂端執行，直接閉包一般 `let` 變數會撞到
// TDZ，vi.hoisted 是 Vitest 官方建議的寫法。
const state = vi.hoisted(() => ({
  supabaseClient: null as unknown as { from: ReturnType<typeof vi.fn>; appointmentsUpdateMock: ReturnType<typeof vi.fn> },
  sendEmailMock: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => state.supabaseClient,
}));

vi.mock("@/lib/email/resend-client", () => ({
  sendEmail: state.sendEmailMock,
}));

type TableResponse = { data: unknown; error: { message: string } | null };

const DEFAULT_CLAIMED = {
  customer_name: "王小明",
  customer_email: "customer@example.invalid",
  start_at: "2026-08-24T09:00:00+08:00",
  service_id: "svc-1",
};

function createSupabaseMock(overrides: {
  update?: TableResponse;
  services?: TableResponse;
  storeSettings?: TableResponse;
} = {}) {
  const update = overrides.update ?? { data: DEFAULT_CLAIMED, error: null };
  const services = overrides.services ?? { data: { name: "剪髮" }, error: null };
  const storeSettings = overrides.storeSettings ?? {
    data: { name: "測試髮廊", address: null, phone: "0912345678", description: null, logo_url: null, cover_image_url: null },
    error: null,
  };

  // 用於斷言「去重更新」被呼叫時實際帶入的更新內容（例如驗證失敗補償路徑真的把
  // confirmation_sent_at 寫回 null）。
  const appointmentsUpdateMock = vi.fn((payload: Record<string, unknown>) => {
    if (payload.confirmation_sent_at === null) {
      // 補償釋放呼叫：route.ts 沒有 .select()，直接以 { error } 結束鏈。
      return { eq: vi.fn(async () => ({ error: null })) };
    }
    return {
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => update),
          })),
        })),
      })),
    };
  });

  const from = vi.fn((table: string) => {
    if (table === "appointments") {
      return { update: appointmentsUpdateMock };
    }
    if (table === "services") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => services),
          })),
        })),
      };
    }
    if (table === "store_settings") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => storeSettings),
          })),
        })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, appointmentsUpdateMock };
}

const ENDPOINT = "https://example.invalid/api/webhooks/appointment-events";
const SECRET = "test-webhook-secret";
const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";

function postRequest(body: unknown, headers: Record<string, string> = { "x-webhook-secret": SECRET }) {
  return new NextRequest(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const insertPayload = (record: Record<string, unknown> | null) => ({
  type: "INSERT",
  table: "appointments",
  schema: "public",
  record,
  old_record: null,
});

describe("POST /api/webhooks/appointment-events", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_WEBHOOK_SECRET = SECRET;
    state.supabaseClient = createSupabaseMock();
    state.sendEmailMock.mockReset();
    state.sendEmailMock.mockResolvedValue({ ok: true, data: { id: "email-1" } });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("密鑰缺失時回傳 401，不查詢也不寄信", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID }), {}));

    expect(res.status).toBe(401);
    expect(state.supabaseClient.from).not.toHaveBeenCalled();
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("密鑰錯誤時回傳 401，不查詢也不寄信", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID }), { "x-webhook-secret": "wrong-secret" }));

    expect(res.status).toBe(401);
    expect(state.supabaseClient.from).not.toHaveBeenCalled();
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("SUPABASE_WEBHOOK_SECRET 未設定時一律拒絕（fail closed），不查詢也不寄信", async () => {
    delete process.env.SUPABASE_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));

    expect(res.status).toBe(401);
    expect(state.supabaseClient.from).not.toHaveBeenCalled();
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("claim 到的 customer_email 為 null 時跳過寄信，回傳成功狀態", async () => {
    state.supabaseClient = createSupabaseMock({
      update: { data: { ...DEFAULT_CLAIMED, customer_email: null }, error: null },
    });
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "no_email" });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("密鑰正確時，用回讀的資料庫欄位組信件內容並呼叫 Resend 寄送（不信任 payload 內容）", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    // payload 帶入與資料庫回讀值不同的假姓名/信箱，驗證 route 確實忽略 payload 內容。
    const res = await POST(
      postRequest(insertPayload({ id: APPOINTMENT_ID, customer_name: "偽造姓名", customer_email: "attacker@evil.invalid" })),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(state.sendEmailMock).toHaveBeenCalledTimes(1);
    const call = state.sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe(DEFAULT_CLAIMED.customer_email);
    expect(call.subject).toContain("剪髮");
    expect(call.html).toContain("王小明");
    expect(call.html).toContain("測試髮廊");
    expect(call.html).not.toContain("偽造姓名");
  });

  it("services 查詢查無資料時仍寄信，使用通用服務名稱 fallback", async () => {
    state.supabaseClient = createSupabaseMock({ services: { data: null, error: null } });
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));

    expect(res.status).toBe(200);
    const call = state.sendEmailMock.mock.calls[0][0];
    expect(call.subject).toContain("服務");
  });

  it("store_settings 查詢查無資料時仍寄信，使用預設店名且不出現聯絡方式段落", async () => {
    state.supabaseClient = createSupabaseMock({ storeSettings: { data: null, error: null } });
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));

    expect(res.status).toBe(200);
    const call = state.sendEmailMock.mock.calls[0][0];
    expect(call.html).toContain("您在我們的預約已成立");
    expect(call.html).not.toContain("如需異動預約");
  });

  it("已處理過（confirmation_sent_at 去重更新未搶到）時跳過寄信", async () => {
    state.supabaseClient = createSupabaseMock({ update: { data: null, error: null } });
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "not_claimed" });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("去重更新查詢失敗時仍回傳 200，不寄信（不影響 webhook 端點回應）", async () => {
    state.supabaseClient = createSupabaseMock({ update: { data: null, error: { message: "db error" } } });
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));

    expect(res.status).toBe(200);
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("Resend 呼叫失敗時仍回傳 200，並釋放去重佔位（confirmation_sent_at 補償回 null）供後續補寄", async () => {
    state.sendEmailMock.mockResolvedValue({ ok: false, error: { message: "failed", code: "SEND_FAILED" } });
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(state.supabaseClient.appointmentsUpdateMock).toHaveBeenCalledWith({ confirmation_sent_at: null });
  });

  it("組信/寄信過程拋出例外時仍回傳 200，並釋放去重佔位供後續補寄", async () => {
    state.supabaseClient = createSupabaseMock({
      update: { data: { ...DEFAULT_CLAIMED, start_at: "not-a-valid-date" }, error: null },
    });
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: APPOINTMENT_ID })));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
    expect(state.supabaseClient.appointmentsUpdateMock).toHaveBeenCalledWith({ confirmation_sent_at: null });
  });

  it("payload record 為 null 時回傳 400", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload(null)));

    expect(res.status).toBe(400);
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("payload id 不是合法 UUID 時回傳 400", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(postRequest(insertPayload({ id: "not-a-uuid" })));

    expect(res.status).toBe(400);
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("非 JSON body 時回傳 400", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const req = new NextRequest(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": SECRET },
      body: "not-json",
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("schema/table 非 public.appointments 時直接 ack，不查詢也不寄信", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(
      postRequest({ type: "INSERT", table: "other_table", schema: "public", record: { id: APPOINTMENT_ID }, old_record: null }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "unrecognized_source" });
    expect(state.supabaseClient.from).not.toHaveBeenCalled();
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("type 為 UPDATE 時目前先 ack 不處理（TASK-053 的範圍）", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(
      postRequest({
        type: "UPDATE",
        table: "appointments",
        schema: "public",
        record: { id: APPOINTMENT_ID },
        old_record: { id: APPOINTMENT_ID },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "type_not_handled" });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });
});
