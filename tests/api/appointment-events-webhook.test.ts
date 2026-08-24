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
  supabaseClient: null as unknown as {
    from: ReturnType<typeof vi.fn>;
    appointmentsUpdateMock: ReturnType<typeof vi.fn>;
    appointmentsSelectMock: ReturnType<typeof vi.fn>;
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

const DEFAULT_CLAIMED = {
  customer_name: "王小明",
  customer_email: "customer@example.invalid",
  start_at: "2026-08-24T09:00:00+08:00",
  service_id: "svc-1",
};

// UPDATE 分支的「識別性欄位」回讀（TASK-053 修正後：不再回讀 status/start_at/
// end_at，那些一律用 payload 的 record/old_record 快照，見 route.ts 檔頭說明）。
const DEFAULT_IDENTITY = {
  customer_name: "王小明",
  customer_email: "customer@example.invalid",
  service_id: "svc-1",
};

function createSupabaseMock(overrides: {
  update?: TableResponse;
  services?: TableResponse;
  storeSettings?: TableResponse;
  identityRead?: TableResponse;
} = {}) {
  const update = overrides.update ?? { data: DEFAULT_CLAIMED, error: null };
  const services = overrides.services ?? { data: { name: "剪髮" }, error: null };
  const storeSettings = overrides.storeSettings ?? {
    data: { name: "測試髮廊", address: null, phone: "0912345678", description: null, logo_url: null, cover_image_url: null },
    error: null,
  };
  const identityRead = overrides.identityRead ?? { data: DEFAULT_IDENTITY, error: null };

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

  // handleAppointmentUpdate 用 .select().eq().maybeSingle() 讀取識別性欄位
  // （customer_name/customer_email/service_id），不再讀 status/start_at/end_at。
  const appointmentsSelectMock = vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(async () => identityRead),
    })),
  }));

  const from = vi.fn((table: string) => {
    if (table === "appointments") {
      return { update: appointmentsUpdateMock, select: appointmentsSelectMock };
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

  return { from, appointmentsUpdateMock, appointmentsSelectMock };
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

// TASK-053 修正後（architect 審查發現 race condition）：UPDATE payload 的
// record／old_record 都是同一次 UPDATE 語句的完整前後快照，不再只送 record 的
// id 讓 route 端事後重讀資料庫。
const OLD_SNAPSHOT_PENDING = {
  status: "pending",
  start_at: "2026-08-20T09:00:00+08:00",
  end_at: "2026-08-20T09:30:00+08:00",
};

const CANCELLED_RECORD = {
  id: APPOINTMENT_ID,
  status: "cancelled",
  start_at: OLD_SNAPSHOT_PENDING.start_at,
  end_at: OLD_SNAPSHOT_PENDING.end_at,
};

const RESCHEDULED_RECORD = {
  id: APPOINTMENT_ID,
  status: "pending",
  start_at: "2026-08-26T13:30:00+08:00",
  end_at: "2026-08-26T14:00:00+08:00",
};

const updatePayload = (
  record: Record<string, unknown> | null,
  oldRecord: Record<string, unknown> | null = OLD_SNAPSHOT_PENDING,
) => ({
  type: "UPDATE",
  table: "appointments",
  schema: "public",
  record,
  old_record: oldRecord,
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

  it("type 為 DELETE 時直接 ack 不處理（本 Epic 不涵蓋刪除事件）", async () => {
    const { POST } = await import("@/app/api/webhooks/appointment-events/route");
    const res = await POST(
      postRequest({
        type: "DELETE",
        table: "appointments",
        schema: "public",
        record: null,
        old_record: { id: APPOINTMENT_ID },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "type_not_handled" });
    expect(state.sendEmailMock).not.toHaveBeenCalled();
  });

  describe("UPDATE 事件（TASK-053：取消／改期通知信）", () => {
    it("status 由 pending 變 cancelled 時寄出取消通知信，分類與內容皆用 payload 快照（不重讀資料庫的 status/start_at/end_at）", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(state.sendEmailMock).toHaveBeenCalledTimes(1);
      const call = state.sendEmailMock.mock.calls[0][0];
      expect(call.to).toBe(DEFAULT_IDENTITY.customer_email);
      expect(call.subject).toContain("預約已取消");
      expect(call.subject).toContain("剪髮");
      expect(call.html).toContain("王小明");
      expect(call.html).toContain("測試髮廊");
    });

    it("start_at 變更且新 status 非 cancelled 時寄出改期通知信，包含原時段與新時段", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(RESCHEDULED_RECORD)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
      const call = state.sendEmailMock.mock.calls[0][0];
      expect(call.subject).toContain("預約已改期");
      expect(call.html).toContain("2026/08/20（四）09:00");
      expect(call.html).toContain("2026/08/26（三）13:30");
    });

    it("分類結果為 none（例如標記完成）時不寄信，回傳 no_notification_needed，且不查詢識別性欄位", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const completedRecord = { id: APPOINTMENT_ID, ...OLD_SNAPSHOT_PENDING, status: "completed" };
      const res = await POST(postRequest(updatePayload(completedRecord)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, skipped: "no_notification_needed" });
      expect(state.sendEmailMock).not.toHaveBeenCalled();
      expect(state.supabaseClient.appointmentsSelectMock).not.toHaveBeenCalled();
    });

    it("回讀的 customer_email 為 null 時跳過寄信（取消情境）", async () => {
      state.supabaseClient = createSupabaseMock({
        identityRead: { data: { ...DEFAULT_IDENTITY, customer_email: null }, error: null },
      });
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, skipped: "no_email" });
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("回讀的 customer_email 為 null 時跳過寄信（改期情境，驗收標準明訂取消/改期皆須涵蓋）", async () => {
      state.supabaseClient = createSupabaseMock({
        identityRead: { data: { ...DEFAULT_IDENTITY, customer_email: null }, error: null },
      });
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(RESCHEDULED_RECORD)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, skipped: "no_email" });
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("services 查詢查無資料時仍寄出取消信，使用通用服務名稱 fallback（對稱於 INSERT 分支的既有測試）", async () => {
      state.supabaseClient = createSupabaseMock({ services: { data: null, error: null } });
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD)));

      expect(res.status).toBe(200);
      const call = state.sendEmailMock.mock.calls[0][0];
      expect(call.subject).toContain("服務");
    });

    it("找不到對應預約（identityRead 回傳 null）時回傳 not_found，不寄信", async () => {
      state.supabaseClient = createSupabaseMock({ identityRead: { data: null, error: null } });
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, skipped: "not_found" });
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("讀取識別性欄位查詢失敗時仍回傳 200，不寄信", async () => {
      state.supabaseClient = createSupabaseMock({
        identityRead: { data: null, error: { message: "db error" } },
      });
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD)));

      expect(res.status).toBe(200);
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("Resend 寄送失敗時仍回傳 200（UPDATE 分支沒有去重佔位可釋放，只記 log）", async () => {
      state.sendEmailMock.mockResolvedValue({ ok: false, error: { message: "failed", code: "SEND_FAILED" } });
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
    });

    it("record 的 start_at/end_at 無法解析成合法時間時回傳 400（在型別守衛階段就擋下，不留到組信時才失敗）", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const invalidTimeRecord = { ...CANCELLED_RECORD, start_at: "not-a-valid-date", end_at: "not-a-valid-date" };
      const res = await POST(postRequest(updatePayload(invalidTimeRecord)));

      expect(res.status).toBe(400);
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("查詢識別性欄位後、組信階段拋出未預期例外時仍回傳 200，不讓例外往外傳", async () => {
      // 手刻一個在 services 查詢時直接 throw 的 supabase client，模擬非「回傳
      // {error}」而是連線層級例外的情境（真實 SDK 偶發網路例外時的行為）。
      const throwingFrom = vi.fn((table: string) => {
        if (table === "appointments") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: DEFAULT_IDENTITY, error: null })),
              })),
            })),
          };
        }
        if (table === "services") {
          return {
            select: vi.fn(() => {
              throw new Error("unexpected connection error");
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      });
      state.supabaseClient = { from: throwingFrom, appointmentsUpdateMock: vi.fn(), appointmentsSelectMock: vi.fn() };

      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD)));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("record id 不是合法 UUID 時回傳 400", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload({ ...CANCELLED_RECORD, id: "not-a-uuid" })));

      expect(res.status).toBe(400);
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("record 缺少 status/start_at/end_at 時回傳 400", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload({ id: APPOINTMENT_ID })));

      expect(res.status).toBe(400);
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("old_record 缺少必要欄位（例如只有 id、沒有 status/start_at/end_at）時回傳 400", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD, { id: APPOINTMENT_ID })));

      expect(res.status).toBe(400);
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("record 為 null 時回傳 400", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(null)));

      expect(res.status).toBe(400);
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("old_record 整個為 null 時回傳 400", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");
      const res = await POST(postRequest(updatePayload(CANCELLED_RECORD, null)));

      expect(res.status).toBe(400);
      expect(state.sendEmailMock).not.toHaveBeenCalled();
    });

    it("同一筆預約短時間內先改期又取消：兩次 webhook 各自用自己的 payload 快照分類，不會都被誤判成取消（race condition 修正的迴歸測試）", async () => {
      const { POST } = await import("@/app/api/webhooks/appointment-events/route");

      // 第一次 webhook：改期事件（old=pending/舊時段, new=pending/新時段）。
      const rescheduleRes = await POST(postRequest(updatePayload(RESCHEDULED_RECORD, OLD_SNAPSHOT_PENDING)));
      // 第二次 webhook：取消事件（old=pending/新時段, new=cancelled/新時段）——
      // 即使這次處理時，「資料庫當下值」可能已經是 cancelled，分類仍只依據這次
      // payload 自己的 old/new 快照，不受另一次 webhook 影響。
      const cancelOldRecord = { status: "pending", start_at: RESCHEDULED_RECORD.start_at, end_at: RESCHEDULED_RECORD.end_at };
      const cancelRecord = { ...RESCHEDULED_RECORD, status: "cancelled" };
      const cancelRes = await POST(postRequest(updatePayload(cancelRecord, cancelOldRecord)));

      expect(rescheduleRes.status).toBe(200);
      expect(cancelRes.status).toBe(200);
      expect(state.sendEmailMock).toHaveBeenCalledTimes(2);
      expect(state.sendEmailMock.mock.calls[0][0].subject).toContain("預約已改期");
      expect(state.sendEmailMock.mock.calls[1][0].subject).toContain("預約已取消");
    });
  });
});
