// appointments UPDATE 事件的分類純函式（TASK-053），抽成獨立函式方便單元測試涵蓋
// 所有欄位變化組合（任務卡「實作備註」要求），不把判斷邏輯直接寫在 API Route
// handler 裡。
//
// 只依賴 status／start_at／end_at 三個欄位，呼叫端（route.ts）負責提供
// oldRecord／record——兩者都必須來自同一次 webhook payload（同一次 UPDATE
// 語句的前後快照），不能混用「payload 的 old_record」搭配「事後重讀資料庫的
// 當下值」：後者在同一筆預約短時間內連續發生兩次真正異動時（例如先改期、幾秒內
// 又取消），會讓兩次 webhook 都讀到同一個「當下值」而重複分類成同一種結果
// （architect 於 TASK-053 審查發現的 race condition，詳見
// supabase/migrations/0012_appointments_update_webhook.sql 的說明）。

export type AppointmentUpdateClassification = "cancelled" | "rescheduled" | "none";

export type AppointmentUpdateSnapshot = {
  status: string;
  start_at: string;
  end_at: string;
};

// start_at／end_at 用 Date.parse() 比較實際時間點，而非直接比字串——來源可能是
// Postgres to_jsonb(timestamptz)（受 session TimeZone 影響的字面格式）與應用層
// 各自序列化的結果，同一個時間點未必字面相同（例如 +00:00 與 +08:00 表示法）。
// 直接比字串在時區格式不一致時會誤判成「時段變更」（architect 於本卡審查提出的
// NICE TO HAVE，讓純函式本身正確，不依賴呼叫端 trigger WHEN 子句先過濾掉無意義
// 變動這個外部前提）。
function timesDiffer(a: string, b: string): boolean {
  const parsedA = Date.parse(a);
  const parsedB = Date.parse(b);
  if (Number.isNaN(parsedA) || Number.isNaN(parsedB)) {
    // 無法解析的時間字串視為「有差異」，交由呼叫端（route.ts 組信時會再次呼叫
    // formatAppointmentDateTime）依既有的例外處理機制擋下，不在這裡靜默吞掉。
    return a !== b;
  }
  return parsedA !== parsedB;
}

// 判斷順序即優先序：先判斷取消，才判斷改期。實務上 cancelAppointment／
// rescheduleAppointment（lib/admin/appointments.ts）是各自獨立的 update 呼叫，
// 不會有同一次 UPDATE 事件的欄位變化同時符合兩種情境；但即使未來有人寫出「取消
// 同時改期」的單一 update 呼叫，這裡的優先序也能給出明確、可預期的分類結果，而
// 不是未定義行為。
export function classifyAppointmentUpdate(
  oldRecord: AppointmentUpdateSnapshot,
  record: AppointmentUpdateSnapshot,
): AppointmentUpdateClassification {
  if (oldRecord.status !== "cancelled" && record.status === "cancelled") {
    return "cancelled";
  }

  if (
    record.status !== "cancelled" &&
    (timesDiffer(oldRecord.start_at, record.start_at) || timesDiffer(oldRecord.end_at, record.end_at))
  ) {
    return "rescheduled";
  }

  return "none";
}
