import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// server-only 依賴 Next.js 建置時才會設定的 "react-server" resolve condition，
// Vitest 走一般 Node 解析一律拿到會直接 throw 的版本，比照既有
// tests/api/appointment-events-webhook.test.ts 的既有寫法 mock 成空模組。
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  supabaseClient: null as unknown as {
    from: ReturnType<typeof vi.fn>;
    appointmentsUpdateMock: ReturnType<typeof vi.fn>;
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => state.supabaseClient,
}));

vi.mock("@/lib/email/resend-client", () => ({
  sendEmail: state.sendEmailMock,
}));

type TableResponse = { data: unknown; error: { message: string } | null };

// claimAppointmentsForReminder 現在用內嵌的 services(name) 一次查完服務名稱
// （TASK-054 審查後修正，避免逐筆 N+1 查詢），claim 回傳的原始列形狀含
// services 欄位。
const DEFAULT_CLAIM_ROWS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    customer_name: "王小明",
    customer_email: "customer@example.invalid",
    start_at: "2026-08-25T09:00:00+08:00",
    services: { name: "剪髮" },
  },
];

// 真正執行 lib/admin/appointment-reminders.ts 的 claimAppointmentsForReminder／
// releaseReminderClaim（不 mock 這兩個函式本身），只 mock 它們底層依賴的
// supabase client，測試 route.ts 與這兩支函式的實際整合方式。
function createSupabaseMock(overrides: {
  claim?: TableResponse;
  storeSettings?: TableResponse;
} = {}) {
  const claim = overrides.claim ?? { data: DEFAULT_CLAIM_ROWS, error: null };
  const storeSettings = overrides.storeSettings ?? {
    data: { name: "測試髮廊", address: null, phone: "0912345678", description: null, logo_url: null, cover_image_url: null },
    error: null,
  };

  const appointmentsUpdateMock = vi.fn((payload: Record<string, unknown>) => {
    if (payload.reminder_sent_at === null) {
      // releaseReminderClaim：route.ts 沒有 .select()，直接以 { error } 結束鏈。
      return { eq: vi.fn(async () => ({ error: null })) };
    }
    // claimAppointmentsForReminder：
    // .update().gte().lt().in().is().order().limit().select()。
    const chainable: Record<string, ReturnType<typeof vi.fn>> = {};
    chainable.gte = vi.fn(() => chainable);
    chainable.lt = vi.fn(() => chainable);
    chainable.in = vi.fn(() => chainable);
    chainable.is = vi.fn(() => chainable);
    chainable.order = vi.fn(() => chainable);
    chainable.limit = vi.fn(() => chainable);
    chainable.select = vi.fn(async () => claim);
    return chainable;
  });

  const from = vi.fn((table: string) => {
    if (table === "appointments") {
      return { update: appointmentsUpdateMock };
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

const ENDPOINT = "https://example.invalid/api/cron/appointment-reminders";
const SECRET = "test-cron-secret";

function cronRequest(headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  return new NextRequest(ENDPOINT, { method: "GET", headers });
}

describe("GET /api/cron/appointment-reminders", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    state.supabaseClient = createSupabaseMock();
    state.sendEmailMock.mockReset();
    state.sendEmailMock.mockResolvedValue({ ok: true, data: { id: "email-1" } });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("密鑰缺失時回傳 401，不查詢也不寄信", async () => {
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest({}));

    expect(res.status).toBe(401);
    expect(state.supabaseClient.from).not.toHaveBeenCalled();
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("密鑰錯誤時回傳 401，不查詢也不寄信", async () => {
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest({ authorization: "Bearer wrong-secret" }));

    expect(res.status).toBe(401);
    expect(state.supabaseClient.from).not.toHaveBeenCalled();
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 未設定時一律拒絕（fail closed）", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());

    expect(res.status).toBe(401);
    expect(state.supabaseClient.from).not.toHaveBeenCalled();
  });

  it("Authorization header 不是 Bearer 格式時回傳 401", async () => {
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest({ authorization: SECRET }));

    expect(res.status).toBe(401);
  });

  it("查無符合條件的預約時回傳 sent:0/claimed:0，不查詢店家資料也不寄信", async () => {
    state.supabaseClient = createSupabaseMock({ claim: { data: [], error: null } });
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, sent: 0, claimed: 0 });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("查詢/去重更新失敗時回傳 500（排程健康訊號，不能吞成 200）", async () => {
    state.supabaseClient = createSupabaseMock({ claim: { data: null, error: { message: "db error" } } });
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "query_failed" });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  it("成功時對每筆有 email 的預約寄出提醒信，回傳 sent／claimed 統計", async () => {
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, sent: 1, claimed: 1 });
    expect(state.sendEmailMock).toHaveBeenCalledTimes(1);
    const call = state.sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe("customer@example.invalid");
    expect(call.subject).toContain("預約提醒");
    expect(call.subject).toContain("剪髮");
    expect(call.html).toContain("王小明");
    expect(call.html).toContain("測試髮廊");
  });

  it("claim 到的 customer_email 為 null 時跳過該筆寄信，不計入 sent，也不釋放去重佔位", async () => {
    state.supabaseClient = createSupabaseMock({
      claim: { data: [{ ...DEFAULT_CLAIM_ROWS[0], customer_email: null }], error: null },
    });
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, sent: 0, claimed: 1 });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
    expect(state.supabaseClient.appointmentsUpdateMock).not.toHaveBeenCalledWith({ reminder_sent_at: null });
  });

  it("services 查無資料時（內嵌 join 回傳 null）仍寄信，使用通用服務名稱 fallback", async () => {
    state.supabaseClient = createSupabaseMock({
      claim: { data: [{ ...DEFAULT_CLAIM_ROWS[0], services: null }], error: null },
    });
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    const call = state.sendEmailMock.mock.calls[0][0];
    expect(call.subject).toContain("服務");
  });

  it("store_settings 查無資料時仍寄信，使用預設店名且不出現聯絡方式段落", async () => {
    state.supabaseClient = createSupabaseMock({ storeSettings: { data: null, error: null } });
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    const call = state.sendEmailMock.mock.calls[0][0];
    expect(call.html).toContain("提醒您在我們的預約即將到來");
    expect(call.html).not.toContain("如有問題");
  });

  it("Resend 寄送失敗時仍回傳 200、sent:0，並釋放去重佔位（reminder_sent_at 補償回 null）供下次排程重試", async () => {
    state.sendEmailMock.mockResolvedValue({ ok: false, error: { message: "failed", code: "SEND_FAILED" } });
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, sent: 0, claimed: 1 });
    expect(state.supabaseClient.appointmentsUpdateMock).toHaveBeenCalledWith({ reminder_sent_at: null });
  });

  it("單筆組信過程拋出例外時不中斷整批次，其餘預約仍會繼續處理", async () => {
    state.supabaseClient = createSupabaseMock({
      claim: {
        data: [
          { ...DEFAULT_CLAIM_ROWS[0], id: "aaaaaaaa-1111-4111-8111-111111111111", start_at: "not-a-valid-date" },
          { ...DEFAULT_CLAIM_ROWS[0], id: "bbbbbbbb-2222-4111-8111-111111111111" },
        ],
        error: null,
      },
    });
    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // 第一筆時間字串無效導致組信例外（釋放去重佔位、不寄信），第二筆正常寄出。
    expect(body).toEqual({ ok: true, sent: 1, claimed: 2 });
    expect(state.sendEmailMock).toHaveBeenCalledTimes(1);
    expect(state.supabaseClient.appointmentsUpdateMock).toHaveBeenCalledWith({ reminder_sent_at: null });
  });

  it("同一批次中連續兩筆都寄信失敗時，各自獨立釋放去重佔位，互不干擾", async () => {
    state.supabaseClient = createSupabaseMock({
      claim: {
        data: [
          { ...DEFAULT_CLAIM_ROWS[0], id: "aaaaaaaa-1111-4111-8111-111111111111" },
          { ...DEFAULT_CLAIM_ROWS[0], id: "bbbbbbbb-2222-4111-8111-111111111111" },
        ],
        error: null,
      },
    });
    state.sendEmailMock.mockResolvedValue({ ok: false, error: { message: "failed", code: "SEND_FAILED" } });

    const { GET } = await import("@/app/api/cron/appointment-reminders/route");
    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, sent: 0, claimed: 2 });
    expect(state.sendEmailMock).toHaveBeenCalledTimes(2);
  });
});
