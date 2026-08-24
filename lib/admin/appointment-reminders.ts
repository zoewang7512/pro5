import type { SupabaseClient } from "@supabase/supabase-js";

// 排程端點（app/api/cron/appointment-reminders/route.ts）使用的資料存取層
// （TASK-054），比照既有 lib/admin/*.ts 的 Result<T> 錯誤處理模式。

export type ReminderError = { message: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: ReminderError };

const INTERNAL_ERROR: ReminderError = { message: "發生未預期的錯誤，請稍後再試。" };

export type ReminderWindow = { from: string; to: string };

// **Vercel Hobby 方案限制 Cron 只能每天執行一次**（任務卡「未知事項」在實作階段
// 查證確認：本專案 Vercel 帳號為 Hobby 方案；Hobby 方案的 cron 表達式若解析出
// 一天內多次執行會直接部署失敗，且官方文件僅保證觸發時間落在指定小時內、不保證
// 精確分鐘）。因此無法採用任務卡原本假設的「每小時執行、23～25 小時」窄時間窗，
// 改用涵蓋更寬範圍的時間窗。
//
// **下界必須是 0（或極小值），不能設成 20 小時**——這是實作初版的錯誤，
// architect 於本卡審查發現：下界只要大於 0，就會對「排程執行之後才建立、且
// 提前量落在下界～(下界+24h) 之間」的預約造成永久漏寄。例如原本的
// LOWER_BOUND_HOURS=20：某次執行 R 之後才新增一筆提前 33 小時的預約，R 當然
// 沒機會撈到；下一次執行 R'（約 R+24h）時，這筆預約距離 R' 只剩 9 小時，已經
// 低於 20 小時下界，同樣被排除——這筆預約永遠不會被任何一次執行撈到。下界為 0
// 則不存在這個問題：只要預約還沒開始，任何一次執行都「看得到」它，一定會在
// 它落入上界範圍內的某次執行被撈到。
// 上界（26 小時）比每日執行的間隔（24 小時，Vercel 文件記載的「落在指定小時內」
// 誤差最多再加 1 小時）多出至少 1 小時安全邊際，確保連續兩次執行的時間窗必定
// 有重疊，不會因為執行時間點的些微飄移而漏掃；也讓「某天完全沒執行」時，隔天
// 仍能撈回所有還沒開始的預約（真正的自我修復，不同於錯誤版本「上界寬但下界
// 卡住」的偽自我修復）。
// 代價：提醒信寄送時間與「預約前 24 小時」會有 0～26 小時的誤差，這是任務卡
// 「假設」段落已預期、要求記錄的已知取捨（Hobby 方案限制導致無法採用原本假設
// 的每小時執行）。
const LOWER_BOUND_HOURS = 0;
const UPPER_BOUND_HOURS = 26;

// 單次執行處理的預約筆數上限，搭配 route.ts 的 maxDuration 與時間預算提前中止，
// 避免無上限批次在 serverless function 逾時限制內處理不完（security-reviewer
// 於本卡審查提出的 MUST FIX：claim 先佔位、若逾時中止會讓剩餘預約永久漏寄且
// 無告警）。本專案單一理髮廳、預約量小，100 筆遠超過實際每日提醒量，這個上限
// 只是防禦性上限，不預期會被打到。
export const MAX_BATCH_SIZE = 100;

// 抽成純函式方便單元測試涵蓋不同「現在時間」的計算結果（任務卡驗證契約要求）。
export function computeReminderWindow(now: Date): ReminderWindow {
  const from = new Date(now.getTime() + LOWER_BOUND_HOURS * 60 * 60 * 1000);
  const to = new Date(now.getTime() + UPPER_BOUND_HOURS * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export type ClaimedReminderAppointment = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  start_at: string;
  service_name: string;
};

type RawService = { name: string };
type RawClaimedRow = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  start_at: string;
  services: RawService | RawService[] | null;
};

