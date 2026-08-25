// 對真實 Supabase 專案執行的整合測試，驗證「營業時間與可預約時段管理」整個 Epic（第一批次
// 「設定每週固定營業時間」＋第二批次「設定公休日／特殊假期」「設定服務間的緩衝時間」）整條
// 路徑符合 feature-spec 的驗收標準：designer 讀寫 business_hours／closed_dates、anon／已
// 登入但非管理員的 authenticated 使用者皆不能寫（重新確認邊界未被本 Epic 意外放寬——這兩張
// 表對 authenticated 角色本身都沒有整體 revoke，唯一防線是各自的 "admin full access to ..."
// policy 的 is_admin() predicate，anon 測試只能證明「沒有對應 policy 時被拒」，需要額外的
// 非管理員角色才能證明 predicate 本身真的有效）、findAffectedAppointments／
// findAffectedAppointmentsForClosedDate 對真實預約資料的正確性、business_hours／
// closed_dates／services.buffer_minutes 變更後 get_available_slots RPC 正確反映新設定、
// 後台改期表單（computeAvailableSlots）與該 RPC 對同一組輸入產生一致的判斷。本檔案只透過
// 既有的 updateBusinessHours／getAllBusinessHours／addClosedDate／removeClosedDate／
// findAffectedAppointmentsForClosedDate 等封裝函式操作，不另外用原始 .from(...) 呼叫測試
// RLS——這些函式是薄封裝、沒有額外的授權邏輯，測封裝函式等同測原始 table 呼叫。
// 不放進預設 `npm test`，只透過 `npm run test:business-hours` 執行——這個檔案不會在其他
// 情境下被跑到，所以缺設定時直接噴錯而非略過，避免「忘了填 .env.local 卻顯示測試通過」的
// 誤導。沿用 tests/admin-booking.integration.test.ts 已驗證過的撰寫細節：afterAll 清除失敗
// 要 throw（且分開嘗試多個清除步驟）、RLS 拒絕的斷言精確比對或先確認底下確實有資料（避免
// 恆真斷言）、時間比較一律轉 epoch 再比較。
//
// 重要：business_hours 只有 7 列固定資料（weekday 為 primary key），不像 appointments／
// services 能用 TEST_MARKER 前綴隔離＋刪除。本檔案採「測試前記錄原始 7 列快照（並印到
// log 供程序被強制中斷時人工還原）、測試中只短暫改動、測試後（含 afterAll 安全網）還原」
// 的模式；這是全域唯一一份設定，測試期間會暫時影響顧客端可預約時段判定，不要對正式環境
// 高頻率重複執行。closed_dates 沒有固定列數、也沒有可以掛 TEST_MARKER 前綴的文字欄位，
// 改用「本次測試新增的日期」自己的清單（closedDatesToCleanup）在 afterAll 逐一刪除，不動
// 測試開始前就已經存在的列（例如 TASK-025 手動走查留下的既有公休日）。
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findAffectedAppointments,
  getAllBusinessHours,
  updateBusinessHours,
  type BusinessHoursInput,
  type BusinessHoursRow,
} from "../lib/admin/business-hours";
import {
  addClosedDate,
  findAffectedAppointmentsForClosedDate,
  isDateClosed,
  removeClosedDate,
} from "../lib/admin/closed-dates";
import { computeAvailableSlots, getBusinessHoursForWeekday, getOccupiedRangesForDate } from "../lib/admin/reschedule-slots";
import { createAppointment, getAvailableSlots } from "../lib/booking/api";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const designerEmail = process.env.DESIGNER_EMAIL;
const designerPassword = process.env.DESIGNER_PASSWORD;

if (!url || !anonKey || !serviceRoleKey || !designerEmail || !designerPassword) {
  throw new Error(
    "[business-hours.integration.test] 缺少 Supabase 專案設定或 DESIGNER_EMAIL/DESIGNER_PASSWORD，" +
      "請確認 .env.local 已填妥並已執行 npm run seed:designer。",
  );
}

const TEST_MARKER = `__TEST__business-hours-${Date.now()}`;
const TZ_OFFSET = "+08:00";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function taipeiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function isoAt(dateStr: string, hh: number, mm: number): string {
  return new Date(`${dateStr}T${pad(hh)}:${pad(mm)}:00${TZ_OFFSET}`).toISOString();
}

// TEST_MARKER 本身含有 `_`（LIKE 的單一字元萬用字元），afterAll 清除 customers 時若不
// 跳脫，`like` 比對範圍會比預期寬（比照 tests/booking.integration.test.ts 的既有寫法，
// TASK-028 新增的 create_appointment 測試案例會透過 RPC 真的寫入 customers，需要這支
// 清除輔助函式）。
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

// 比照 tests/admin-booking.integration.test.ts：從遠一點的 offset 開始找目標星期幾的日期，
// 分別離 test:booking（近 90 天視野）與 test:admin-booking（40 天起）常用的日期範圍有一段
// 距離，降低彼此互相干擾的風險；同時三個測試分組（寫入邊界／受影響預約／可預約時段）各自
// 用不同星期幾、不同日期，彼此不會互相佔用同一個時段。
function nextDateForWeekday(targetWeekday: number, minOffsetDays: number): string {
  let date = addDays(taipeiToday(), minOffsetDays);
  while (weekdayOf(date) !== targetWeekday) {
    date = addDays(date, 1);
  }
  return date;
}

// 比照 tests/admin-booking.integration.test.ts 的 testPhone()。
const phoneRunSeed = String(Date.now() % 100_000).padStart(5, "0");
let phoneSeq = 0;
function testPhone(): string {
  phoneSeq += 1;
  return `09${phoneRunSeed}${String(phoneSeq).padStart(3, "0")}`;
}

// getAllBusinessHours 回傳的時間是 "HH:mm:ss"（Postgres time 的預設序列化），
// BusinessHoursInput／updateBusinessHours 要的是 "HH:mm"（比照 BusinessHoursForm.tsx
// 的 formatTimeInput()），這裡做同樣的截斷轉換。
function toInput(row: BusinessHoursRow): BusinessHoursInput {
  return {
    weekday: row.weekday,
    open_time: row.open_time ? row.open_time.slice(0, 5) : "",
    close_time: row.close_time ? row.close_time.slice(0, 5) : "",
    is_closed: row.is_closed,
  };
}

