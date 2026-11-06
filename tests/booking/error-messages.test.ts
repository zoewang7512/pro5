import { describe, expect, it } from "vitest";
import { getBookingErrorMessage } from "@/lib/booking/error-messages";

describe("getBookingErrorMessage", () => {
  it("BOOKING_LIMIT_EXCEEDED 用中性說法：不區分是電話或 email 觸發上限（避免變成探測某個聯絡資訊有沒有預約的管道）", () => {
    const message = getBookingErrorMessage("BOOKING_LIMIT_EXCEEDED");
    expect(message).toBe("預約次數已達上限，請稍後再試或聯繫我們。");
    expect(message).not.toMatch(/電話|email|信箱/i);
  });

  it("BOOKING_LIMIT_EXCEEDED 不得說成「待確認」：0030 的 24 小時視窗（含已取消）擋下的顧客可能沒有任何待確認的預約（TASK-124）", () => {
    const message = getBookingErrorMessage("BOOKING_LIMIT_EXCEEDED");
    expect(message).not.toMatch(/待確認|待服務|太多筆/);
  });
});
