import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { verifySecret } from "@/lib/webhooks/verify-secret";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/lib/email/resend-client";
import { buildConfirmationEmail } from "@/lib/email/templates/confirmation";
import { buildCancellationEmail } from "@/lib/email/templates/cancellation";
import { buildRescheduleEmail } from "@/lib/email/templates/reschedule";
import { classifyAppointmentUpdate, type AppointmentUpdateSnapshot } from "@/lib/email/classify-appointment-update";
import { getStoreSettings, resolveStoreDisplay } from "@/lib/store-settings";

// Supabase Database Webhook 觸發端點（TASK-052：appointments INSERT → 確認信；
// TASK-053：appointments UPDATE → 取消/改期通知信，同一支端點依 type 分派，
// 互不干擾）。密鑰與觸發目標網址不寫死在任何 migration 檔案，改由
// supabase/migrations/0011_appointments_insert_webhook.sql（INSERT）／
// 0012_appointments_update_webhook.sql（UPDATE，TASK-053 新增，沿用同一組
// Vault 密鑰與目標網址，見該檔案檔頭說明）建立的 trigger 在執行時讀取 Supabase
// Vault。
//
// 官方 payload 格式：{ type, table, schema, record, old_record }。
//
// - INSERT：record 只帶 appointment id。實際寄信所需的顧客/服務資料由本端點
//   用 service role client 依 id 重新讀回資料庫最新值（security-reviewer 於
//   TASK-052 審查提出的 MUST FIX：trigger 若把整列送出，會連帶外洩
//   access_token 等欄位）。
// - UPDATE：record 帶 {id, status, start_at, end_at}，old_record 帶
//   {status, start_at, end_at}——**兩者都必須信任 payload 內容，且必須是同一次
//   UPDATE 語句的前後快照**，不能只送 record 的 id 再事後重讀資料庫當下值
//   （architect 於 TASK-053 審查發現的 MUST FIX：若同一筆預約短時間內連續發生
//   兩次真正異動，事後重讀資料庫會讓兩次 webhook 讀到同一個「當下值」而重複
//   誤判，見 0012 migration 檔頭的完整說明）。分類（取消/改期/none）與信件內容
//   中「原時段／新時段」皆直接使用 payload 的 record／old_record，不重讀資料庫；
//   只有 customer_name／customer_email／service_id 這幾個不受時序問題影響的
//   識別性欄位才依 id 重讀資料庫（同樣是為了不整列送出、避免外洩
//   access_token 等欄位）。

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
};

