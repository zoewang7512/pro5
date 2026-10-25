import { afterEach, describe, expect, it, vi } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import {
  buildExportFileName,
  buildExportSheets,
  exportReportXlsx,
  hasExportableData,
  type ReportExportData,
} from "@/lib/admin/reports-export";
import {
  buildTrend,
  getReportPeriod,
  summarize,
  type ReportAppointment,
  type ReportGranularity,
} from "@/lib/admin/reports";
import { buildServiceRanking } from "@/lib/admin/reports-ranking";

const TODAY = "2026-10-24";

let seq = 0;
function appt(overrides: Partial<ReportAppointment> = {}): ReportAppointment {
  seq += 1;
  return {
    id: `a${seq}`,
    // 2026-10-20 10:00（台北）
    startAt: "2026-10-20T02:00:00.000Z",
    status: "completed",
    price: 1000,
    serviceId: "s-cut",
    serviceName: "剪髮",
    serviceIsActive: true,
    designerId: "d-mei",
    ...overrides,
  };
}

// 顧客欄位刻意塞進輸入物件：匯出管線（summarize／buildTrend／buildServiceRanking）不該把它們帶出來。
const PII = { customer_name: "王小明", customer_phone: "0912345678", customer_email: "wang.xiaoming@example.com" };

function sampleAppointments(): ReportAppointment[] {
  return [
    appt({ ...PII } as Partial<ReportAppointment>),
    appt({ status: "confirmed", price: 500, serviceId: "s-dye", serviceName: "染髮", startAt: "2026-10-21T06:30:00.000Z", ...PII } as Partial<ReportAppointment>),
    appt({ status: "completed", price: 2000.5, serviceId: "s-dye", serviceName: "染髮", startAt: "2026-10-22T02:00:00.000Z" }),
    appt({ status: "cancelled", price: 800, serviceId: "s-old", serviceName: "舊服務", serviceIsActive: false, startAt: "2026-10-23T02:00:00.000Z" }),
  ];
}

function makeData(
  granularity: ReportGranularity,
  anchor: string,
  appointments: ReportAppointment[] = sampleAppointments(),
  designerNames: string[] = [],
): ReportExportData {
  const period = getReportPeriod(granularity, anchor, TODAY);
  return {
    period,
    designerNames,
    totals: summarize(appointments),
    ranking: buildServiceRanking(appointments),
    trend: buildTrend(period, appointments),
    // 2026-10-25 06:30 UTC＝台北 14:30
    exportedAt: new Date("2026-10-25T06:30:00.000Z"),
  };
}

type Cell = { value?: unknown; type?: unknown; format?: string; fontWeight?: string } | null;

function rowsOf(sheet: { data: unknown[][] }): Cell[][] {
  return sheet.data as Cell[][];
}

function values(sheet: { data: unknown[][] }): unknown[][] {
  return rowsOf(sheet).map((row) => row.map((cell) => cell?.value ?? null));
}

