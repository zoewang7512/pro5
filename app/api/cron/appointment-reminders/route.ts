import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { verifyBearerSecret } from "@/lib/webhooks/verify-secret";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/lib/email/resend-client";
import { buildReminderEmail } from "@/lib/email/templates/reminder";
import { getStoreSettings } from "@/lib/store-settings";
import {
  claimAppointmentsForReminder,
  computeReminderWindow,
  releaseReminderClaim,
} from "@/lib/admin/appointment-reminders";

// Vercel Cron 觸發端點（TASK-054：預約前提醒信）。Vercel Cron 一律以 GET 方法
// 呼叫排程端點，並在請求帶上 `Authorization: Bearer <CRON_SECRET>`（Vercel 官方
// 慣例：專案設定了同名為 CRON_SECRET 的環境變數時，平台會自動附加這個 header，
// 不需要另外設定 Vercel Dashboard 的 webhook 之類手動步驟）。時間窗計算與
// 「claim 模式」去重見 lib/admin/appointment-reminders.ts 的完整說明（含 Vercel
// Hobby 方案每日一次的限制如何影響時間窗寬度設計）。

// Vercel Hobby 方案 serverless function 執行時間上限為 60 秒；本端點是「一次
// 呼叫扛整批」的排程模式（不同於 webhook 端點每次只處理一筆），若序列處理沒有
// 時間預算控管，逾時會讓平台強制中止 invocation——此時已經被 claim（
// reminder_sent_at 已設定）但還沒寄出的預約會永久漏寄且沒有任何錯誤訊號
// （security-reviewer 於本卡審查提出的 MUST FIX）。下方用 TIME_BUDGET_MS 搭配
// Date.now() 檢查，在逼近上限前主動停止處理剩餘項目並逐筆釋放去重佔位。
export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;

export async function GET(req: NextRequest) {
  // 密鑰驗證失敗一律 401，不執行任何後續邏輯，避免對未驗證請求做任何多餘的運算。
  if (!verifyBearerSecret(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createServiceRoleClient();
  const window = computeReminderWindow(new Date());

  const claimResult = await claimAppointmentsForReminder(supabase, window);
  if (!claimResult.ok) {
    // 回 500（而非 200）：這是排程本身的健康訊號，Vercel Cron 的執行紀錄／
    // Observability 靠回應狀態碼判斷成功與否；webhook 端點回 200 是因為那裡
    // 的理由是「不要用非 2xx 汙染 net._http_response 的監控訊號」，pg_net 語境
    // 專屬，對 cron 不適用——這裡若吞成 200，排程失敗會對監控完全隱形
    // （architect／security-reviewer 於本卡審查提出的 MUST FIX）。
    console.error("appointment-reminders: 查詢/去重更新失敗", { error: claimResult.error.message });
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
  }

  const claimed = claimResult.data;
  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, claimed: 0 });
  }

  // 店家聯絡資訊整批次共用一次查詢即可（不像顧客資料逐筆不同），比照
  // TASK-052/053 的既有模式；查無資料或查詢失敗時使用預設值，不阻擋整批次寄信。
  const storeSettingsResult = await getStoreSettings(supabase);
  const storeSettings = storeSettingsResult.ok ? storeSettingsResult.data : null;

  let sentCount = 0;

  // 單筆失敗不中斷整批次的迴圈（需求明訂）：每筆都各自包在 try/catch 內處理。
  // claim 查詢已用 .order("start_at") 讓最快到來的預約排在前面，逼近時間預算
  // 而提前中止時，犧牲的會是最不急迫的預約。
  for (let i = 0; i < claimed.length; i++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // 時間預算用盡：把「已 claim 但還沒處理到」的剩餘項目全部釋放，讓牠們
      // 明天的排程執行時能重新被撈到（下界已改為 0 小時，只要還沒開始就一定
      // 還在時間窗內，見 lib/admin/appointment-reminders.ts 的說明），不會
      // 因為這次逾時而永久漏寄。
      console.error("appointment-reminders: 逼近執行時間預算，提前中止並釋放剩餘去重佔位", {
        processed: i,
        remaining: claimed.length - i,
      });
      for (let j = i; j < claimed.length; j++) {
        await releaseReminderClaim(supabase, claimed[j].id);
      }
      break;
    }

    const appointment = claimed[i];

    if (!appointment.customer_email) {
      // 沒有 email 是永久狀態，reminder_sent_at 已經在 claim 階段設定，不需要
      // 額外動作，也不計入 sentCount。
      continue;
    }

    try {
      const { subject, html } = buildReminderEmail({
        customerName: appointment.customer_name,
        serviceName: appointment.service_name,
        startAt: appointment.start_at,
        storeName: storeSettings?.name,
        storePhone: storeSettings?.phone,
      });

      const result = await sendEmail({ to: appointment.customer_email, subject, html });
      if (!result.ok) {
        // 不記錄完整 email；只記錄 appointment id 與錯誤代碼供人工排查（比照
        // TASK-052/053 既有紀律）。改成 0 小時下界後，釋放的佔位隔天執行時
        // 一定能被重新撈到（見 lib/admin/appointment-reminders.ts 的說明），
        // 這裡的「供下次排程重試」是名副其實的。
        console.error("appointment-reminders: 提醒信寄送失敗，釋放去重佔位供下次排程重試", {
          appointmentId: appointment.id,
          code: result.error.code,
        });
        await releaseReminderClaim(supabase, appointment.id);
        continue;
      }

      sentCount += 1;
    } catch (caught) {
      console.error("appointment-reminders: 組信/寄信過程發生未預期例外，釋放去重佔位供下次排程重試", {
        appointmentId: appointment.id,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      await releaseReminderClaim(supabase, appointment.id);
    }
  }

  return NextResponse.json({ ok: true, sent: sentCount, claimed: claimed.length });
}
