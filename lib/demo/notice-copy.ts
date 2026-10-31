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

// 改期／取消最終確認後的寄信說明視窗（TASK-115）。只說明正式環境的行為，不宣稱「已寄出」；
// 真正不寄信由資料庫守門保證（TASK-114），這個視窗不是安全邊界。
export const DEMO_MAIL_NOTICE_NOTE = "正式環境會寄出這封信；體驗帳號不會真的寄出。";
export const DEMO_MAIL_NOTICE_CONTINUE_LABEL = "我知道了，繼續";
export const DEMO_MAIL_NOTICE_BACK_LABEL = "返回";

export const DEMO_MAIL_NOTICE_COPY = {
  reschedule: {
    title: "顧客會收到這封改期通知信",
    imageSrc: "/demo/mail-notice-reschedule.png",
    // 圖片的實際像素（2x），元件以它推算長寬比預留高度，圖片載入前視窗不會跳動。
    imageWidth: 1120,
    imageHeight: 976,
    imageAlt: "改期通知信示意：主旨「預約已改期：新日期與時間」，內容列出服務項目、原時段、新時段與設計師，並附店家聯絡方式。",
    // 圖片載入失敗時的文字替代（畫面規格「錯誤」狀態），不顯示錯誤訊息。
    fallbackSubject: "預約已改期：{新日期} {新時間}",
    fallbackBody: "內容會列出服務項目、原時段與新時段，並附店家聯絡方式。",
  },
  cancel: {
    title: "顧客會收到這封取消通知信",
    imageSrc: "/demo/mail-notice-cancel.png",
    imageWidth: 1120,
    imageHeight: 1006,
    imageAlt: "取消通知信示意：主旨「預約已取消：服務名稱與原日期時間」，內容列出服務項目與原預約時段，並附店家聯絡方式。",
    fallbackSubject: "預約已取消：{服務名稱} {原日期} {原時間}",
    fallbackBody: "內容會列出服務項目與原預約時段，並附店家聯絡方式。",
  },
} as const;
