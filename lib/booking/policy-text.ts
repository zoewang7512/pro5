import type { BookingPolicy } from "@/lib/booking-policy";

// 顧客前台政策說明卡片的文案組成純函式，與資料存取分離方便單元測試。
// cancel_window_hours 為 null（未設定）時只顯示提前預約時間的句子，不顯示取消／改期
// 句子，也不出現空白或錯誤數值片段（見 TASK-049 任務卡的假設段落）。
//
// 取消句子用「N 小時以前」而非「N 小時內」：後台說明文字（BookingPolicyForm.tsx）是
// 「顧客需在預約時段開始前至少這麼多小時完成取消或改期」，即最晚 N 小時前要取消；
// 原文案「N 小時內可免費取消或改期」字面上讀起來像是「最後 N 小時內都還能免費取消」，
// 語意恰好相反，顧客可能誤以為臨到頭仍可免費取消。security-reviewer 於 TASK-050 Epic
// 總覽性審查發現，已依人工核准修正（同步更新 feature-spec.md 的文案範例）。

export function formatBookingPolicyText(policy: BookingPolicy): string {
  const leadSentence = `請於預約時段前 ${policy.min_lead_time_hours} 小時完成預約。`;
  if (policy.cancel_window_hours == null) {
    return leadSentence;
  }
  return `${leadSentence}請於預約時段前 ${policy.cancel_window_hours} 小時以前完成取消或改期。`;
}
