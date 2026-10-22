import { describe, expect, it } from "vitest";
import { getBookingErrorMessage } from "@/lib/booking/error-messages";

describe("getBookingErrorMessage", () => {
  it("BOOKING_LIMIT_EXCEEDED 用通用說法：不區分是電話或 email 觸發上限（避免變成探測某個聯絡資訊有沒有預約的管道）", () => {
    const message = getBookingErrorMessage("BOOKING_LIMIT_EXCEEDED");
    expect(message).toBe("你的聯絡資訊目前有太多筆待確認的預約，請稍後再試或聯繫我們協助處理。");
    expect(message).not.toMatch(/電話|email|信箱/i);
  });
});