type RecordId = { id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidRecordId(record: Record<string, unknown> | null): record is RecordId {
  return !!record && typeof record.id === "string" && UUID_RE.test(record.id);
}

// start_at／end_at 額外驗證可被 Date.parse() 解析：非法值若放行到後面才由
// formatAppointmentDateTime（TASK-051）拋出例外，會被 handleAppointmentUpdate
// 的 try/catch 吞成 200，webhook 來源端看不出這是一筆畸形 payload；在型別守衛
// 這層就擋下、回 400，才會在 net._http_response 留下可排查的異常訊號
// （architect 於本卡審查提出的 NICE TO HAVE）。
function isValidSnapshot(value: Record<string, unknown> | null): value is AppointmentUpdateSnapshot {
  return (
    !!value &&
    typeof value.status === "string" &&
    typeof value.start_at === "string" &&
    typeof value.end_at === "string" &&
    !Number.isNaN(Date.parse(value.start_at)) &&
    !Number.isNaN(Date.parse(value.end_at))
  );
}

type UpdateEventRecord = AppointmentUpdateSnapshot & { id: string };

function isValidUpdateRecord(record: Record<string, unknown> | null): record is UpdateEventRecord {
  return !!record && typeof record.id === "string" && UUID_RE.test(record.id) && isValidSnapshot(record);
}

type ClaimedAppointment = {
  customer_name: string;
  customer_email: string | null;
  start_at: string;
  service_id: string;
};

type AppointmentIdentity = {
  customer_name: string;
  customer_email: string | null;
  service_id: string;
};

export async function POST(req: NextRequest) {
  // 密鑰驗證失敗一律 401，不執行任何後續邏輯（含解析 body），避免對未驗證請求
  // 做任何多餘的運算。
  if (!verifySecret(req.headers.get("x-webhook-secret"), process.env.SUPABASE_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 只處理 appointments 表的事件；理論上密鑰只給這支端點的 trigger 使用，這裡仍
  // 防禦性檢查來源表格，避免密鑰或端點網址未來被誤用/重新指派時處理到非預期資料。
  if (payload?.schema !== "public" || payload?.table !== "appointments") {
    return NextResponse.json({ ok: true, skipped: "unrecognized_source" });
  }

  if (payload.type === "INSERT") {
    return handleAppointmentInsert(payload.record);
  }

  if (payload.type === "UPDATE") {
    return handleAppointmentUpdate(payload.record, payload.old_record);
  }

  // DELETE：本 Epic 三個 User Story 皆不涵蓋刪除事件，先 ack 不處理。回 200 不是
  // 為了避免觸發重試——0011/0012 migration 用的 pg_net 本來就不會重試（見該檔案
  // 檔頭說明），這裡只是不想讓非 2xx 回應污染 net._http_response 的監控訊號。
  return NextResponse.json({ ok: true, skipped: "type_not_handled" });
}

async function handleAppointmentInsert(record: Record<string, unknown> | null) {
  if (!isValidRecordId(record)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // 去重＋讀取寄信所需欄位一次完成：原子性地把 confirmation_sent_at 從 null 改成
  // now()，只有真正搶到這次更新的請求才會繼續處理，同時用 RETURNING 讀回資料庫
  // 當下的實際欄位值（不信任 payload 內容，見檔頭說明）。Supabase trigger 若因故
  // 對同一筆 INSERT 觸發兩次，第二次會在這裡被擋下而不會重複寄信。
  const { data, error: claimError } = await supabase
    .from("appointments")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", record.id)
    .is("confirmation_sent_at", null)
    .select("customer_name, customer_email, start_at, service_id")
    .maybeSingle();

  if (claimError) {
    console.error("appointment-events: 確認信去重更新失敗", {
      appointmentId: record.id,
      error: claimError.message,
    });
    return NextResponse.json({ ok: true });
  }
  if (!data) {
    // 未搶到：可能是已處理過，也可能是 id 不存在。兩者都沒有動作可做。
    return NextResponse.json({ ok: true, skipped: "not_claimed" });
  }

  const claimed = data as ClaimedAppointment;

  if (!claimed.customer_email) {
    // 沒有 email 是永久狀態（不會因為重跑而改變），保留 confirmation_sent_at 已
    // 佔位的狀態即可，不需要之後補償釋放。
    return NextResponse.json({ ok: true, skipped: "no_email" });
  }

  // pg_net（migration 0011 的 trigger 使用）不會重試失敗的請求，一旦
  // confirmation_sent_at 寫入就不會有第二次觸發機會。以下任何失敗都必須把佔位
  // 釋放回 null，讓未來的人工／排程補寄機制能重新處理這筆預約，避免確認信永久
  // 遺失且無人知曉（architect／security-reviewer 於本卡審查提出的 MUST FIX）。
  try {
    const [{ data: service }, storeSettingsResult] = await Promise.all([
      supabase.from("services").select("name").eq("id", claimed.service_id).maybeSingle(),
      getStoreSettings(supabase),
    ]);
    const storeDisplay = storeSettingsResult.ok ? resolveStoreDisplay(storeSettingsResult.data) : null;

    const { subject, html } = buildConfirmationEmail({
      customerName: claimed.customer_name,
      serviceName: (service as { name: string } | null)?.name ?? "服務",
      startAt: claimed.start_at,
      storeName: storeDisplay?.name,
      storePhone: storeDisplay?.phone,
      storeLogoUrl: storeDisplay?.logoUrl,
      storeAddress: storeDisplay?.address,
    });

    const result = await sendEmail({ to: claimed.customer_email, subject, html });
    if (!result.ok) {
      // 不記錄完整 email；只記錄 appointment id 與錯誤代碼供人工排查（需求明訂）。
      console.error("appointment-events: 確認信寄送失敗，釋放去重佔位供後續補寄", {
        appointmentId: record.id,
        code: result.error.code,
      });
      await releaseConfirmationClaim(supabase, record.id);
    }
  } catch (caught) {
    console.error("appointment-events: 組信/寄信過程發生未預期例外，釋放去重佔位供後續補寄", {
      appointmentId: record.id,
      error: caught instanceof Error ? caught.message : String(caught),
    });
    await releaseConfirmationClaim(supabase, record.id);
  }

  return NextResponse.json({ ok: true });
}

async function releaseConfirmationClaim(supabase: SupabaseClient, appointmentId: string) {
  const { error } = await supabase
    .from("appointments")
    .update({ confirmation_sent_at: null })
    .eq("id", appointmentId);

  if (error) {
    console.error("appointment-events: 釋放確認信去重佔位失敗，需人工檢查", {
      appointmentId,
      error: error.message,
    });
  }
}

// UPDATE 事件（取消／改期）不新增去重欄位／佔位機制（不同於 INSERT 分支的
// confirmation_sent_at）：
// 1. pg_net 不會重試（見 0012 migration 檔頭），不存在「同一次真實異動被觸發兩次
//    webhook」的風險。
// 2. lib/admin/appointments.ts 的 cancelAppointment／rescheduleAppointment 本身
//    已有狀態機／樂觀鎖保護（`.in("status", ["pending","confirmed"])`／
//    `.eq("start_at", currentStartAt)`），同一筆預約不可能被重複觸發兩次「真正的」
//    取消或改期 UPDATE——第二次操作會因為找不到符合條件的列而回傳空結果、不執行
//    任何寫入，也就不會讓 trigger 再次觸發。
// 因此不需要比照 INSERT 分支的「claim → 失敗補償釋放」設計，這是 architect／
// security-reviewer 於本卡審查確認過的判斷。**已知殘留風險**（NICE TO HAVE，
// 非本卡阻斷項）：端點沒有節流機制，若 SUPABASE_WEBHOOK_SECRET 外洩，攻擊者可
// 對同一筆真實預約重放同一個 webhook payload 任意次數、每次都寄出一封通知信
// （不同於 INSERT 分支有 confirmation_sent_at 天然擋住重放），此風險與密鑰外洩
// 本身同源，留待未來視需要另立任務卡處理。
async function handleAppointmentUpdate(
  record: Record<string, unknown> | null,
  oldRecord: Record<string, unknown> | null,
) {
  if (!isValidUpdateRecord(record) || !isValidSnapshot(oldRecord)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // 分類只用 payload 的 record／old_record（同一次 UPDATE 語句的前後快照），
  // 不重讀資料庫——見檔頭說明的 race condition 修正。
  const classification = classifyAppointmentUpdate(oldRecord, record);

  if (classification === "none") {
    return NextResponse.json({ ok: true, skipped: "no_notification_needed" });
  }

  const supabase = createServiceRoleClient();

  // 只有識別性欄位（顧客姓名/信箱、服務 id）依 id 重讀資料庫，不信任 payload
  // ——這幾個欄位不受「短時間內連續兩次異動」的時序問題影響（cancel／reschedule
  // 都不會動到這些欄位），仍是為了不整列送出、避免外洩 access_token 等欄位。
  const { data, error } = await supabase
    .from("appointments")
    .select("customer_name, customer_email, service_id")
    .eq("id", record.id)
    .maybeSingle();

  if (error) {
    console.error("appointment-events: 讀取預約身分欄位失敗", {
      appointmentId: record.id,
      error: error.message,
    });
    return NextResponse.json({ ok: true });
  }
  if (!data) {
    return NextResponse.json({ ok: true, skipped: "not_found" });
  }

  const identity = data as AppointmentIdentity;

  if (!identity.customer_email) {
    return NextResponse.json({ ok: true, skipped: "no_email" });
  }

  try {
    const [{ data: service }, storeSettingsResult] = await Promise.all([
      supabase.from("services").select("name").eq("id", identity.service_id).maybeSingle(),
      getStoreSettings(supabase),
    ]);
    const serviceName = (service as { name: string } | null)?.name ?? "服務";
    const storeDisplay = storeSettingsResult.ok ? resolveStoreDisplay(storeSettingsResult.data) : null;

    const { subject, html } =
      classification === "cancelled"
        ? buildCancellationEmail({
            customerName: identity.customer_name,
            serviceName,
            startAt: record.start_at,
            storeName: storeDisplay?.name,
            storePhone: storeDisplay?.phone,
            storeLogoUrl: storeDisplay?.logoUrl,
            storeAddress: storeDisplay?.address,
          })
        : buildRescheduleEmail({
            customerName: identity.customer_name,
            serviceName,
            oldStartAt: oldRecord.start_at,
            newStartAt: record.start_at,
            storeName: storeDisplay?.name,
            storePhone: storeDisplay?.phone,
            storeLogoUrl: storeDisplay?.logoUrl,
            storeAddress: storeDisplay?.address,
          });

    const result = await sendEmail({ to: identity.customer_email, subject, html });
    if (!result.ok) {
      console.error("appointment-events: 取消/改期通知信寄送失敗", {
        appointmentId: record.id,
        classification,
        code: result.error.code,
      });
    }
  } catch (caught) {
    console.error("appointment-events: 組信/寄信過程發生未預期例外", {
      appointmentId: record.id,
      classification,
      error: caught instanceof Error ? caught.message : String(caught),
    });
  }

  return NextResponse.json({ ok: true });
}