describe("buildExportSheets", () => {
  it("月粒度：三個工作表、名稱與表頭正確", () => {
    const sheets = buildExportSheets(makeData("month", "2026-10-24"));

    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["彙總", "熱門服務排行", "逐日明細"]);
    expect(values(sheets[1])[0]).toEqual(["名次", "服務", "是否已下架", "預約量", "營收"]);
    expect(values(sheets[2])[0]).toEqual(["日期", "預約量", "已完成", "待完成", "已取消", "營收", "預估營收"]);
  });

  it("彙總：期間、設計師、匯出時間（台北）與六個數字", () => {
    const sheets = buildExportSheets(makeData("month", "2026-10-24"));
    const summary = Object.fromEntries(values(sheets[0]).filter((row) => row[0]).map((row) => [row[0], row[1]]));

    expect(summary["期間"]).toBe("2026 年 10 月");
    expect(summary["日期範圍"]).toBe("2026-10-01 ~ 2026-10-31");
    expect(summary["設計師"]).toBe("全部設計師");
    expect(summary["匯出時間（台北）"]).toBe("2026-10-25 14:30");
    expect(summary["預約量"]).toBe(3);
    expect(summary["已完成"]).toBe(2);
    expect(summary["待完成"]).toBe(1);
    expect(summary["已取消"]).toBe(1);
    expect(summary["營收（已完成）"]).toBe(3000.5);
    expect(summary["預估營收（待完成）"]).toBe(500);
    expect(summary["口徑說明"]).toEqual(expect.any(String));
  });

  it("彙總：選了設計師就列出名稱", () => {
    const sheets = buildExportSheets(makeData("month", "2026-10-24", sampleAppointments(), ["林小美", "陳阿傑"]));
    const row = values(sheets[0]).find((r) => r[0] === "設計師");
    expect(row?.[1]).toBe("林小美、陳阿傑");
  });

  it("數值儲存格：筆數與金額是 Number 型別，金額帶 #,##0 格式；文字是 String 型別", () => {
    const sheets = buildExportSheets(makeData("month", "2026-10-24"));
    const summaryRows = rowsOf(sheets[0]);
    const find = (label: string) => summaryRows.find((row) => row[0]?.value === label)!;

    expect(find("預約量")[1]).toMatchObject({ value: 3, type: Number });
    expect(find("預約量")[1]?.format).toBeUndefined();
    expect(find("營收（已完成）")[1]).toMatchObject({ value: 3000.5, type: Number, format: "#,##0" });
    expect(find("期間")[1]?.type).toBe(String);

    const rankingRows = rowsOf(sheets[1]).slice(1);
    for (const row of rankingRows) {
      expect(row[0]?.type).toBe(Number);
      expect(row[1]?.type).toBe(String);
      expect(row[2]?.type).toBe(String);
      expect(row[3]?.type).toBe(Number);
      expect(row[4]).toMatchObject({ type: Number, format: "#,##0" });
    }
  });

  it("排行：全部有預約的服務、依畫面順序、已下架標示；取消的服務不列", () => {
    const sheets = buildExportSheets(makeData("month", "2026-10-24"));
    expect(values(sheets[1]).slice(1)).toEqual([
      [1, "染髮", "否", 2, 2000.5],
      [2, "剪髮", "否", 1, 1000],
    ]);

    const withInactive = buildExportSheets(
      makeData("month", "2026-10-24", [appt({ serviceId: "s-old", serviceName: "舊服務", serviceIsActive: false })]),
    );
    expect(values(withInactive[1]).slice(1)).toEqual([[1, "舊服務", "是", 1, 1000]]);
  });

  it("月粒度明細：每天一列，最後是合計且與彙總一致", () => {
    const data = makeData("month", "2026-10-24");
    const detail = values(buildExportSheets(data)[2]);

    // 表頭 + 31 天 + 合計
    expect(detail).toHaveLength(1 + 31 + 1);
    expect(detail[1][0]).toBe(data.trend[0].label);
    const total = detail[detail.length - 1];
    expect(total).toEqual(["合計", 3, 2, 1, 1, 3000.5, 500]);

    // 各列加總＝合計（欄位內容與畫面一致）。
    const body = detail.slice(1, -1);
    for (let col = 1; col <= 6; col += 1) {
      const sum = body.reduce((acc, row) => acc + (row[col] as number), 0);
      expect(sum).toBe(total[col]);
    }
  });

  it("週粒度明細：七天一列", () => {
    const detail = values(buildExportSheets(makeData("week", "2026-10-21"))[2]);
    expect(detail).toHaveLength(1 + 7 + 1);
    expect(detail[0][0]).toBe("日期");
    expect(detail[detail.length - 1][0]).toBe("合計");
  });

  it("日粒度：工作表改名「逐小時明細」、首欄為「時段」，日期範圍只顯示一天", () => {
    const sheets = buildExportSheets(makeData("day", "2026-10-20"));
    expect(sheets[2].sheet).toBe("逐小時明細");

    const detail = values(sheets[2]);
    expect(detail[0][0]).toBe("時段");
    expect(detail[1][0]).toBe("10:00");
    // 2026-10-20 的預約只有 10:00 那一筆（完成 1000）。
    const tenOClock = detail.find((row) => row[0] === "10:00")!;
    expect(tenOClock).toEqual(["10:00", 1, 1, 0, 0, 1000, 0]);

    const range = values(sheets[0]).find((row) => row[0] === "日期範圍");
    expect(range?.[1]).toBe("2026-10-20");
  });

  it("全部已取消仍可匯出（有資料）；完全沒資料則拒絕", () => {
    const cancelledOnly = makeData("month", "2026-10-24", [appt({ status: "cancelled" })]);
    expect(hasExportableData(cancelledOnly.totals)).toBe(true);
    expect(() => buildExportSheets(cancelledOnly)).not.toThrow();

    const empty = makeData("month", "2026-10-24", []);
    expect(hasExportableData(empty.totals)).toBe(false);
    expect(() => buildExportSheets(empty)).toThrow();
  });
});

