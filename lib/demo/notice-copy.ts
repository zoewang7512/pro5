// Demo 體驗帳號的說明視窗與橫幅文案，單一來源（TASK-105 的 DemoNotice 與之後的畫面都從這裡取）。
//
// 刻意**不加** `import "server-only"`：前端元件（DemoNotice）要匯入。所以這個檔案
// 不得放任何環境變數、密碼或其他不該進瀏覽器 bundle 的東西——那些放在 `config.ts`。

// 還原時間文案（使用者已於 2026-10-30 定案）。Vercel Hobby 的排程只保證在該小時內觸發，
// 所以不寫「03:00 整」。整句為 `資料${DEMO_RESET_LABEL}還原`。與 vercel.json 的 cron 時間
// 是否一致，由 TASK-110 的測試把關。
export const DEMO_RESET_LABEL = "每日凌晨 3 點左右";

export const DEMO_NOTICE_TITLE = "您正在使用體驗帳號";

// 橫幅：缺少還原時間時降級成不含時間的簡短版（畫面規格「錯誤」狀態）。
export const DEMO_BANNER_TEXT = `${DEMO_NOTICE_TITLE}。不開放改密碼、改 Email、啟用 MFA；資料${DEMO_RESET_LABEL}還原。`;
export const DEMO_BANNER_TEXT_SHORT = `${DEMO_NOTICE_TITLE}。`;
export const DEMO_LEARN_MORE_LABEL = "了解更多";

export const DEMO_CAN_TRY_TITLE = "可以體驗";
export const DEMO_CAN_TRY_ITEMS = [
  "預約週曆、改期、取消、標記完成",
  "設計師、作品集、請假與服務設定",
  "營業時間、公休日、儀表板與報表",
] as const;

export const DEMO_NOT_ALLOWED_TITLE = "不開放";
export const DEMO_NOT_ALLOWED_ITEMS = ["修改密碼、登入 Email", "啟用／停用雙重驗證（MFA）"] as const;

export const DEMO_NOTICE_CONFIRM_LABEL = "開始體驗";
