// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportReportXlsx, type ReportExportData } from "@/lib/admin/reports-export";
import { buildTrend, getReportPeriod, summarize, type ReportAppointment } from "@/lib/admin/reports";
import { buildServiceRanking } from "@/lib/admin/reports-ranking";

// 只換掉套件的瀏覽器入口，驗證下載實作（Blob、objectURL、anchor、revoke、錯誤處理）。
// xlsx 內容本身由 reports-export.test.ts 以 node 入口讀回驗證；兩個入口共用同一個產生邏輯。
const toBlob = vi.fn();
const writeXlsxFile = vi.fn(() => ({ toBlob }));
vi.mock("write-excel-file/browser", () => ({ default: writeXlsxFile }));

function data(): ReportExportData {
  const appointments: ReportAppointment[] = [
    {
      id: "a1",
      startAt: "2026-10-20T02:00:00.000Z",
      status: "completed",
      price: 1000,
      serviceId: "s-cut",
      serviceName: "剪髮",
      serviceIsActive: true,
      designerId: "d-mei",
    },
  ];
  const period = getReportPeriod("month", "2026-10-24", "2026-10-24");
  return {
    period,
    designerNames: ["林小美"],
    totals: summarize(appointments),
    ranking: buildServiceRanking(appointments),
    trend: buildTrend(period, appointments),
    exportedAt: new Date("2026-10-25T06:30:00.000Z"),
  };
}

describe("exportReportXlsx 下載", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clicked: { download: string; href: string; inDom: boolean }[];

  beforeEach(() => {
    vi.useFakeTimers();
    clicked = [];
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    // jsdom 的 anchor.click() 不會真的導覽；記錄被點的 anchor 狀態。
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, inDom: document.body.contains(this) });
    });
    toBlob.mockResolvedValue(new Blob(["x"]));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    toBlob.mockReset();
    writeXlsxFile.mockClear();
  });

  it("產生 Blob → 以回傳的檔名點擊暫時的 anchor → anchor 移除 → 1 秒後才 revoke", async () => {
    const fileName = await exportReportXlsx(data());

    expect(fileName).toBe("報表_2026-10_林小美.xlsx");
    expect(writeXlsxFile).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    expect(clicked).toEqual([{ download: fileName, href: "blob:mock-url", inDom: true }]);
    expect(document.querySelector("a[download]")).toBeNull();

    vi.advanceTimersByTime(999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("套件拋出含細節的錯誤時，只對外丟泛用訊息，且沒有下載動作", async () => {
    toBlob.mockRejectedValue(new Error("internal detail: secret path C:\\x"));

    await expect(exportReportXlsx(data())).rejects.toThrow(/^匯出失敗，請稍後再試。$/);
    expect(clicked).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("套件載入階段以外的失敗（createObjectURL 拋錯）同樣只丟泛用訊息", async () => {
    createObjectURL.mockImplementation(() => {
      throw new Error("quota exceeded: internal");
    });

    await expect(exportReportXlsx(data())).rejects.toThrow(/^匯出失敗，請稍後再試。$/);
    expect(clicked).toEqual([]);
  });
});
