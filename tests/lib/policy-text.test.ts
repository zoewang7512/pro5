import { describe, expect, it } from "vitest";
import { formatBookingPolicyText } from "@/lib/booking/policy-text";

describe("formatBookingPolicyText", () => {
  it("兩項政策皆已設定時，同時顯示提前預約時間與取消／改期時限句子", () => {
    expect(formatBookingPolicyText({ min_lead_time_hours: 3, cancel_window_hours: 24 })).toBe(
      "請於預約時段前 3 小時完成預約。請於預約時段前 24 小時以前完成取消或改期。",
    );
  });

  it("cancel_window_hours 為 null（未設定）時，只顯示提前預約時間句子，不出現空白或多餘片段", () => {
    expect(formatBookingPolicyText({ min_lead_time_hours: 1, cancel_window_hours: null })).toBe(
      "請於預約時段前 1 小時完成預約。",
    );
  });

  it("cancel_window_hours 為 0（刻意設定「隨時可取消」而非未設定）時，仍視為已設定並顯示句子", () => {
    expect(formatBookingPolicyText({ min_lead_time_hours: 2, cancel_window_hours: 0 })).toBe(
      "請於預約時段前 2 小時完成預約。請於預約時段前 0 小時以前完成取消或改期。",
    );
  });
});
