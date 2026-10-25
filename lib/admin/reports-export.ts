import type { Sheet } from "write-excel-file/browser";
import type { ReportPeriod, ReportTotals, TrendBucket } from "./reports";
import type { RankingRow } from "./reports-ranking";

// 報表匯出（瀏覽器端產生 .xlsx）。輸入只有畫面上已算好的彙總結果（期間、設計師名稱、彙總、排行、趨勢），
// 型別上就拿不到任何 customer_*；也不重新查詢或重算，匯出與畫面吃同一份結果，數字天然一致。
// 套件 write-excel-file 只在按下匯出時動態載入（不進主 bundle）。
// 公式注入：文字一律以字串型別（type: String）寫入、不會變成 <f> 公式，因此不改動文字內容；
// 只有明確指定 type: "Formula" 的儲存格才會是公式，這個模組不使用。

export type ReportExportData = {
  period: ReportPeriod;
  // 畫面目前套用的設計師篩選名稱；空陣列＝全部設計師。
  designerNames: string[];
  totals: ReportTotals;
  ranking: RankingRow[];
  trend: TrendBucket[];
  exportedAt: Date;
};

export const EXPORT_ERROR_MESSAGE = "匯出失敗，請稍後再試。";

const ALL_DESIGNERS_LABEL = "全部設計師";
const FILE_EXTENSION = ".xlsx";
const MAX_FILE_NAME_LENGTH = 80;
const MONEY_FORMAT = "#,##0";

type ExportSheet = Sheet<Blob>;
type ExportCell = NonNullable<ExportSheet["data"][number][number]>;

function text(value: string, bold = false): ExportCell {
  return bold ? { value, type: String, fontWeight: "bold" } : { value, type: String };
}

function count(value: number, bold = false): ExportCell {
  return bold ? { value, type: Number, fontWeight: "bold" } : { value, type: Number };
}

function money(value: number, bold = false): ExportCell {
  return bold ? { value, type: Number, format: MONEY_FORMAT, fontWeight: "bold" } : { value, type: Number, format: MONEY_FORMAT };
}

