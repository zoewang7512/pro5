import type { BookingErrorCode } from "./types";

// 錯誤代碼 → 中文訊息集中管理，未來新增錯誤類型只改這裡。
// 訊息刻意不透露原始 error_code 或任何後端細節。
const ERROR_MESSAGES: Record<BookingErrorCode, string> = {
  SLOT_CONFLICT: "很抱歉，這個時段剛被別人預約走了，請重新選擇時段。",
  SERVICE_INACTIVE: "此服務項目目前無法預約，請重新整理頁面後再試一次。",
  VALIDATION_ERROR: "送出的時段或資料不符合預約規則，請重新確認後再試一次。",
  // 中性說法：這個代碼有兩種觸發原因（未來待服務預約已達 3 筆、24 小時內建立滿 3 筆，含已取消，見 0030），
  // 後者的顧客可能沒有任何待確認的預約，所以不寫「待確認」，也不透露是哪一種、哪個聯絡資訊觸發。
  BOOKING_LIMIT_EXCEEDED: "預約次數已達上限，請稍後再試或聯繫我們。",
  INTERNAL_ERROR: "發生未預期的錯誤，請稍後再試一次。",
};

export function getBookingErrorMessage(code: BookingErrorCode): string {
  return ERROR_MESSAGES[code];
}
