import type { BookingErrorCode } from "./types";

// 錯誤代碼 → 中文訊息集中管理，未來新增錯誤類型只改這裡。
// 訊息刻意不透露原始 error_code 或任何後端細節。
const ERROR_MESSAGES: Record<BookingErrorCode, string> = {
  SLOT_CONFLICT: "很抱歉，這個時段剛被別人預約走了，請重新選擇時段。",
  SERVICE_INACTIVE: "此服務項目目前無法預約，請重新整理頁面後再試一次。",
  VALIDATION_ERROR: "送出的時段或資料不符合預約規則，請重新確認後再試一次。",
  BOOKING_LIMIT_EXCEEDED: "這支電話目前有太多筆待確認的預約，請稍後再試或聯繫我們協助處理。",
  INTERNAL_ERROR: "發生未預期的錯誤，請稍後再試一次。",
};

export function getBookingErrorMessage(code: BookingErrorCode): string {
  return ERROR_MESSAGES[code];
}