const TAIPEI_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// "2026-10-25 14:30"（台北）。
function formatTaipeiDateTime(date: Date): string {
  const parts = Object.fromEntries(TAIPEI_DATE_TIME.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// 沒有任何預約（含已取消）就沒有東西可匯出；畫面上對應的是空狀態，按鈕也會停用。
export function hasExportableData(totals: ReportTotals): boolean {
  return totals.booked > 0 || totals.cancelled > 0;
}

export function buildExportSheets(data: ReportExportData): ExportSheet[] {
  if (!hasExportableData(data.totals)) throw new Error("沒有可匯出的資料");

  const { period, totals, ranking, trend } = data;
  const designerLabel = data.designerNames.length === 0 ? ALL_DESIGNERS_LABEL : data.designerNames.join("、");

  const summary: ExportSheet = {
    sheet: "彙總",
    columns: [{ width: 22 }, { width: 36 }],
    data: [
      [text("期間", true), text(period.label)],
      [text("日期範圍", true), text(period.from === period.to ? period.from : `${period.from} ~ ${period.to}`)],
      [text("設計師", true), text(designerLabel)],
      [text("匯出時間（台北）", true), text(formatTaipeiDateTime(data.exportedAt))],
      [text("預約量", true), count(totals.booked)],
      [text("已完成", true), count(totals.completed)],
      [text("待完成", true), count(totals.pending)],
      [text("已取消", true), count(totals.cancelled)],
      [text("營收（已完成）", true), money(totals.revenue)],
      [text("預估營收（待完成）", true), money(totals.estimated)],
      [text("口徑說明", true), text("統計日期以預約開始時間換算為台北時間的日期。")],
      [null, text("預約量＝待完成＋已完成，已取消不計入。")],
      [null, text("營收＝已完成預約的下單價格加總；預估營收＝待完成預約的下單價格加總。")],
    ],
  };

  const rankingSheet: ExportSheet = {
    sheet: "熱門服務排行",
    columns: [{ width: 8 }, { width: 28 }, { width: 12 }, { width: 12 }, { width: 14 }],
    data: [
      [text("名次", true), text("服務", true), text("是否已下架", true), text("預約量", true), text("營收", true)],
      ...ranking.map((row, index): ExportCell[] => [
        count(index + 1),
        text(row.name),
        text(row.isActive ? "否" : "是"),
        count(row.count),
        money(row.revenue),
      ]),
    ],
  };

  const detailSheet: ExportSheet = {
    sheet: period.granularity === "day" ? "逐小時明細" : "逐日明細",
    columns: [{ width: 16 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 14 }],
    data: [
      [
        text(period.granularity === "day" ? "時段" : "日期", true),
        text("預約量", true),
        text("已完成", true),
        text("待完成", true),
        text("已取消", true),
        text("營收", true),
        text("預估營收", true),
      ],
      ...trend.map((bucket): ExportCell[] => [
        text(bucket.label),
        count(bucket.booked),
        count(bucket.completed),
        count(bucket.pending),
        count(bucket.cancelled),
        money(bucket.revenue),
        money(bucket.estimated),
      ]),
      // 合計直接取畫面的彙總結果（summarize），不是把各列再加一次。
      [
        text("合計", true),
        count(totals.booked, true),
        count(totals.completed, true),
        count(totals.pending, true),
        count(totals.cancelled, true),
        money(totals.revenue, true),
        money(totals.estimated, true),
      ],
    ],
  };

  return [summary, rankingSheet, detailSheet];
}

// ---- 檔名 ----

// 路徑分隔符與 Windows 保留字元、控制字元（Cc，含 DEL 與 C1）、格式字元（Cf：RLO 等雙向控制、零寬字元、BOM）、
// 行／段分隔符（Zl／Zp）。
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

// 先移除不安全字元、再處理連續的點：順序不能反，否則 "./." 會在中間字元被刪掉後重新接成 ".."。
function sanitizeFileNamePart(value: string): string {
  return value
    .normalize("NFC")
    .replace(UNSAFE_FILE_NAME_CHARS, "")
    .replace(/\.{2,}/g, "")
    .trim();
}

// 以字元（code point）截斷，不會把代理對（surrogate pair）切成一半。
function truncate(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function periodFileLabel(period: Pick<ReportPeriod, "granularity" | "from" | "to">): string {
  if (period.granularity === "month") return period.from.slice(0, 7);
  if (period.granularity === "week") return `${period.from}_${period.to}`;
  return period.from;
}

// 報表_<期間>_<設計師>.xlsx；整個檔名不超過 80 字元，設計師部分清理後為空則回退為「全部設計師」。
export function buildExportFileName(
  period: Pick<ReportPeriod, "granularity" | "from" | "to">,
  designerNames: string[],
): string {
  const prefix = `報表_${periodFileLabel(period)}_`;
  const budget = MAX_FILE_NAME_LENGTH - Array.from(prefix).length - FILE_EXTENSION.length;

  const joined = designerNames.map(sanitizeFileNamePart).filter(Boolean).join("_");
  // 截斷後再去掉結尾的點與空白（否則可能與 ".xlsx" 接成 ".."）。
  const designerPart = truncate(joined, budget).replace(/[.\s]+$/u, "") || ALL_DESIGNERS_LABEL;
  return `${prefix}${designerPart}${FILE_EXTENSION}`;
}

// ---- 下載 ----

// 動態載入套件 → 產生 Blob → 暫時的 <a download> 觸發下載。回傳實際下載的檔名。
// 失敗一律丟出泛用錯誤（不把套件或瀏覽器的細節訊息帶給使用者）。
export async function exportReportXlsx(data: ReportExportData): Promise<string> {
  try {
    const sheets = buildExportSheets(data);
    const fileName = buildExportFileName(data.period, data.designerNames);

    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const blob = await writeXlsxFile(sheets).toBlob();

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 稍後再釋放：部分瀏覽器在 click 後立刻 revoke 會讓下載失敗。
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return fileName;
  } catch {
    throw new Error(EXPORT_ERROR_MESSAGE);
  }
}