describe("營業時間與可預約時段管理整合測試（真實 Supabase 專案）", () => {
  let serviceRoleClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let designerClient: SupabaseClient;
  // 已登入但不在 admins 表的 authenticated 使用者：business_hours 沒有對 authenticated
  // 角色整體 revoke（不像 appointments，見 0001_core_schema.sql），唯一防線是
  // "admin full access to business hours" policy 的 is_admin() predicate，anon 測試只
  // 證明「沒有 policy 時被拒」，不能證明「policy predicate 本身有效」，需要這個角色補齊。
  let nonAdminClient: SupabaseClient;
  let nonAdminUserId: string;
  let testServiceId: string;
  // buffer_minutes=30 的獨立測試服務，只給下方 buffer_minutes 相關測試使用，不重用
  // testServiceId（buffer_minutes=0），避免兩組案例互相污染彼此的緩衝行為判斷。
  let bufferServiceId: string;
  let originalSnapshot: BusinessHoursRow[];
  // closed_dates 沒有固定列數也沒有 TEST_MARKER 可掛，改成記錄本次測試新增過的日期，
  // afterAll 只刪除這些日期，不動測試開始前就已存在的列（見檔頭註解）。
  const closedDatesToCleanup: string[] = [];

  // 三組互不相同的星期幾，各自對應下面三個 describe，避免互相干擾：
  // WRITE_WEEKDAY 只在單一 it 內短暫改動並立即還原；AFFECTED_WEEKDAY 完全不寫入
  // business_hours（findAffectedAppointments 只吃傳入的假設性 newRows，不查表）；
  // SLOTS_WEEKDAY 會實際寫入公休再還原，用來驗證 get_available_slots RPC。
  const WRITE_WEEKDAY = 2; // 週二
  const AFFECTED_WEEKDAY = 4; // 週四
  const SLOTS_WEEKDAY = 5; // 週五

  const AFFECTED_DATE = nextDateForWeekday(AFFECTED_WEEKDAY, 55);
  const SLOTS_DATE = nextDateForWeekday(SLOTS_WEEKDAY, 55);

  // 第二批次（closed_dates／buffer_minutes）新增的測試日期，offset 58／65 刻意與上面的
  // 55、admin-booking 的 40+、booking 的近 90 天視野都錯開，同一個 offset 下也各自用不同
  // 星期幾，彼此不會撞期（見 project-map.md「各整合測試檔案的測試日期」說明）。
  const CLOSED_RLS_WEEKDAY = 1; // 週一
  const AFFECTED_CLOSED_WEEKDAY = 6; // 週六
  const SLOTS_CLOSED_WEEKDAY = 3; // 週三
  // TASK-028 新增：offset 58 這批已用掉週一／週三／週六，這裡用週二——**注意**：一開始
  // 誤用週四（跟 AFFECTED_DATE 同一個 weekday），以為 offset 不同（55 vs 58）就不會撞期，
  // 實測發現 nextDateForWeekday 從 minOffsetDays 起算最多再走 6 天找目標星期幾，55～61 與
  // 58～64 這兩個範圍會重疊，兩個相近 offset 若挑同一個 weekday 極可能落在同一天（本例
  // 兩者都算出同一個週四），導致 AFFECTED_DATE 那組測試插入的既有預約與這裡的
  // create_appointment 呼叫在同一天同一個 11:00 時段撞上 appointments_no_overlap，
  // 誤判成別的原因失敗。教訓：新增日期前務必實際印出計算結果比對，不能只靠「offset
  // 不同」的直覺判斷。
  const CREATE_APPOINTMENT_CLOSED_WEEKDAY = 2; // 週二
  const BUFFER_WEEKDAY = 1; // 週一（offset 不同於 CLOSED_RLS_WEEKDAY，仍是不同日期）
  const BUFFER_ZERO_WEEKDAY = 6; // 週六
  const CROSS_VALIDATE_WEEKDAY = 3; // 週三

  const CLOSED_RLS_DATE = nextDateForWeekday(CLOSED_RLS_WEEKDAY, 58);
  const AFFECTED_CLOSED_DATE = nextDateForWeekday(AFFECTED_CLOSED_WEEKDAY, 58);
  const SLOTS_CLOSED_DATE = nextDateForWeekday(SLOTS_CLOSED_WEEKDAY, 58);
  const CREATE_APPOINTMENT_CLOSED_DATE = nextDateForWeekday(CREATE_APPOINTMENT_CLOSED_WEEKDAY, 58);
  const BUFFER_DATE = nextDateForWeekday(BUFFER_WEEKDAY, 65);
  const BUFFER_ZERO_DATE = nextDateForWeekday(BUFFER_ZERO_WEEKDAY, 65);
  const CROSS_VALIDATE_DATE = nextDateForWeekday(CROSS_VALIDATE_WEEKDAY, 65);

  beforeAll(async () => {
    serviceRoleClient = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    designerClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await designerClient.auth.signInWithPassword({
      email: designerEmail!,
      password: designerPassword!,
    });
    if (signInError) throw signInError;

    // 用 service role 的 admin API 自建一個拋棄式、非管理員的 authenticated 使用者
    // （email 用 RFC 2606 保留的 .invalid 網域，不會真的寄信），測完在 afterAll 刪除，
    // 不需要額外的 .env.local 設定或長期存在的第二個帳號。
    const nonAdminEmail = `${TEST_MARKER}-nonadmin@example.invalid`;
    // 密碼刻意用獨立的隨機值，不從 TEST_MARKER 衍生——TEST_MARKER 也會出現在下面
    // is_active:true 的測試服務名稱裡，而 services 對 active 服務有 anon 可讀的既有
    // policy（0001_core_schema.sql），若密碼可以從那裡反推出來，等於在正式 Supabase
    // 專案留下一組任何人都能推導出帳密的有效登入憑證（即使只是非管理員帳號，也不該讓
    // 憑證本身可從公開資料衍生）。
    const nonAdminPassword = `${randomUUID()}Aa1!`;
    const { data: createdNonAdmin, error: createNonAdminError } = await serviceRoleClient.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
    });
    if (createNonAdminError) throw createNonAdminError;
    nonAdminUserId = createdNonAdmin.user.id;

    nonAdminClient = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: nonAdminSignInError } = await nonAdminClient.auth.signInWithPassword({
      email: nonAdminEmail,
      password: nonAdminPassword,
    });
    if (nonAdminSignInError) throw nonAdminSignInError;

    const { data: service, error: serviceError } = await serviceRoleClient
      .from("services")
      .insert({
        name: `${TEST_MARKER} service`,
        price: 100,
        duration_minutes: 30,
        is_active: true,
      })
      .select("id")
      .single();
    if (serviceError) throw serviceError;
    testServiceId = service.id;

    const { data: bufferService, error: bufferServiceError } = await serviceRoleClient
      .from("services")
      .insert({
        name: `${TEST_MARKER} buffer service`,
        price: 100,
        duration_minutes: 30,
        buffer_minutes: 30,
        is_active: true,
      })
      .select("id")
      .single();
    if (bufferServiceError) throw bufferServiceError;
    bufferServiceId = bufferService.id;

    // 記錄原始 7 列快照，afterAll 會用這份快照還原——不能假設目前一定是 seed script 的
    // 預設值（可能已被後台設定頁調整過），一律以「測試開始當下的實際資料」為還原基準。
    const { data: snapshot, error: snapshotError } = await serviceRoleClient
      .from("business_hours")
      .select("weekday, open_time, close_time, is_closed")
      .order("weekday", { ascending: true });
    if (snapshotError) throw snapshotError;
    originalSnapshot = snapshot as BusinessHoursRow[];
    expect(originalSnapshot).toHaveLength(7);

    // business_hours 沒有 TEST_MARKER 可以事後掃描復原（不像 appointments／services），
    // 若程序在測試中途被強制中斷（CI timeout／ctrl-C），afterAll 不會執行，這份快照就是
    // 唯一能讓人工用 service role 手動 upsert 還原的紀錄，印到終端機/CI log 留痕。
    console.log(`[business-hours.integration.test] 原始 business_hours 快照（供中斷後人工還原用）：${JSON.stringify(originalSnapshot)}`);

    // CLOSED_RLS_DATE／SLOTS_CLOSED_DATE 是下面測試會呼叫 addClosedDate 寫入、視為「本次
    // 測試新增」而在 afterAll 一併刪除的日期；但 nextDateForWeekday 算出來的是每次執行都
    // 不同的真實日期，理論上可能剛好撞到設計師已經手動設定的正式公休日（例如國定假日）。
    // addClosedDate 對已存在的日期是 upsert（ON CONFLICT DO UPDATE），會回傳 ok:true、
    // 測試完全不會察覺撞到既有資料，後續 removeClosedDate／afterAll 的清除就會把一筆正式
    // 公休日真的刪掉且無法還原（closed_dates 沒有 business_hours 那種可回填的快照）。
    // 這裡在測試開始前先確認兩個日期都還沒被設定過，撞到就直接 throw 中止整個測試檔案，
    // 不要悄悄覆寫/刪除使用者的正式資料——比照 project-map.md 對「新增整合測試前先看既有
    // 檔案用的日期範圍」的既有提醒，這是同一個原則在單一日期層級的體現。
    const { data: preexistingClosedDates, error: preexistingClosedDatesError } = await serviceRoleClient
      .from("closed_dates")
      .select("date")
      .in("date", [CLOSED_RLS_DATE, SLOTS_CLOSED_DATE]);
    if (preexistingClosedDatesError) throw preexistingClosedDatesError;
    if (preexistingClosedDates && preexistingClosedDates.length > 0) {
      throw new Error(
        `[business-hours.integration.test] CLOSED_RLS_DATE／SLOTS_CLOSED_DATE 撞到既有的 closed_dates 資料，` +
          `為避免測試把正式公休日刪除，直接中止：${JSON.stringify(preexistingClosedDates)}。` +
          `請調整 CLOSED_RLS_WEEKDAY／SLOTS_CLOSED_WEEKDAY 或其 offset 後重跑。`,
      );
    }
  });

  afterAll(async () => {
    // 每個清除步驟都要各自嘗試（不能第一步失敗就中止），否則前面的失敗會讓後面完全不
    // 執行，導致 business_hours 停留在測試期間的暫時狀態、或含電話等 PII 的測試預約殘留
    // 卻不會被任何人發現。收集所有錯誤，最後一次性丟出。signOut() 也納入同一個
    // try/catch 收集模式，避免它本身失敗時跳過下面真正重要的資料還原步驟。
    const cleanupErrors: unknown[] = [];

    try {
      await designerClient.auth.signOut();
      await nonAdminClient.auth.signOut();
    } catch (signOutError) {
      cleanupErrors.push(signOutError);
    }

    if (nonAdminUserId) {
      const { error: deleteNonAdminError } = await serviceRoleClient.auth.admin.deleteUser(nonAdminUserId);
      if (deleteNonAdminError) cleanupErrors.push(deleteNonAdminError);
    }

    if (originalSnapshot) {
      const { data: restored, error: restoreError } = await serviceRoleClient
        .from("business_hours")
        .upsert(originalSnapshot, { onConflict: "weekday" })
        .select("weekday");
      if (restoreError || !restored || restored.length !== originalSnapshot.length) {
        cleanupErrors.push(restoreError ?? new Error("business_hours 還原受影響列數與快照不符"));
      }
    }

    // 兩個拋棄式測試服務都是 is_active:true（供 get_available_slots RPC／改期表單讀取，
    // 見下方測試需求），代表測試執行期間顧客端有極小機率真的點進來訂了一筆——直接
    // .delete().eq("service_id", ...) 不做任何核對就會把這種真實預約也靜默刪掉，沒有人
    // 會發現。改成先 select 出即將刪除的列，確認每一筆的 customer_name 都以 TEST_MARKER
    // 開頭才真的執行刪除；只要有一筆不是，整批都不刪、記進 cleanupErrors 讓 afterAll
    // throw，交給人工介入而不是靜默刪掉不屬於本次測試的資料。
    async function safeDeleteTestAppointments(serviceId: string): Promise<void> {
      const { data: rows, error: selectError } = await serviceRoleClient
        .from("appointments")
        .select("id, customer_name")
        .eq("service_id", serviceId);
      if (selectError) {
        cleanupErrors.push(selectError);
        return;
      }
      const foreign = (rows ?? []).filter((row) => !row.customer_name.startsWith(TEST_MARKER));
      if (foreign.length > 0) {
        cleanupErrors.push(
          new Error(
            `service_id=${serviceId} 底下有 ${foreign.length} 筆非本次測試建立的預約（customer_name 不含 TEST_MARKER 前綴），已略過刪除，需要人工檢查：${JSON.stringify(foreign)}`,
          ),
        );
        return;
      }
      if ((rows ?? []).length === 0) return;
      const { error: deleteError } = await serviceRoleClient.from("appointments").delete().eq("service_id", serviceId);
      if (deleteError) cleanupErrors.push(deleteError);
    }

    if (testServiceId) {
      await safeDeleteTestAppointments(testServiceId);
      const { error: deleteServiceError } = await serviceRoleClient.from("services").delete().eq("id", testServiceId);
      if (deleteServiceError) cleanupErrors.push(deleteServiceError);
    }

    if (bufferServiceId) {
      await safeDeleteTestAppointments(bufferServiceId);
      const { error: deleteBufferServiceError } = await serviceRoleClient
        .from("services")
        .delete()
        .eq("id", bufferServiceId);
      if (deleteBufferServiceError) cleanupErrors.push(deleteBufferServiceError);
    }

    // TASK-028 新增的 create_appointment 測試案例會透過真正的 RPC 呼叫，其顧客去重邏輯
    // 會在 customers 表新建一列——不像上面兩個服務底下的 appointments 可以直接依
    // service_id 篩選，customers 沒有 service_id 這種外鍵可用，改依 TEST_MARKER 名稱
    // 前綴清除（比照 tests/booking.integration.test.ts 的既有寫法）。需要在上面兩個
    // service 的 appointments 都刪除之後才執行（appointments.customer_id 參照
    // customers，順序顛倒會被 FK constraint 擋下）。
    const { error: deleteCustomersError } = await serviceRoleClient
      .from("customers")
      .delete()
      .like("name", `${escapeLikePattern(TEST_MARKER)}%`);
    if (deleteCustomersError) cleanupErrors.push(deleteCustomersError);

    // 逐一刪除本次測試新增過的 closed_dates 列（見檔頭註解：closed_dates 沒有 TEST_MARKER
    // 可掛，改用這份清單識別）；每個日期各自嘗試，即使某些已經被對應 it 自己 remove 過
    // （delete 對不存在的列是安全的 no-op），也不影響其他日期的清除。
    for (const date of closedDatesToCleanup) {
      const { error: deleteClosedDateError } = await serviceRoleClient.from("closed_dates").delete().eq("date", date);
      if (deleteClosedDateError) cleanupErrors.push(deleteClosedDateError);
    }

    if (cleanupErrors.length > 0) {
      // 直接 JSON.stringify Error 物件只會得到 "{}"（message 不是 own enumerable
      // property），會讓 operator 看不到最關鍵的還原失敗原因，這裡先轉成訊息字串。
      const messages = cleanupErrors.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)));
      throw new Error(
        `[business-hours.integration.test] afterAll 清除失敗，business_hours 或測試資料可能未被還原乾淨：${JSON.stringify(messages)}`,
      );
    }
  });

  async function fetchRow(weekday: number): Promise<BusinessHoursRow> {
    const { data, error } = await serviceRoleClient
      .from("business_hours")
      .select("weekday, open_time, close_time, is_closed")
      .eq("weekday", weekday)
      .single();
    if (error) throw error;
    return data as BusinessHoursRow;
  }

  async function insertAppointment(params: {
    name: string;
    startAt: string;
    endAt: string;
    status?: "pending" | "confirmed" | "completed" | "cancelled";
    // 預設 testServiceId（buffer_minutes=0）；下方 buffer_minutes 測試需要把既有預約
    // 掛在 bufferServiceId（buffer_minutes=30）底下才能驗證緩衝行為，其餘呼叫端不需要
    // 關心這個參數，維持既有呼叫寫法不變。
    serviceId?: string;
  }): Promise<string> {
    const { data, error } = await serviceRoleClient
      .from("appointments")
      .insert({
        service_id: params.serviceId ?? testServiceId,
        customer_name: `${TEST_MARKER} ${params.name}`,
        customer_phone: testPhone(),
        start_at: params.startAt,
        end_at: params.endAt,
        ...(params.status ? { status: params.status } : {}),
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  describe("讀取權限邊界：designer 與 anon 皆可讀七天設定（既有 public read policy，重新確認未被本 Epic 意外收緊）", () => {
    it("designer（authenticated + is_admin()）讀取七天設定成功", async () => {
      const result = await getAllBusinessHours(designerClient);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(7);
    });

    it("anon 讀取七天設定成功（既有 policy 供顧客端 RPC 使用，本 Epic 不應收緊）", async () => {
      const result = await getAllBusinessHours(anonClient);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(7);
    });
  });

  describe("寫入權限邊界：designer 可直接寫入 business_hours，anon／非管理員 authenticated 皆被 RLS 拒絕（本 Epic 第一次開放 authenticated 直接寫入，需重新確認邊界未被意外放寬）", () => {
    it("designer 寫入成功，重新查詢確認資料確實生效，並還原為原始值", async () => {
      const original = originalSnapshot.find((row) => row.weekday === WRITE_WEEKDAY)!;
      const originalInput = toInput(original);
      // 前置假設：WRITE_WEEKDAY 目前是正常營業日，下面「打烊時間往前挪 5 分鐘」才有意義；
      // 若是公休日 close_time 會是空字串，往下的字串切割/減法會得到 NaN，失敗訊息會很難懂，
      // 這裡先用明確的斷言擋在前面（比照 AFFECTED_WEEKDAY／SLOTS_WEEKDAY 兩個 it 的寫法）。
      expect(originalInput.is_closed).toBe(false);
      const [closeH, closeM] = originalInput.close_time.split(":").map(Number);
      const shiftedCloseMinutes = closeH * 60 + closeM - 5;
      const shiftedClose = `${pad(Math.floor(shiftedCloseMinutes / 60))}:${pad(shiftedCloseMinutes % 60)}`;

      const writeResult = await updateBusinessHours(designerClient, [
        { ...originalInput, close_time: shiftedClose },
      ]);
      expect(writeResult.ok).toBe(true);

      const afterWrite = await fetchRow(WRITE_WEEKDAY);
      expect(afterWrite.close_time?.slice(0, 5)).toBe(shiftedClose);

      const restoreResult = await updateBusinessHours(designerClient, [originalInput]);
      expect(restoreResult.ok).toBe(true);

      const afterRestore = await fetchRow(WRITE_WEEKDAY);
      expect(afterRestore.close_time?.slice(0, 5)).toBe(originalInput.close_time);
      expect(afterRestore.open_time?.slice(0, 5)).toBe(originalInput.open_time);
      expect(afterRestore.is_closed).toBe(originalInput.is_closed);
    });

    it("anon 呼叫 updateBusinessHours 被拒絕，資料不受影響，錯誤訊息不外洩原始 Postgres 細節", async () => {
      const original = originalSnapshot.find((row) => row.weekday === WRITE_WEEKDAY)!;
      const originalInput = toInput(original);
      // 探測值必須確實不同於現況，斷言才有意義；若種子資料剛好就是 23:59（極不可能但非
      // 不可能，例如被後台設定頁調整過），下面「寫入被拒後資料不變」的比對會變成恆真。
      expect(originalInput.close_time).not.toBe("23:59");

      const anonResult = await updateBusinessHours(anonClient, [
        { ...originalInput, close_time: "23:59", is_closed: false },
      ]);
      expect(anonResult.ok).toBe(false);
      if (!anonResult.ok) {
        // 確認回傳的是既有的通用錯誤訊息，不是原始 Postgres 錯誤（例如 RLS 相關字樣、
        // 資料表名稱），對應驗證契約「錯誤訊息不外洩原始 Postgres 錯誤細節」。
        expect(anonResult.error.message).toBe("發生未預期的錯誤，請稍後再試。");
      }

      const afterAttempt = await fetchRow(WRITE_WEEKDAY);
      expect(afterAttempt.close_time?.slice(0, 5)).toBe(originalInput.close_time);
      expect(afterAttempt.open_time?.slice(0, 5)).toBe(originalInput.open_time);
      expect(afterAttempt.is_closed).toBe(originalInput.is_closed);
    });

    it("已登入但非 is_admin() 的 authenticated 使用者呼叫 updateBusinessHours 被拒絕，資料不受影響（anon 測試只證明「沒有對應 policy 時被拒」，business_hours 對 authenticated 角色本身沒有整體 revoke，唯一防線是 is_admin() policy predicate，需要這個角色才能真正驗證該防線本身有效）", async () => {
      const original = originalSnapshot.find((row) => row.weekday === WRITE_WEEKDAY)!;
      const originalInput = toInput(original);
      expect(originalInput.close_time).not.toBe("23:58");

      const nonAdminResult = await updateBusinessHours(nonAdminClient, [
        { ...originalInput, close_time: "23:58", is_closed: false },
      ]);
      expect(nonAdminResult.ok).toBe(false);
      if (!nonAdminResult.ok) {
        expect(nonAdminResult.error.message).toBe("發生未預期的錯誤，請稍後再試。");
      }

      const afterAttempt = await fetchRow(WRITE_WEEKDAY);
      expect(afterAttempt.close_time?.slice(0, 5)).toBe(originalInput.close_time);
      expect(afterAttempt.open_time?.slice(0, 5)).toBe(originalInput.open_time);
      expect(afterAttempt.is_closed).toBe(originalInput.is_closed);
    });
  });

  describe("findAffectedAppointments：對真實預約資料正確判定受影響／不受影響（不寫入 business_hours，只吃假設性 newRows）", () => {
    it("縮小營業時間後，落在新時段外的預約被判定受影響，落在新時段內／其他星期幾的不受影響，已取消的預約不列入", async () => {
      const original = originalSnapshot.find((row) => row.weekday === AFFECTED_WEEKDAY)!;
      const originalInput = toInput(original);
      // 前置假設：AFFECTED_WEEKDAY 目前是正常營業日（非公休），下面才有意義比較「縮小後」
      // 的差異；若種子資料日後調整導致這天變公休，此斷言會先失敗提醒需要換一個 weekday。
      expect(originalInput.is_closed).toBe(false);

      // BusinessHoursForm.tsx 實際呼叫 findAffectedAppointments 時一律傳入全部 7 列
      // （Array.from(rows.values())），只有被使用者編輯的那列值不同，其餘 6 列原樣帶入
      // ——這裡比照同樣的呼叫形狀而非只傳單一列，才能真正驗證「其餘未變動的星期幾不會被
      // 新設定誤判為受影響」這個安全性質，而不只是驗證「有被改的那天判斷正確」。
      function fullRowsWith(override: BusinessHoursInput): BusinessHoursInput[] {
        return originalSnapshot.map((row) => (row.weekday === override.weekday ? override : toInput(row)));
      }

      const outsideAppointmentId = await insertAppointment({
        name: "affected-outside-new-hours",
        startAt: isoAt(AFFECTED_DATE, 11, 0),
        endAt: isoAt(AFFECTED_DATE, 11, 30),
      });
      const insideAppointmentId = await insertAppointment({
        name: "unaffected-inside-new-hours",
        startAt: isoAt(AFFECTED_DATE, 13, 0),
        endAt: isoAt(AFFECTED_DATE, 13, 30),
      });
      const cancelledOutsideAppointmentId = await insertAppointment({
        name: "cancelled-outside-new-hours-excluded",
        startAt: isoAt(AFFECTED_DATE, 11, 30),
        endAt: isoAt(AFFECTED_DATE, 12, 0),
        status: "cancelled",
      });
      // 落在完全不同星期幾（SLOTS_WEEKDAY）、且時段落在該天現行營業時間內的對照組：
      // 用來證明傳入完整 7 列時，未被使用者編輯的其他星期幾不會因為「陣列裡也有它」而被
      // 誤判受影響（例如誤用了陣列的第一列或漏了 weekday 篩選）。
      const controlAppointmentId = await insertAppointment({
        name: "control-different-weekday-unaffected",
        startAt: isoAt(SLOTS_DATE, 11, 0),
        endAt: isoAt(SLOTS_DATE, 11, 30),
      });

      const narrowedResult = await findAffectedAppointments(
        designerClient,
        fullRowsWith({ weekday: AFFECTED_WEEKDAY, open_time: "12:00", close_time: "18:00", is_closed: false }),
      );
      expect(narrowedResult.ok).toBe(true);
      if (!narrowedResult.ok) return;
      const narrowedIds = narrowedResult.data.map((row) => row.id);
      expect(narrowedIds).toContain(outsideAppointmentId);
      expect(narrowedIds).not.toContain(insideAppointmentId);
      expect(narrowedIds).not.toContain(cancelledOutsideAppointmentId);
      expect(narrowedIds).not.toContain(controlAppointmentId);

      // 受影響清單每一筆都只含最小必要欄位，不應包含電話等非必要個資。
      for (const entry of narrowedResult.data) {
        expect(Object.keys(entry).sort()).toEqual(["customer_name", "id", "start_at"].sort());
      }

      // 整天改公休：兩筆未取消的預約都應該被判定受影響（is_closed 優先於時段比較），
      // 對照組（其他星期幾）仍不受影響。
      const closedResult = await findAffectedAppointments(
        designerClient,
        fullRowsWith({ weekday: AFFECTED_WEEKDAY, open_time: "", close_time: "", is_closed: true }),
      );
      expect(closedResult.ok).toBe(true);
      if (!closedResult.ok) return;
      const closedIds = closedResult.data.map((row) => row.id);
      expect(closedIds).toContain(outsideAppointmentId);
      expect(closedIds).toContain(insideAppointmentId);
      expect(closedIds).not.toContain(cancelledOutsideAppointmentId);
      expect(closedIds).not.toContain(controlAppointmentId);
      for (const entry of closedResult.data) {
        expect(Object.keys(entry).sort()).toEqual(["customer_name", "id", "start_at"].sort());
      }

      // 維持現狀（完整 7 列、值皆與目前設定相同）：兩筆未取消的預約都不應該被判定受影響，
      // 對應「沒有受影響預約則直接儲存，不顯示警告步驟」的驗收標準。
      const unchangedResult = await findAffectedAppointments(designerClient, originalSnapshot.map(toInput));
      expect(unchangedResult.ok).toBe(true);
      if (!unchangedResult.ok) return;
      const unchangedIds = unchangedResult.data.map((row) => row.id);
      expect(unchangedIds).not.toContain(outsideAppointmentId);
      expect(unchangedIds).not.toContain(insideAppointmentId);
      expect(unchangedIds).not.toContain(controlAppointmentId);
    });
  });

  describe("business_hours 變更後 get_available_slots RPC 正確反映新設定", () => {
    it("把某天設為公休後，該天回傳空陣列；還原後恢復可預約時段", async () => {
      const original = originalSnapshot.find((row) => row.weekday === SLOTS_WEEKDAY)!;
      const originalInput = toInput(original);
      expect(originalInput.is_closed).toBe(false);

      // 先確認正常營業時（anon／顧客端視角）本來就有可預約時段，避免下面「公休後變空」
      // 的斷言是恆真的（例如日期算錯導致原本就是空陣列）。
      const beforeResult = await getAvailableSlots(anonClient, testServiceId, SLOTS_DATE);
      expect(beforeResult.ok).toBe(true);
      if (!beforeResult.ok) return;
      expect(beforeResult.data.length).toBeGreaterThan(0);

      const writeResult = await updateBusinessHours(designerClient, [
        { weekday: SLOTS_WEEKDAY, open_time: "", close_time: "", is_closed: true },
      ]);
      expect(writeResult.ok).toBe(true);

      const closedResult = await getAvailableSlots(anonClient, testServiceId, SLOTS_DATE);
      expect(closedResult.ok).toBe(true);
      if (!closedResult.ok) return;
      expect(closedResult.data).toEqual([]);

      const restoreResult = await updateBusinessHours(designerClient, [originalInput]);
      expect(restoreResult.ok).toBe(true);

      const afterRestoreResult = await getAvailableSlots(anonClient, testServiceId, SLOTS_DATE);
      expect(afterRestoreResult.ok).toBe(true);
      if (!afterRestoreResult.ok) return;
      expect(afterRestoreResult.data.length).toBeGreaterThan(0);
    });
  });

  describe("closed_dates 讀寫權限邊界：designer 可直接讀寫，anon／非管理員 authenticated 皆被 RLS 拒絕（本 Epic closed_dates 第一次讓 authenticated 直接寫入，比照上方 business_hours 的既有測試方式重新確認邊界）", () => {
    it("designer 新增後查詢確認生效，移除後查詢確認已刪除", async () => {
      const addResult = await addClosedDate(designerClient, CLOSED_RLS_DATE);
      closedDatesToCleanup.push(CLOSED_RLS_DATE);
      expect(addResult.ok).toBe(true);

      const { data: afterAdd, error: afterAddError } = await serviceRoleClient
        .from("closed_dates")
        .select("date")
        .eq("date", CLOSED_RLS_DATE)
        .maybeSingle();
      if (afterAddError) throw afterAddError;
      expect(afterAdd).not.toBeNull();

      const removeResult = await removeClosedDate(designerClient, CLOSED_RLS_DATE);
      expect(removeResult.ok).toBe(true);

      const { data: afterRemove, error: afterRemoveError } = await serviceRoleClient
        .from("closed_dates")
        .select("date")
        .eq("date", CLOSED_RLS_DATE)
        .maybeSingle();
      if (afterRemoveError) throw afterRemoveError;
      expect(afterRemove).toBeNull();
    });

    it("anon 呼叫 addClosedDate 被拒絕，資料不受影響，錯誤訊息不外洩原始 Postgres 細節", async () => {
      const anonResult = await addClosedDate(anonClient, CLOSED_RLS_DATE);
      expect(anonResult.ok).toBe(false);
      if (!anonResult.ok) {
        expect(anonResult.error.message).toBe("發生未預期的錯誤，請稍後再試。");
      }

      const { data, error } = await serviceRoleClient
        .from("closed_dates")
        .select("date")
        .eq("date", CLOSED_RLS_DATE)
        .maybeSingle();
      if (error) throw error;
      expect(data).toBeNull();
    });

    it("已登入但非 is_admin() 的 authenticated 使用者呼叫 addClosedDate 被拒絕，資料不受影響（anon 測試只證明「沒有對應 policy 時被拒」，closed_dates 對 authenticated 角色本身沒有整體 revoke，唯一防線是 is_admin() policy predicate，需要這個角色才能真正驗證該防線本身有效）", async () => {
      const nonAdminResult = await addClosedDate(nonAdminClient, CLOSED_RLS_DATE);
      expect(nonAdminResult.ok).toBe(false);
      if (!nonAdminResult.ok) {
        expect(nonAdminResult.error.message).toBe("發生未預期的錯誤，請稍後再試。");
      }

      const { data, error } = await serviceRoleClient
        .from("closed_dates")
        .select("date")
        .eq("date", CLOSED_RLS_DATE)
        .maybeSingle();
      if (error) throw error;
      expect(data).toBeNull();
    });

    // 上面三個案例只驗證了 policy 的 WITH CHECK（INSERT／upsert 路徑）。closed_dates 的
    // policy 是 for all using(is_admin()) with check(is_admin())，掌管 DELETE 的 USING
    // 子句從未被驗證過；removeClosedDate（lib/admin/closed-dates.ts）又特別為「RLS 擋下
    // DELETE 會回傳成功但 0 筆」寫了一段用 isDateClosed 複查的防禦邏輯，這段邏輯在整合層
    // 也需要真的被 RLS 擋下的情境才測得到，不能只在單元測試裡 mock。這裡先用 service role
    // 建立一筆既有資料（模擬「設計師已經設定過」的狀態），再用 anon／nonAdmin 嘗試刪除，
    // 確認 USING 子句真的擋下、資料不受影響。
    it("anon 呼叫 removeClosedDate 被 RLS 的 USING 子句拒絕，既有列不受影響（上面三個案例只驗證了 WITH CHECK／INSERT 路徑，這裡補上 DELETE 路徑）", async () => {
      const { error: seedError } = await serviceRoleClient.from("closed_dates").upsert({ date: CLOSED_RLS_DATE });
      if (seedError) throw seedError;
      closedDatesToCleanup.push(CLOSED_RLS_DATE);

      const anonResult = await removeClosedDate(anonClient, CLOSED_RLS_DATE);
      expect(anonResult.ok).toBe(false);

      const { data, error } = await serviceRoleClient
        .from("closed_dates")
        .select("date")
        .eq("date", CLOSED_RLS_DATE)
        .maybeSingle();
      if (error) throw error;
      expect(data).not.toBeNull();

      // 測完用 designer 清乾淨，不留到 afterAll 才處理（下一個 it 會再次 seed 同一天）。
      const cleanupResult = await removeClosedDate(designerClient, CLOSED_RLS_DATE);
      expect(cleanupResult.ok).toBe(true);
    });

    it("已登入但非 is_admin() 的 authenticated 使用者對已存在的日期呼叫 addClosedDate（upsert 衝突路徑）被拒絕，既有列不受影響（上面的 nonAdmin 案例是對不存在的日期 INSERT，這裡改成對已存在的日期 UPDATE，覆蓋 upsert 的另一個分支）", async () => {
      const { error: seedError } = await serviceRoleClient.from("closed_dates").upsert({ date: CLOSED_RLS_DATE });
      if (seedError) throw seedError;
      closedDatesToCleanup.push(CLOSED_RLS_DATE);

      const nonAdminResult = await addClosedDate(nonAdminClient, CLOSED_RLS_DATE);
      expect(nonAdminResult.ok).toBe(false);
      if (!nonAdminResult.ok) {
        expect(nonAdminResult.error.message).toBe("發生未預期的錯誤，請稍後再試。");
      }

      const { data, error } = await serviceRoleClient
        .from("closed_dates")
        .select("date")
        .eq("date", CLOSED_RLS_DATE)
        .maybeSingle();
      if (error) throw error;
      expect(data).not.toBeNull();

      const cleanupResult = await removeClosedDate(designerClient, CLOSED_RLS_DATE);
      expect(cleanupResult.ok).toBe(true);
    });
  });

  describe("findAffectedAppointmentsForClosedDate：對真實預約資料正確判定受影響／不受影響（不依賴該日期是否已標記為公休，只查該日期範圍內的預約）", () => {
    it("回傳同一天未取消的未來預約，不含其他日期，不含已取消，欄位最小化不含電話等非必要個資", async () => {
      const insideId = await insertAppointment({
        name: "closed-date-affected",
        startAt: isoAt(AFFECTED_CLOSED_DATE, 11, 0),
        endAt: isoAt(AFFECTED_CLOSED_DATE, 11, 30),
      });
      const cancelledId = await insertAppointment({
        name: "closed-date-cancelled-excluded",
        startAt: isoAt(AFFECTED_CLOSED_DATE, 12, 0),
        endAt: isoAt(AFFECTED_CLOSED_DATE, 12, 30),
        status: "cancelled",
      });
      // 對照組：落在完全不同日期（SLOTS_DATE，本檔案既有的 business_hours 測試用日期），
      // 用來證明查詢有依日期篩選，不是把整張表都回傳。時段刻意避開上方既有
      // findAffectedAppointments 測試在同一個 SLOTS_DATE 11:00-11:30 已經佔用的
      // controlAppointmentId（appointments_no_overlap 是不分服務的全域 exclusion
      // constraint，兩個測試共用同一天就必須錯開時段）。
      const controlId = await insertAppointment({
        name: "closed-date-control-different-date",
        startAt: isoAt(SLOTS_DATE, 16, 0),
        endAt: isoAt(SLOTS_DATE, 16, 30),
      });

      const result = await findAffectedAppointmentsForClosedDate(designerClient, AFFECTED_CLOSED_DATE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.data.map((row) => row.id);
      expect(ids).toContain(insideId);
      expect(ids).not.toContain(cancelledId);
      expect(ids).not.toContain(controlId);
      for (const entry of result.data) {
        expect(Object.keys(entry).sort()).toEqual(["customer_name", "id", "start_at"].sort());
      }
    });
  });

  describe("get_available_slots RPC 對 closed_dates 的回應（比照上方 business_hours 公休的既有測試模式）", () => {
    it("標記為特殊公休日後回傳空陣列，移除後恢復正常可預約時段", async () => {
      const beforeResult = await getAvailableSlots(anonClient, testServiceId, SLOTS_CLOSED_DATE);
      expect(beforeResult.ok).toBe(true);
      if (!beforeResult.ok) return;
      expect(beforeResult.data.length).toBeGreaterThan(0);

      const addResult = await addClosedDate(designerClient, SLOTS_CLOSED_DATE);
      closedDatesToCleanup.push(SLOTS_CLOSED_DATE);
      expect(addResult.ok).toBe(true);

      const closedResult = await getAvailableSlots(anonClient, testServiceId, SLOTS_CLOSED_DATE);
      expect(closedResult.ok).toBe(true);
      if (!closedResult.ok) return;
      expect(closedResult.data).toEqual([]);

      const removeResult = await removeClosedDate(designerClient, SLOTS_CLOSED_DATE);
      expect(removeResult.ok).toBe(true);

      const afterRestoreResult = await getAvailableSlots(anonClient, testServiceId, SLOTS_CLOSED_DATE);
      expect(afterRestoreResult.ok).toBe(true);
      if (!afterRestoreResult.ok) return;
      expect(afterRestoreResult.data.length).toBeGreaterThan(0);
    });
  });

  // TASK-028：create_appointment 是顧客端唯一的預約寫入路徑，get_available_slots 只是
  // 「畫面上不顯示」公休日時段，顧客若繞過前端直接呼叫 create_appointment，過去仍能在
  // 公休日訂到位——這是 TASK-024 安全性審查發現的殘留風險，本卡在 create_appointment RPC
  // 本身補上 closed_dates 檢查。每個案例各自用 addClosedDate／removeClosedDate（皆為
  // 冪等操作）設定前置狀態，不依賴其他 it 的執行順序或副作用。
  describe("create_appointment RPC 對 closed_dates 的回應（TASK-028：公休日是硬規則，不能只在畫面層擋）", () => {
    it("已標記為特殊公休日：回傳 SLOT_CONFLICT，不寫入任何 appointments／customers 資料", async () => {
      const addResult = await addClosedDate(designerClient, CREATE_APPOINTMENT_CLOSED_DATE);
      closedDatesToCleanup.push(CREATE_APPOINTMENT_CLOSED_DATE);
      expect(addResult.ok).toBe(true);

      const phone = testPhone();
      const result = await createAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(CREATE_APPOINTMENT_CLOSED_DATE, 11, 0),
        customerName: `${TEST_MARKER} closed-a`,
        customerPhone: phone,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("SLOT_CONFLICT");

      const { data: appointmentRows, error: appointmentError } = await serviceRoleClient
        .from("appointments")
        .select("id")
        .eq("customer_phone", phone);
      if (appointmentError) throw appointmentError;
      expect(appointmentRows).toEqual([]);

      const { data: customerRows, error: customerError } = await serviceRoleClient
        .from("customers")
        .select("id")
        .eq("phone", phone);
      if (customerError) throw customerError;
      expect(customerRows).toEqual([]);
    });

    // architect 於本卡總覽審查提出的 NICE TO HAVE：上面的案例固定用 11:00（台北）＝
    // 當天 03:00 UTC，若時區轉換寫錯成直接用 UTC 日期（例如誤寫成 p_start_at::date），
    // 這個案例一樣會通過（兩個時區當下算出的日期剛好相同），測不出時區邏輯本身是否正確。
    // 這裡改用台北時間 00:30——換算成 UTC 是「前一天」16:30，只有真的以 Asia/Taipei
    // 轉換後取 date 才會落在 CREATE_APPOINTMENT_CLOSED_DATE 這一天，才會被公休日檢查
    // 命中；若程式碼誤用 UTC 日期，會誤判成「前一天」（未標記公休），這個案例就會失敗。
    it("台北時間跨 UTC 日界（00:30）：公休日判定仍以 Asia/Taipei 曆日為準，不是 UTC 曆日", async () => {
      const addResult = await addClosedDate(designerClient, CREATE_APPOINTMENT_CLOSED_DATE);
      closedDatesToCleanup.push(CREATE_APPOINTMENT_CLOSED_DATE);
      expect(addResult.ok).toBe(true);

      const startAt = isoAt(CREATE_APPOINTMENT_CLOSED_DATE, 0, 30);
      // 前置假設驗證：這個時間點換算成 UTC 確實是前一天，測試本身才有意義（不是恆真）。
      expect(startAt.slice(0, 10)).not.toBe(CREATE_APPOINTMENT_CLOSED_DATE);

      const result = await createAppointment(anonClient, {
        serviceId: testServiceId,
        startAt,
        customerName: `${TEST_MARKER} closed-d`,
        customerPhone: testPhone(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("SLOT_CONFLICT");
    });

    it("同一組輸入：get_available_slots 回傳空陣列、create_appointment 拒絕寫入，兩者判斷一致", async () => {
      const addResult = await addClosedDate(designerClient, CREATE_APPOINTMENT_CLOSED_DATE);
      closedDatesToCleanup.push(CREATE_APPOINTMENT_CLOSED_DATE);
      expect(addResult.ok).toBe(true);

      const slotsResult = await getAvailableSlots(anonClient, testServiceId, CREATE_APPOINTMENT_CLOSED_DATE);
      expect(slotsResult.ok).toBe(true);
      if (!slotsResult.ok) return;
      expect(slotsResult.data).toEqual([]);

      const result = await createAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(CREATE_APPOINTMENT_CLOSED_DATE, 11, 0),
        customerName: `${TEST_MARKER} closed-b`,
        customerPhone: testPhone(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("SLOT_CONFLICT");
    });

    it("移除公休標記後，同樣輸入的 create_appointment 恢復成功（回歸安全網：未標記公休的日期行為不變）", async () => {
      const removeResult = await removeClosedDate(designerClient, CREATE_APPOINTMENT_CLOSED_DATE);
      expect(removeResult.ok).toBe(true);

      const result = await createAppointment(anonClient, {
        serviceId: testServiceId,
        startAt: isoAt(CREATE_APPOINTMENT_CLOSED_DATE, 11, 0),
        customerName: `${TEST_MARKER} closed-c`,
        customerPhone: testPhone(),
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("get_available_slots RPC 對 services.buffer_minutes 的回應", () => {
    it("buffer_minutes=30 的服務，緊接既有預約結束後 30 分鐘內的候選時段不可預約，30 分鐘後恢復正常", async () => {
      await insertAppointment({
        name: "buffer-occupant",
        startAt: isoAt(BUFFER_DATE, 12, 0),
        endAt: isoAt(BUFFER_DATE, 12, 30),
        serviceId: bufferServiceId,
      });

      const result = await getAvailableSlots(anonClient, bufferServiceId, BUFFER_DATE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const startTimes = result.data.map((slot) => new Date(slot.start_at).getTime());

      // 12:00-12:30 的既有預約 + 30 分鐘緩衝，有效佔用區間延伸到 13:00：12:30 起的候選
      // 時段落在緩衝內應被排除，13:00 起的候選時段已經在緩衝之外應正常出現。
      expect(startTimes).not.toContain(new Date(isoAt(BUFFER_DATE, 12, 30)).getTime());
      expect(startTimes).toContain(new Date(isoAt(BUFFER_DATE, 13, 0)).getTime());
    });

    it("buffer_minutes=0（既有服務，行為不變）：同樣情境下緊接既有預約結束後的候選時段正常可預約", async () => {
      await insertAppointment({
        name: "buffer-zero-occupant",
        startAt: isoAt(BUFFER_ZERO_DATE, 12, 0),
        endAt: isoAt(BUFFER_ZERO_DATE, 12, 30),
      });

      const result = await getAvailableSlots(anonClient, testServiceId, BUFFER_ZERO_DATE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const startTimes = result.data.map((slot) => new Date(slot.start_at).getTime());
      // 沒有緩衝：12:30 起的候選時段緊接在既有預約後，應正常可預約（不像上面 buffer=30 的案例被排除）。
      expect(startTimes).toContain(new Date(isoAt(BUFFER_ZERO_DATE, 12, 30)).getTime());
    });

    // services.buffer_minutes 的寫入邊界與 business_hours／closed_dates 是同一種風險結構：
    // services 對 authenticated 角色本身沒有整體 revoke，唯一防線是 "admin full access to
    // services" policy 的 is_admin() predicate（0001_core_schema.sql）。上面兩個 describe
    // 都已經補了對應表的非管理員寫入拒絕測試，這裡把同一道防線也套用到 buffer_minutes
    // 這個新欄位上，避免它是唯一沒被驗證過的一格——若這道防線失效，非管理員能把所有服務的
    // buffer_minutes 都改成上限 120，大幅癱瘓可預約時段（等同可預約性的阻斷攻擊）。
    it("已登入但非 is_admin() 的 authenticated 使用者無法直接更改 services.buffer_minutes，資料不受影響", async () => {
      // RLS 阻擋 UPDATE 的既有已知行為（比照 removeClosedDate／updateBusinessHours 的教訓）：
      // 可能回傳成功（error 為 null）但實際沒有列被更動，不是拋錯，所以不能只看 error 是否
      // 為 null，一定要用下面的 refetch 確認 buffer_minutes 真的沒被改動。
      await nonAdminClient.from("services").update({ buffer_minutes: 120 }).eq("id", bufferServiceId);

      const { data, error } = await serviceRoleClient
        .from("services")
        .select("buffer_minutes")
        .eq("id", bufferServiceId)
        .single();
      if (error) throw error;
      expect(data.buffer_minutes).toBe(30);
    });
  });

  describe("後台改期表單（computeAvailableSlots）與 get_available_slots RPC 對同一組輸入產生一致的可預約時段判斷", () => {
    it("同一天、buffer_minutes=30 的服務、同一筆既有預約，兩條獨立實作算出完全相同的可預約時段集合（刻意用非零緩衝，不是只驗證兩邊都不套緩衝的平凡情況）", async () => {
      await insertAppointment({
        name: "cross-validate-occupant",
        startAt: isoAt(CROSS_VALIDATE_DATE, 14, 0),
        endAt: isoAt(CROSS_VALIDATE_DATE, 14, 30),
        serviceId: bufferServiceId,
      });

      const rpcResult = await getAvailableSlots(anonClient, bufferServiceId, CROSS_VALIDATE_DATE);
      expect(rpcResult.ok).toBe(true);
      if (!rpcResult.ok) return;
      expect(rpcResult.data.length).toBeGreaterThan(0);
      // 先確認 14:00-14:30 的既有預約＋30 分鐘緩衝確實排除了 14:30 起的候選時段，
      // 否則下面兩邊比對即使緩衝邏輯整個沒生效、算出同一組（錯誤但一致）的結果也會通過，
      // 沒有真正驗證到緩衝輸入本身有造成差異。
      const rpcStartTimes = rpcResult.data.map((slot) => new Date(slot.start_at).getTime());
      expect(rpcStartTimes).not.toContain(new Date(isoAt(CROSS_VALIDATE_DATE, 14, 30)).getTime());

      const businessHoursResult = await getBusinessHoursForWeekday(designerClient, weekdayOf(CROSS_VALIDATE_DATE));
      expect(businessHoursResult.ok).toBe(true);
      if (!businessHoursResult.ok) return;

      const closedResult = await isDateClosed(designerClient, CROSS_VALIDATE_DATE);
      expect(closedResult.ok).toBe(true);
      if (!closedResult.ok) return;

      const occupiedResult = await getOccupiedRangesForDate(
        designerClient,
        CROSS_VALIDATE_DATE,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(occupiedResult.ok).toBe(true);
      if (!occupiedResult.ok) return;

      // CROSS_VALIDATE_DATE 離今天 65 天以上，遠超過 RPC 的「提前 1 小時」門檻與
      // computeAvailableSlots 的「now 之後」門檻（見 lib/admin/reschedule-slots.ts 開頭
      // 註解：後台不套用顧客端的提前量／90 天視野限制），在這個距離下兩者的候選時段
      // 起點集合理論上應該完全相同，是唯一能讓兩條獨立實作直接逐筆比對的距離。
      // bufferMinutes 用 30（bufferServiceId 實際的 buffer_minutes）而非 0，確保這個比對
      // 真的在驗證兩邊對「非零緩衝」輸入算出一致結果，不是兩邊都不套緩衝的平凡情況。
      const computed = computeAvailableSlots({
        date: CROSS_VALIDATE_DATE,
        durationMinutes: 30,
        businessHours: businessHoursResult.data,
        occupiedRanges: occupiedResult.data,
        now: Date.now(),
        bufferMinutes: 30,
        isClosedDate: closedResult.data,
      });

      const toEpochPairs = (slots: { start_at: string; end_at: string }[]) =>
        slots
          .map((slot) => [new Date(slot.start_at).getTime(), new Date(slot.end_at).getTime()] as const)
          .sort((a, b) => a[0] - b[0]);

      expect(toEpochPairs(computed)).toEqual(toEpochPairs(rpcResult.data));
    });
  });
});
