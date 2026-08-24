import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { verifySecret } from "@/lib/webhooks/verify-secret";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/lib/email/resend-client";
import { buildConfirmationEmail } from "@/lib/email/templates/confirmation";
import { getStoreSettings } from "@/lib/store-settings";

// Supabase Database Webhook 觸發端點（TASK-052：appointments INSERT → 確認信；
// TASK-053：appointments UPDATE → 取消/改期通知信，同一支端點依 type 分派，
// 互不干擾）。密鑰與觸發目標網址不寫死在任何 migration 檔案，改由
// supabase/migrations/0011_appointments_insert_webhook.sql 建立的 trigger 在
// 執行時讀取 Supabase Vault（見該檔案檔頭說明，含部署順序與 pg_net 不會重試的
// 說明）。
//
// 官方 payload 格式：{ type, table, schema, record, old_record }。record 只帶
// appointment id——不信任 payload 攜帶的其他欄位內容，實際寄信所需的顧客/服務
// 資料一律由本端點用 service role client 依 id 重新讀回資料庫最新值
// （security-reviewer 於本卡審查提出的 MUST FIX：trigger 若把整列送出，會連帶
// 外洩 access_token 等本卡不使用的欄位，見 0011 migration 檔頭說明）。

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
};

type InsertRecord = { id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidInsertRecord(record: Record<string, unknown> | null): record is InsertRecord {
  return !!record && typeof record.id === "string" && UUID_RE.test(record.id);
}

type ClaimedAppointment = {
  customer_name: string;
  customer_email: string | null;
  start_at: string;
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

  // UPDATE／DELETE：TASK-053 的範圍，目前先 ack 不處理。回 200 不是為了避免觸發
  // 重試——0011 migration 用的 pg_net 本來就不會重試（見該檔案檔頭說明），這裡
  // 只是不想讓非 2xx 回應污染 net._http_response 的監控訊號。
  return NextResponse.json({ ok: true, skipped: "type_not_handled" });
}

async function handleAppointmentInsert(record: Record<string, unknown> | null) {
  if (!isValidInsertRecord(record)) {
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
    const storeSettings = storeSettingsResult.ok ? storeSettingsResult.data : null;

    const { subject, html } = buildConfirmationEmail({
      customerName: claimed.customer_name,
      serviceName: (service as { name: string } | null)?.name ?? "服務",
      startAt: claimed.start_at,
      storeName: storeSettings?.name,
      storePhone: storeSettings?.phone,
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
