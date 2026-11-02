// TASK-120：對真實 Supabase 專案執行的整合測試，驗證 0030_booking_limit_rolling_window.sql：
//   create_appointment 在既有「未來待服務 ≥ 3」之外，另加「過去 24 小時內建立、不分狀態 ≥ 3」的滾動視窗，
//   電話與 Email 各一道；把預約改成 cancelled 不再釋放額度（TASK-114 審查 R1 的「靜默取消解除上限」迴圈）。
//
// 不放進預設 `npm test`，只透過 `npm run test:booking-limit` 執行（缺設定時直接噴錯，不略過）。
//
// 兩種模式（驗收標準：_down 後行為恢復；套用前可先跑一次當基準）：
//   預設（滾動視窗生效中）：npm run test:booking-limit
//   套用 0030 之前，或套用 _down.sql 之後：
//     PowerShell  $env:BOOKING_LIMIT_EXPECT="off"; npm run test:booking-limit
//     Bash        BOOKING_LIMIT_EXPECT=off npm run test:booking-limit
//   off 模式下：取消後重新預約不被擋（也就是被堵住的攻擊情境）。鑑別力：每個「生效中被擋」的斷言在 off 模式
//   都有對應的「沒被擋」斷言；「原檢查仍生效」「視窗外可建立」等不隨模式改變的斷言兩種模式都成立。
//
// 只建立與刪除自己的拋棄式資料：
//   * 服務、設計師、預約、顧客一律以 TEST_MARKER（__TEST__booking-limit-<時間戳>）標記，afterAll 清除；
//     日期取今天起第 83 天之後的營業日（與 test:booking 的 +70 天區段不同），且只有測試設計師對測試服務開放，
//     不會佔用真實設計師的時段。
//   * 顧客電話每個案例用不同號碼（09 + 時間戳 + 流水號），互不影響。
//   * 一律用 anon 呼叫 create_appointment（與公開預約入口相同的角色）；改成 cancelled 與調整 created_at 用 service_role。
//
// 信件安全（見 feedback：整合測試小心真實 DB trigger）：
//   * 電話案例的 customer_email 一律 null（0011 的確認信只在 email 非 null 時才寄）。
//   * Email 案例必須帶 Email，會寄出確認信，收件人只用 Resend 官方測試位址 delivered+...@resend.dev（約 4～5 封：確認信 4 封，另有極小機率的取消信競態，見下一條）。
//     注意 _email_dedupe_key 會去掉 +標籤，所以所有 delivered+*@resend.dev 同屬一個 Email 計數鍵——Email 案例只有一個，
//     且 beforeAll 會確認沒有別人的預約佔用這個鍵。
//   * 把預約改成 cancelled 會觸發 0012 的取消通知信（email 非 null 時），所以 Email 案例取消前先把 customer_email
//     設成 null、取消後再補回（只改 email 的 UPDATE 不滿足任何觸發條件）。調整 created_at 同樣不滿足觸發條件。
//     殘留競態：webhook 是 pg_net 非同步送出、route 處理時才重讀 customer_email，若補回 email 早於 route 讀取就可能多寄 1 封取消信，
//     收件人仍是 Resend 測試位址，風險可接受（要完全避免得等 webhook 處理完，會增加 flaky，不採用）。
//   * 被中斷的執行若殘留資料，下次 beforeAll 會因 Email 計數鍵被占用而中止；清除：delete from appointments where customer_name like '__TEST__booking-limit-%';
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestDesigners, createTestDesigner } from "./helpers/designer-fixture";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error("[booking-limit.integration.test] 缺少 Supabase 專案設定，請確認 .env.local 已填妥。");
}

const windowActive = process.env.BOOKING_LIMIT_EXPECT !== "off";
const TEST_MARKER = `__TEST__booking-limit-${Date.now()}`;
const TZ_OFFSET = "+08:00";
const LIMIT_MESSAGE = "too many pending appointments";
const HOUR = 3_600_000;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

type RpcEnvelope = { ok: true; data: unknown } | { ok: false; error_code: string; message: string };