describe("buildExportFileName", () => {
  const month = { granularity: "month", from: "2026-10-01", to: "2026-10-31" } as const;
  const week = { granularity: "week", from: "2026-10-19", to: "2026-10-25" } as const;
  const day = { granularity: "day", from: "2026-10-24", to: "2026-10-24" } as const;

  it("三種粒度的期間標記", () => {
    expect(buildExportFileName(month, [])).toBe("報表_2026-10_全部設計師.xlsx");
    expect(buildExportFileName(week, [])).toBe("報表_2026-10-19_2026-10-25_全部設計師.xlsx");
    expect(buildExportFileName(day, [])).toBe("報表_2026-10-24_全部設計師.xlsx");
  });

  it("所選設計師以底線連接", () => {
    expect(buildExportFileName(month, ["林小美", "陳阿傑"])).toBe("報表_2026-10_林小美_陳阿傑.xlsx");
  });

  it("移除路徑字元與 Windows 保留字元", () => {
    expect(buildExportFileName(month, ['a/b\\c:d*e?f"g<h>i|j'])).toBe("報表_2026-10_abcdefghij.xlsx");
  });

  it("移除控制字元與前後空白", () => {
    expect(buildExportFileName(month, ["  \u0000林\t小\u001f美\u007f \n"])).toBe("報表_2026-10_林小美.xlsx");
  });

  it("「..」不會出現在檔名中", () => {
    const name = buildExportFileName(month, ["../../etc/passwd", ".."]);
    expect(name).not.toContain("..");
    expect(name).not.toMatch(/[\\/]/);
    expect(name).toBe("報表_2026-10_etcpasswd.xlsx");
  });

  it("清理後重新接起來的點也會處理：./.、a.、結尾的點", () => {
    expect(buildExportFileName(month, ["./."])).toBe("報表_2026-10_全部設計師.xlsx");
    expect(buildExportFileName(month, [".\u0000."])).toBe("報表_2026-10_全部設計師.xlsx");
    expect(buildExportFileName(month, ["a."])).toBe("報表_2026-10_a.xlsx");
    expect(buildExportFileName(month, ["a. "])).toBe("報表_2026-10_a.xlsx");
  });

  it("移除雙向控制與零寬等格式字元（RLO、BOM、零寬空白）與行段分隔符", () => {
    expect(buildExportFileName(month, ["‮gpj."])).toBe("報表_2026-10_gpj.xlsx");
    expect(buildExportFileName(month, ["a​b﻿c⁦d⁩e f\u0085g"])).toBe("報表_2026-10_abcdefg.xlsx");
  });

  it("任何輸入都不會產生 .. 或結尾點", () => {
    for (const input of ["./.", ".:.", "a..b", "...", "x.", "‮..", "a/../b"]) {
      const name = buildExportFileName(month, [input]);
      expect(name, input).not.toContain("..");
      expect(name, input).toMatch(/[^.]\.xlsx$/);
    }
  });

  it("清理後為空則回退為全部設計師", () => {
    expect(buildExportFileName(month, ["///", "  ", ".."])).toBe("報表_2026-10_全部設計師.xlsx");
  });

  it("總長不超過 80 字元，且不切壞代理對", () => {
    const long = buildExportFileName(month, ["設".repeat(200)]);
    expect(Array.from(long).length).toBeLessThanOrEqual(80);
    expect(long.endsWith(".xlsx")).toBe(true);

    const emoji = buildExportFileName(month, ["😀".repeat(200)]);
    expect(Array.from(emoji).length).toBeLessThanOrEqual(80);
    // 沒有落單的代理對。
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });
});