// PostgREST embedded resource 依 supabase-js 版本可能回傳物件或單元素陣列，兩種
// 形狀都攤平成同一個型別（比照 lib/admin/appointments.ts 既有的 flattenService
// 慣例）。
function flattenServiceName(services: RawClaimedRow["services"]): string {
  const service = Array.isArray(services) ? services[0] : services;
  return service?.name ?? "服務";
}

// 「claim 模式」：用一次 UPDATE ... WHERE reminder_sent_at IS NULL ... RETURNING
// 原子性地同時完成「查詢符合條件的預約」與「取得寄送權」，而不是先 select 再逐筆
// update（TASK-051 審查後追加的注意事項，見 TASK-054 任務卡情境包）——如果排程
// 重疊執行（例如手動觸發與排程觸發時間相近），兩個執行個體對同一筆列的 UPDATE
// 會被資料庫的列鎖序列化，只有一個能真正搶到 reminder_sent_at 從 null 改成非
// null，另一個的 WHERE 條件在它拿到列鎖時已經不成立，不會重複選中同一筆。
//
// customer_email 為空的預約也會被這次 UPDATE 一併「claim」（reminder_sent_at
// 照樣被設定）——這是任務卡需求明訂的行為：「customer_email 為空的預約跳過寄信
// 但仍更新 reminder_sent_at，避免下次排程重複掃描到同一筆本來就不會寄信的
// 預約」，呼叫端（route.ts）只需要在拿到的清單裡對 customer_email 為空的項目
// 跳過寄信，不需要額外處理去重。
//
// select 內嵌 services(name) 一次查完服務名稱，不像 webhook 端點逐筆查（那裡
// 一次只處理一列）；這裡 claim 一次可能回幾十列，逐筆查會是不必要的 N+1 往返
// （architect 於本卡審查提出的 NICE TO HAVE，比照 lib/admin/appointments.ts
// getAppointmentsForWeek 的既有 join 慣例）。
//
// .order("start_at") 讓最快到來的預約優先處理，搭配 route.ts 的時間預算提前
// 中止機制，逾時發生時犧牲的會是最不急迫的預約，不是隨機的（architect 提出）。
// .limit(MAX_BATCH_SIZE) 防禦性上限，見上方常數說明。
export async function claimAppointmentsForReminder(
  supabase: SupabaseClient,
  window: ReminderWindow,
): Promise<Result<ClaimedReminderAppointment[]>> {
  const { data, error } = await supabase
    .from("appointments")
    .update({ reminder_sent_at: new Date().toISOString() })
    .gte("start_at", window.from)
    .lt("start_at", window.to)
    .in("status", ["pending", "confirmed"])
    .is("reminder_sent_at", null)
    .order("start_at", { ascending: true })
    .limit(MAX_BATCH_SIZE)
    .select("id, customer_name, customer_email, start_at, services(name)");

  if (error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const claimed = ((data ?? []) as RawClaimedRow[]).map((row) => ({
    id: row.id,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    start_at: row.start_at,
    service_name: flattenServiceName(row.services),
  }));

  return { ok: true, data: claimed };
}

// 把已 claim 但最終沒有成功寄出的預約（寄信失敗、組信例外、或因時間預算提前
// 中止而沒處理到）的 reminder_sent_at 釋放回 null。
//
// **誠實記錄這個「釋放」的實際效果**（architect 於本卡審查提出）：由於 Cron
// 每天只執行一次，被釋放的預約要等到隔天才有機會重新被 claim，而隔天執行時，
// 該筆預約距離開始的時間可能已經低於下界（現在下界是 0，所以只要還沒開始就
// 一定還在窗內——這點在改成 0 小時下界後已經修正，任何被釋放的預約只要還沒
// 開始，隔天一定會被重新撈到）。因此本次修正後，「釋放供下次排程重試」是
// 名副其實的，不是聊勝於無的假訊號。
export async function releaseReminderClaim(supabase: SupabaseClient, appointmentId: string): Promise<void> {
  const { error } = await supabase.from("appointments").update({ reminder_sent_at: null }).eq("id", appointmentId);

  if (error) {
    console.error("appointment-reminders: 釋放提醒信去重佔位失敗，需人工檢查", {
      appointmentId,
      error: error.message,
    });
  }
}