const pad = (n: number) => String(n).padStart(2, "0");
const taipeiToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
const addDays = (dateStr: string, days: number) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};
const weekdayOf = (dateStr: string) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
const isoAt = (dateStr: string, hh: number, mm: number) => new Date(`${dateStr}T${pad(hh)}:${pad(mm)}:00${TZ_OFFSET}`).toISOString();
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

// 營業日（週一至六，週日公休）：從第 83 天起取 5 天，每天 10:00–16:30 每 30 分鐘一格，共 70 格，依序發放、不重複使用。
function buildSlotPool(): string[] {
  const dates: string[] = [];
  let date = addDays(taipeiToday(), 83);
  while (dates.length < 5) {
    if (weekdayOf(date) !== 0) dates.push(date);
    date = addDays(date, 1);
  }
  const slots: string[] = [];
  for (const d of dates) {
    for (let minutes = 10 * 60; minutes <= 16 * 60 + 30; minutes += 30) {
      slots.push(isoAt(d, Math.floor(minutes / 60), minutes % 60));
    }
  }
  return slots;
}

const phoneSeed = String(Date.now() % 100_000).padStart(5, "0");
let phoneSeq = 0;
const testPhone = () => `09${phoneSeed}${String(++phoneSeq).padStart(3, "0")}`;