describe("實際產生的 xlsx（讀回）", () => {
  const INJECTION_NAMES = ["=SUM(1)", "+1", "-1", "@x", "\t開頭是 Tab"];

  async function generate(data: ReportExportData) {
    // 節點版與瀏覽器版共用同一份工作表定義與產生邏輯；這裡只換輸出方式（toBuffer）。
    const buffer = await writeXlsxFile(buildExportSheets(data) as never).toBuffer();
    return unzipSync(new Uint8Array(buffer));
  }

  function injectionData() {
    const appointments = INJECTION_NAMES.map((name, index) =>
      appt({
        serviceId: `s-${index}`,
        serviceName: name,
        status: "completed",
        price: 100 * (index + 1),
        ...PII,
      } as Partial<ReportAppointment>),
    );
    return makeData("month", "2026-10-24", appointments, INJECTION_NAMES);
  }

  it("工作表 XML 不含任何公式（<f>）", async () => {
    const files = await generate(injectionData());
    const sheetFiles = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    expect(sheetFiles).toHaveLength(3);
    for (const name of sheetFiles) {
      expect(strFromU8(files[name])).not.toMatch(/<f[ >]/);
    }
  });

  it("筆數與金額是數值儲存格（有 <v>、不是字串型別 t=\"s\"）", async () => {
    const files = await generate(makeData("month", "2026-10-24"));
    const summaryXml = strFromU8(files["xl/worksheets/sheet1.xml"]);

    // 彙總表第 5～10 列的 B 欄：預約量、已完成、待完成、已取消、營收、預估營收。
    for (const [row, expected] of [[5, "3"], [6, "2"], [7, "1"], [8, "1"], [9, "3000.5"], [10, "500"]] as const) {
      const match = summaryXml.match(new RegExp(`<c r="B${row}"([^>]*)><v>([^<]*)</v></c>`));
      expect(match, `B${row}`).not.toBeNull();
      expect(match![1]).not.toMatch(/t="/);
      expect(match![2]).toBe(expected);
    }
  });

  it("以 =、+、-、@、Tab 開頭的名稱是字串型別，內容原樣", async () => {
    const files = await generate(injectionData());
    const sharedStrings = strFromU8(files["xl/sharedStrings.xml"]);
    const sheet2 = strFromU8(files["xl/worksheets/sheet2.xml"]);

    for (const name of INJECTION_NAMES) {
      expect(sharedStrings).toContain(`>${name}</t>`);
    }

    // 排行表的「服務」欄（B2～B6）全部是 t="s"（共用字串）。
    for (let row = 2; row <= 1 + INJECTION_NAMES.length; row += 1) {
      expect(sheet2).toMatch(new RegExp(`<c r="B${row}"[^>]*t="s"`));
    }
  });

  it("解開後所有檔案都不含顧客姓名、電話、email", async () => {
    const files = await generate(injectionData());
    const everything = Object.values(files).map((bytes) => strFromU8(bytes)).join("\n");

    for (const pii of Object.values(PII)) {
      expect(everything).not.toContain(pii);
    }
  });
});

describe("exportReportXlsx", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("沒有資料時拒絕，且泛用錯誤訊息", async () => {
    await expect(exportReportXlsx(makeData("month", "2026-10-24", []))).rejects.toThrow("匯出失敗，請稍後再試。");
  });
});