describe(`create_appointment 滾動視窗（TASK-120，${windowActive ? "生效中" : "off 模式：套用前／回滾後"}）`, () => {
  const admin: SupabaseClient = createClient(url!, serviceRoleKey!, clientOptions);
  const anon: SupabaseClient = createClient(url!, anonKey!, clientOptions);
  const slots = buildSlotPool();
  let slotCursor = 0;
  let nameSeq = 0;
  let serviceId: string;
  let designerId: string;

  const nextSlot = () => {
    if (slotCursor >= slots.length) throw new Error("時段用完了，請減少案例或擴大時段池");
    return slots[slotCursor++];
  };

  async function book(input: { phone: string; email?: string | null; label: string }): Promise<{ envelope: RpcEnvelope; name: string }> {
    const name = `${TEST_MARKER} ${input.label}-${++nameSeq}`;
    const { data, error } = await anon.rpc("create_appointment", {
      p_service_id: serviceId,
      p_start_at: nextSlot(),
      p_customer_name: name,
      p_customer_phone: input.phone,
      p_customer_email: input.email ?? null,
    });
    if (error) throw error;
    return { envelope: data as RpcEnvelope, name };
  }

  async function bookOk(input: { phone: string; email?: string | null; label: string }): Promise<string> {
    const { envelope, name } = await book(input);
    expect(envelope, `預期成功：${name}`).toMatchObject({ ok: true });
    return name;
  }

  function expectLimit(envelope: RpcEnvelope) {
    expect(envelope.ok).toBe(false);
    if (envelope.ok) return;
    expect(envelope.error_code).toBe("BOOKING_LIMIT_EXCEEDED");
    expect(envelope.message).toBe(LIMIT_MESSAGE); // 不洩漏是哪一道檢查擋下
  }

  async function idOf(name: string): Promise<string> {
    const { data, error } = await admin.from("appointments").select("id").eq("customer_name", name).single();
    if (error) throw error;
    return data.id as string;
  }

  // 改成 cancelled。withEmail 為真時先把 email 設成 null、取消後補回，避免觸發取消通知信（見檔頭）。
  async function cancel(name: string, withEmail = false): Promise<void> {
    const id = await idOf(name);
    let email: string | null = null;
    if (withEmail) {
      const { data, error } = await admin.from("appointments").select("customer_email").eq("id", id).single();
      if (error) throw error;
      email = data.customer_email as string;
      const { error: nullError } = await admin.from("appointments").update({ customer_email: null }).eq("id", id);
      if (nullError) throw nullError;
    }
    const { error } = await admin.from("appointments").update({ status: "cancelled" }).eq("id", id);
    if (error) throw error;
    if (withEmail) {
      const { error: restoreError } = await admin.from("appointments").update({ customer_email: email }).eq("id", id);
      if (restoreError) throw restoreError;
    }
  }

  async function backdate(names: string[], hoursAgo: number): Promise<void> {
    const createdAt = new Date(Date.now() - hoursAgo * HOUR).toISOString();
    for (const name of names) {
      const { error } = await admin.from("appointments").update({ created_at: createdAt }).eq("id", await idOf(name));
      if (error) throw error;
    }
  }

  async function removeAllTestAppointments(): Promise<void> {
    const { error } = await admin.from("appointments").delete().eq("service_id", serviceId);
    if (error) throw error;
  }

  beforeAll(async () => {
    // Email 計數鍵是共用的（見檔頭）：確認沒有別人的預約佔用，否則本測試的計數會被汙染。
    const { count, error: probeError } = await admin
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .ilike("customer_email", "delivered%@resend.dev");
    if (probeError) throw probeError;
    if ((count ?? 0) > 0) {
      throw new Error("[booking-limit.integration.test] 目前有預約使用 delivered*@resend.dev，Email 計數鍵被佔用。若是先前中斷的殘留，請在 SQL Editor 執行：delete from public.appointments where customer_name like '__TEST__booking-limit-%'; 再重跑。");
    }

    const { data: service, error } = await admin
      .from("services")
      .insert({ name: `${TEST_MARKER} service`, price: 100, duration_minutes: 30, is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    serviceId = service.id;
    designerId = (await createTestDesigner(admin, { tag: "blimit", serviceIds: [serviceId] })).id;
  });

  afterAll(async () => {
    if (!serviceId) return; // beforeAll 失敗（尚未建立資料）：不要用 undefined 查詢蓋掉原本的錯誤
    await removeAllTestAppointments();
    let designerCleanupError: unknown;
    if (designerId) {
      try {
        await cleanupTestDesigners(admin, [designerId]);
      } catch (e) {
        designerCleanupError = e;
      }
    }
    const { error: customersError } = await admin.from("customers").delete().like("name", `${escapeLike(TEST_MARKER)}%`);
    if (customersError) throw customersError;
    const { error: serviceError } = await admin.from("services").delete().eq("id", serviceId);
    if (serviceError) throw serviceError;
    if (designerCleanupError) throw designerCleanupError;
  });

  describe("電話（customer_email 一律 null，不寄信）", () => {
    it("取消不釋放額度：建立 3 筆、其中 1 筆改成 cancelled 後，第 4 筆" + (windowActive ? "被拒（BOOKING_LIMIT_EXCEEDED）" : "仍成功（off：攻擊情境）"), async () => {
      const phone = testPhone();
      const names = [await bookOk({ phone, label: "p1" }), await bookOk({ phone, label: "p1" }), await bookOk({ phone, label: "p1" })];
      await cancel(names[0]);

      const { envelope } = await book({ phone, label: "p1-fourth" });
      if (windowActive) expectLimit(envelope);
      else expect(envelope).toMatchObject({ ok: true });
    });

    it("全部取消後也不釋放額度：3 筆都改成 cancelled，第 4 筆" + (windowActive ? "仍被拒" : "成功（off）"), async () => {
      const phone = testPhone();
      const names = [await bookOk({ phone, label: "p1b" }), await bookOk({ phone, label: "p1b" }), await bookOk({ phone, label: "p1b" })];
      for (const name of names) await cancel(name);

      const { envelope } = await book({ phone, label: "p1b-fourth" });
      if (windowActive) expectLimit(envelope);
      else expect(envelope).toMatchObject({ ok: true });
    });

    it("視窗內（23 小時前建立）仍計入；視窗外（25 小時前建立）不計入，可再建立", async () => {
      const inside = testPhone();
      const insideNames = [await bookOk({ phone: inside, label: "p2" }), await bookOk({ phone: inside, label: "p2" }), await bookOk({ phone: inside, label: "p2" })];
      for (const name of insideNames) await cancel(name);
      await backdate(insideNames, 23);
      const blocked = await book({ phone: inside, label: "p2-in" });
      if (windowActive) expectLimit(blocked.envelope);
      else expect(blocked.envelope).toMatchObject({ ok: true });

      const outside = testPhone();
      const outsideNames = [await bookOk({ phone: outside, label: "p2o" }), await bookOk({ phone: outside, label: "p2o" }), await bookOk({ phone: outside, label: "p2o" })];
      for (const name of outsideNames) await cancel(name);
      await backdate(outsideNames, 25);
      const allowed = await book({ phone: outside, label: "p2o-out" });
      expect(allowed.envelope).toMatchObject({ ok: true }); // 兩種模式都成立
    });

    it("一般顧客不受影響：3 筆內建立、同日取消後重新預約都成功；第 4 筆" + (windowActive ? "才被擋" : "仍成功（off）"), async () => {
      const phone = testPhone();
      const first = await bookOk({ phone, label: "p3" });
      await cancel(first);
      await bookOk({ phone, label: "p3" }); // 建立數 2
      await bookOk({ phone, label: "p3" }); // 建立數 3（未超過上限）

      const { envelope } = await book({ phone, label: "p3-fourth" });
      if (windowActive) expectLimit(envelope);
      else expect(envelope).toMatchObject({ ok: true });
    });

    it("原本的「未來待服務 ≥ 3」仍生效，不是被取代：3 筆都是 25 小時前建立（視窗外）時，第 4 筆仍被拒（兩種模式皆然）", async () => {
      const phone = testPhone();
      const names = [await bookOk({ phone, label: "p4" }), await bookOk({ phone, label: "p4" }), await bookOk({ phone, label: "p4" })];
      await backdate(names, 25);

      const { envelope } = await book({ phone, label: "p4-fourth" });
      expectLimit(envelope);
    });

    it("額度以電話為單位：電話 A 被視窗擋下時，電話 B（未填 Email）的第 1 筆仍成功", async () => {
      const blockedPhone = testPhone();
      const names = [await bookOk({ phone: blockedPhone, label: "p5" }), await bookOk({ phone: blockedPhone, label: "p5" }), await bookOk({ phone: blockedPhone, label: "p5" })];
      for (const name of names) await cancel(name);
      const { envelope } = await book({ phone: blockedPhone, label: "p5-fourth" });
      if (windowActive) expectLimit(envelope);
      else expect(envelope).toMatchObject({ ok: true });

      await bookOk({ phone: testPhone(), label: "p5-other" }); // 兩種模式都成立
    });

    it("並行：已有 2 筆（其中 1 筆已取消）時同時送 4 筆，" + (windowActive ? "恰好 1 筆成功（視窗總數到 3 為止）" : "恰好 2 筆成功（off：只受未來待服務上限約束）"), async () => {
      const phone = testPhone();
      const first = await bookOk({ phone, label: "p6" });
      await bookOk({ phone, label: "p6" });
      await cancel(first);

      const results = await Promise.all(Array.from({ length: 4 }, (_, i) => book({ phone, label: `p6-race${i}` })));
      const okCount = results.filter((r) => r.envelope.ok).length;
      expect(okCount).toBe(windowActive ? 1 : 2);
      for (const { envelope } of results.filter((r) => !r.envelope.ok)) expectLimit(envelope);
    });
  });

  describe("Email（會寄出確認信到 Resend 測試位址）", () => {
    it("取消不釋放 Email 額度，且 +標籤變體不能繞過；視窗外則可再建立", async () => {
      // 三種寫法（+標籤）正規化後是同一個鍵 delivered@resend.dev。只用小寫：Resend 對大寫變體是否視為測試位址未確認，避免退信影響寄件網域信譽；大小寫正規化由 0018 的 _email_dedupe_key 負責。
      const variants = ["delivered+t120a@resend.dev", "delivered+t120b@resend.dev", "delivered@resend.dev"];
      const names: string[] = [];
      for (const email of variants) {
        names.push(await bookOk({ phone: testPhone(), email, label: "e1" })); // 每筆不同電話，只有 Email 計數會擋
      }
      await cancel(names[0], true);

      const { envelope } = await book({ phone: testPhone(), email: "delivered+t120c@resend.dev", label: "e1-fourth" });
      if (windowActive) {
        expectLimit(envelope);
        // 視窗外：把 3 筆都改成 25 小時前建立，同一個 Email 可再建立（未來待服務只剩 2 筆，原檢查也不擋）。
        await backdate(names, 25);
        const { envelope: later } = await book({ phone: testPhone(), email: "delivered+t120d@resend.dev", label: "e1-later" });
        expect(later).toMatchObject({ ok: true });
      } else {
        expect(envelope).toMatchObject({ ok: true }); // off：取消釋放了額度，確認信可被無限次觸發
      }
    });
  });
});
