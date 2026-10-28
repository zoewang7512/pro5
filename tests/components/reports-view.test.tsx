// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { renderWithTheme } from "../test-utils";
import { ReportsView } from "@/app/admin/_components/ReportsView";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { getDesignerFilterOptions, type DesignerFilterOption } from "@/lib/admin/designers";
import { fetchReportAppointments, type ReportAppointment } from "@/lib/admin/reports";
import { exportReportXlsx } from "@/lib/admin/reports-export";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

// 固定「台北今天」＝2026-10-24（六），本週＝10/19（一）– 10/25（日）。
vi.mock("@/lib/admin/week-range", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/week-range")>()),
  getTaipeiToday: () => "2026-10-24",
}));

// 只替換資料讀取；期間運算、彙總、趨勢、篩選、排行都用真的，才測得到實際顯示的數字。
vi.mock("@/lib/admin/reports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/reports")>()),
  fetchReportAppointments: vi.fn(),
}));

// 匯出只替換下載動作；建構工作表與檔名有自己的單元測試（tests/admin/reports-export.test.ts）。
vi.mock("@/lib/admin/reports-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/reports-export")>()),
  exportReportXlsx: vi.fn(),
}));

vi.mock("@/lib/admin/designers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/designers")>()),
  getDesignerFilterOptions: vi.fn(),
}));

// 每個案例都完整渲染兩張月視圖圖表（62 根長條）與面板，點幾下就逼近預設 5 秒；機器忙碌時會誤報逾時。
vi.setConfig({ testTimeout: 30000 });

const mockFetch = vi.mocked(fetchReportAppointments);
const mockDesigners = vi.mocked(getDesignerFilterOptions);
const mockExport = vi.mocked(exportReportXlsx);

// ReportsView 用 useToast（匯出結果提示）；正式環境由 ThemeRegistry 提供 ToastProvider。
function render(ui: React.ReactElement) {
  return renderWithTheme(<ToastProvider>{ui}</ToastProvider>);
}

const MEI: DesignerFilterOption = { id: "d-mei", name: "林小美", avatar_url: null, is_active: true, sort_order: 1 };
const JIE: DesignerFilterOption = { id: "d-jie", name: "陳阿傑", avatar_url: null, is_active: true, sort_order: 2 };

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
    designerId: MEI.id,
    ...overrides,
  };
}

// 林小美：完成 1000 + 待完成 500（染髮）；陳阿傑：完成 2000（染髮）、取消 1 筆。
// 全部：預約量 3、營收 3000、預估 500、已取消 1。
function monthData(): ReportAppointment[] {
  return [
    appt({ status: "completed", price: 1000 }),
    appt({ status: "confirmed", price: 500, serviceId: "s-dye", serviceName: "染髮", startAt: "2026-10-26T02:00:00.000Z" }),
    appt({ status: "completed", price: 2000, serviceId: "s-dye", serviceName: "染髮", designerId: JIE.id, startAt: "2026-10-22T02:00:00.000Z" }),
    appt({ status: "cancelled", price: 800, designerId: JIE.id, startAt: "2026-10-23T02:00:00.000Z" }),
  ];
}

function ok(data: ReportAppointment[]) {
  return { ok: true as const, data };
}

const failed = { ok: false as const, error: { message: "發生未預期的錯誤，請稍後再試。" } };
const tooMany = { ok: false as const, error: { message: "此期間的預約筆數超過上限。", code: "too_many_rows" as const } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function lastPeriod() {
  return mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1];
}

// 儀表板頁籤的營收主數字（TASK-090 的 data-testid）。
function revenueMain() {
  return screen.getByTestId("revenue-main").textContent;
}

describe("ReportsView", () => {
  beforeEach(() => {
    mockDesigners.mockResolvedValue({ ok: true, data: [MEI, JIE] });
    mockFetch.mockResolvedValue(ok(monthData()));
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  describe("預設與查詢", () => {
    it("預設進入儀表板、月視圖、本月，查詢本月第一天到最後一天", async () => {
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      expect(screen.getByRole("heading", { level: 2, name: "儀表板與報表" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "儀表板" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("button", { name: "月" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("2026 年 10 月")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(lastPeriod()).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    });

    it("顯示彙總：營收＝已完成、預估＝待完成、已取消不計入預約量", async () => {
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      expect(revenueMain()).toBe("NT$3,000");
      expect(screen.getByText("營收（已完成 2 筆）")).toBeInTheDocument();
      expect(screen.getByText("預估營收").nextElementSibling).toHaveTextContent("NT$500");
      expect(screen.getByText("預約量").nextElementSibling).toHaveTextContent("3 筆");
      expect(screen.getByText("已取消").nextElementSibling).toHaveTextContent("1 筆");
    });

    it("排行吃同一份資料：染髮 2 筆在前、剪髮 1 筆在後（取消不計入）", async () => {
      render(<ReportsView />);
      const ranking = await screen.findByRole("list", { name: "熱門服務排行" });
      const items = within(ranking).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("染髮");
      expect(items[0]).toHaveTextContent("2 筆");
      expect(items[1]).toHaveTextContent("剪髮");
      expect(items[1]).toHaveTextContent("1 筆");
    });

    it("不把查詢結果以外的資料傳給元件：設計師查詢只做一次", async () => {
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");
      expect(mockDesigners).toHaveBeenCalledTimes(1);
    });
  });

  describe("只有期間改變才重新查詢", () => {
    it("切到「報表」頁籤不重新查詢，且期間與數字保持", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      await user.click(screen.getByRole("tab", { name: "報表" }));

      expect(await screen.findByRole("table", { name: "逐日明細" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "報表" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("2026 年 10 月")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("勾選設計師不重新查詢，彙總、排行與 chip 數字依設計師重算", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      await user.click(screen.getByRole("button", { name: /陳阿傑/ }));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(revenueMain()).toBe("NT$2,000");
      const items = within(screen.getByRole("list", { name: "熱門服務排行" })).getAllByRole("listitem");
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent("染髮");
      // 篩選不改變 chip 的數字（仍是期間內各設計師的預約量，不含取消）。
      expect(screen.getByRole("button", { name: /全部 · 3/ })).toBeInTheDocument();
    });

    it("切換粒度與上一期／下一期、回到本期都重新查詢", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      await user.click(screen.getByRole("button", { name: "下一個月" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      expect(lastPeriod()).toEqual({ from: "2026-11-01", to: "2026-11-30" });
      expect(await screen.findByText("2026 年 11 月")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "上一個月" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
      expect(lastPeriod()).toEqual({ from: "2026-10-01", to: "2026-10-31" });

      await user.click(screen.getByRole("button", { name: "上一個月" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
      expect(lastPeriod()).toEqual({ from: "2026-09-01", to: "2026-09-30" });

      await user.click(screen.getByRole("button", { name: "回到本期" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(5));
      expect(lastPeriod()).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    });

    it("本期切到週、日：以今天所在的週／日查詢；非本期則以該期間起始日為錨", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      await user.click(screen.getByRole("button", { name: "週" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      expect(lastPeriod()).toEqual({ from: "2026-10-19", to: "2026-10-25" });
      expect(await screen.findByText("10/19（一） – 10/25（日）")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "日" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
      expect(lastPeriod()).toEqual({ from: "2026-10-24", to: "2026-10-24" });
      expect(await screen.findByText("10/24（六）")).toBeInTheDocument();

      // 非本期：下個月（11 月）切到週，以 11/1 所在的週（跨月的 10/26–11/1）。
      await user.click(screen.getByRole("button", { name: "月" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
      await user.click(screen.getByRole("button", { name: "下一個月" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(5));
      expect(lastPeriod()).toEqual({ from: "2026-11-01", to: "2026-11-30" });
      await user.click(screen.getByRole("button", { name: "週" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(6));
      expect(lastPeriod()).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    });

    it("切換期間時保留設計師勾選", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      await user.click(screen.getByRole("button", { name: /陳阿傑/ }));
      await user.click(screen.getByRole("button", { name: "下一個月" }));
      await screen.findByText("2026 年 11 月");

      await waitFor(() => expect(screen.getByRole("button", { name: /陳阿傑/ })).toHaveAttribute("aria-pressed", "true"));
      expect(screen.getByRole("button", { name: "清除篩選" })).toBeInTheDocument();
    });
  });

  describe("設計師 chip", () => {
    it("「全部 · N」與各設計師的數字＝期間內預約量（不含已取消）", async () => {
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      expect(screen.getByRole("button", { name: /全部 · 3/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /林小美/ })).toHaveTextContent("2");
      expect(screen.getByRole("button", { name: /陳阿傑/ })).toHaveTextContent("1");
    });

    it("勾選後出現「清除篩選」，按下回到全部並恢復數字", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");
      expect(screen.queryByRole("button", { name: "清除篩選" })).toBeNull();

      await user.click(screen.getByRole("button", { name: /林小美/ }));
      expect(screen.getByRole("button", { name: /林小美/ })).toHaveAttribute("aria-pressed", "true");
      expect(revenueMain()).toBe("NT$1,000");

      await user.click(screen.getByRole("button", { name: "清除篩選" }));
      expect(screen.queryByRole("button", { name: "清除篩選" })).toBeNull();
      expect(screen.getByRole("button", { name: /全部 · 3/ })).toHaveAttribute("aria-pressed", "true");
      expect(revenueMain()).toBe("NT$3,000");
    });

    it("多選：勾兩位等於全部的數字，再取消一位回到單一設計師", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      await user.click(screen.getByRole("button", { name: /林小美/ }));
      await user.click(screen.getByRole("button", { name: /陳阿傑/ }));
      expect(revenueMain()).toBe("NT$3,000");

      await user.click(screen.getByRole("button", { name: /林小美/ }));
      expect(revenueMain()).toBe("NT$2,000");
    });

    it("設計師清單載入失敗：不顯示 chip 列，報表照常顯示", async () => {
      mockDesigners.mockResolvedValue({ ok: false, error: { message: "x" } });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      expect(screen.queryByRole("group", { name: "設計師篩選" })).toBeNull();
      expect(revenueMain()).toBe("NT$3,000");
    });

    it("停用中且期間內沒有預約的設計師不出現", async () => {
      const retired: DesignerFilterOption = { ...JIE, id: "d-old", name: "老設計師", is_active: false, sort_order: 3 };
      mockDesigners.mockResolvedValue({ ok: true, data: [MEI, JIE, retired] });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      expect(screen.queryByRole("button", { name: /老設計師/ })).toBeNull();
    });
  });

  describe("兩個頁籤的數字一致", () => {
    it("儀表板營收主數字與報表彙總列、明細合計相同；切設計師後兩邊同步", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");
      const dashboardRevenue = revenueMain();

      await user.click(screen.getByRole("tab", { name: "報表" }));
      const summary = await screen.findByTestId("summary-row");
      expect(within(summary).getByText("營收（已完成）").nextElementSibling).toHaveTextContent(dashboardRevenue!);
      const total = within(screen.getByRole("table", { name: "逐日明細" })).getByRole("row", { name: /合計/ });
      expect(total).toHaveTextContent(dashboardRevenue!);

      await user.click(screen.getByRole("button", { name: /陳阿傑/ }));
      expect(within(screen.getByTestId("summary-row")).getByText("營收（已完成）").nextElementSibling).toHaveTextContent("NT$2,000");

      await user.click(screen.getByRole("tab", { name: "儀表板" }));
      expect(revenueMain()).toBe("NT$2,000");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("報表頁籤的排行是表格，儀表板是橫條清單", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByRole("list", { name: "熱門服務排行" });

      await user.click(screen.getByRole("tab", { name: "報表" }));
      expect(await screen.findByRole("table", { name: "熱門服務排行" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "熱門服務排行" })).toBeNull();
    });
  });

  describe("空狀態", () => {
    it("期間內（全部設計師）沒有預約：顯示「此期間沒有預約」，工具列與 chip 維持", async () => {
      mockFetch.mockResolvedValue(ok([]));
      render(<ReportsView />);

      expect(await screen.findByText("此期間沒有預約")).toBeInTheDocument();
      expect(screen.getByText("換一個期間看看。")).toBeInTheDocument();
      expect(screen.queryByTestId("revenue-main")).toBeNull();
      expect(screen.getByRole("button", { name: "下一個月" })).toBeEnabled();
    });

    it("有勾選設計師、篩選後沒有預約：顯示另一種文案，清除篩選即恢復", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValue(ok([appt({ designerId: MEI.id })]));
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      await user.click(screen.getByRole("button", { name: /陳阿傑/ }));

      expect(screen.getByText("所選設計師在此期間沒有預約")).toBeInTheDocument();
      expect(screen.getByText("換一個期間，或清除設計師篩選看看。")).toBeInTheDocument();
      expect(screen.queryByText("此期間沒有預約")).toBeNull();

      await user.click(screen.getByRole("button", { name: "清除篩選" }));
      expect(screen.getByTestId("revenue-main")).toBeInTheDocument();
    });

    it("有預約但全部已取消：視為有資料，不顯示空狀態；排行顯示無被預約的服務", async () => {
      mockFetch.mockResolvedValue(
        ok([appt({ status: "cancelled" }), appt({ status: "cancelled", designerId: JIE.id })]),
      );
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      expect(screen.queryByText("此期間沒有預約")).toBeNull();
      expect(revenueMain()).toBe("NT$0");
      expect(screen.getByText("已取消").nextElementSibling).toHaveTextContent("2 筆");
      expect(screen.getByText("此期間沒有被預約的服務")).toBeInTheDocument();
    });
  });

  describe("載入中", () => {
    it("第一次載入：內容區骨架，不顯示數字或空狀態；設計師 chip 位置也是骨架", async () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      render(<ReportsView />);

      expect(await screen.findByRole("status", { name: "載入中" })).toBeInTheDocument();
      expect(screen.queryByTestId("revenue-main")).toBeNull();
      expect(screen.queryByText("此期間沒有預約")).toBeNull();
      expect(screen.getByRole("tab", { name: "報表" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "週" })).toBeEnabled();
    });

    it("切換期間的載入中：工具列與 chip 仍可操作，且不顯示舊期間的數字", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      const slow = deferred<ReturnType<typeof ok>>();
      mockFetch.mockReturnValue(slow.promise);
      await user.click(screen.getByRole("button", { name: "下一個月" }));

      expect(await screen.findByRole("status", { name: "載入中" })).toBeInTheDocument();
      expect(screen.queryByTestId("revenue-main")).toBeNull();
      expect(screen.queryByText("NT$3,000")).toBeNull();

      // 工具列與 chip 都還能點。
      expect(screen.getByRole("button", { name: "下一個月" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "回到本期" })).toBeEnabled();
      const chip = screen.getByRole("button", { name: /陳阿傑/ });
      await user.click(chip);
      expect(chip).toHaveAttribute("aria-pressed", "true");
      await user.click(screen.getByRole("button", { name: "週" }));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    });
  });

  describe("競態", () => {
    it("先慢後快的兩次請求只採用最新：慢的舊回應被丟棄", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      const slowNov = deferred<ReturnType<typeof ok>>();
      const fastDec = deferred<ReturnType<typeof ok>>();
      mockFetch.mockReturnValueOnce(slowNov.promise).mockReturnValueOnce(fastDec.promise);

      await user.click(screen.getByRole("button", { name: "下一個月" })); // 11 月（慢）
      await user.click(screen.getByRole("button", { name: "下一個月" })); // 12 月（快）
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
      expect(lastPeriod()).toEqual({ from: "2026-12-01", to: "2026-12-31" });

      fastDec.resolve(ok([appt({ price: 7777, startAt: "2026-12-05T02:00:00.000Z" })]));
      await waitFor(() => expect(revenueMain()).toBe("NT$7,777"));

      // 11 月的回應較晚到，不能蓋掉 12 月。
      slowNov.resolve(ok([appt({ price: 1111, startAt: "2026-11-05T02:00:00.000Z" })]));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByText("2026 年 12 月")).toBeInTheDocument();
      expect(revenueMain()).toBe("NT$7,777");
      expect(screen.queryByText("NT$1,111")).toBeNull();
    });

    it("舊的失敗回應也不能蓋掉新期間的資料", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");

      const slowFail = deferred<typeof failed>();
      mockFetch.mockReturnValueOnce(slowFail.promise).mockResolvedValueOnce(ok([appt({ price: 4242 })]));

      await user.click(screen.getByRole("button", { name: "下一個月" }));
      await user.click(screen.getByRole("button", { name: "下一個月" }));
      await waitFor(() => expect(revenueMain()).toBe("NT$4,242"));

      slowFail.resolve(failed);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(revenueMain()).toBe("NT$4,242");
      expect(screen.queryByText("無法載入報表，請稍後再試。")).toBeNull();
    });
  });

  describe("錯誤與重試", () => {
    it("查詢失敗：顯示泛用訊息與重試，不顯示任何數字；工具列仍可操作", async () => {
      mockFetch.mockResolvedValue(failed);
      render(<ReportsView />);

      expect(await screen.findByText("無法載入報表，請稍後再試。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重試" })).toBeInTheDocument();
      expect(screen.queryByTestId("revenue-main")).toBeNull();
      expect(screen.queryByText(/NT\$/)).toBeNull();
      expect(screen.queryByText("發生未預期的錯誤，請稍後再試。")).toBeNull();
      expect(screen.getByRole("button", { name: "下一個月" })).toBeEnabled();
    });

    it("錯誤時隱藏設計師 chip 列（不顯示別的期間的數字），勾選保留，重試成功後回來", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");
      await user.click(screen.getByRole("button", { name: /陳阿傑/ }));

      mockFetch.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok(monthData()));
      await user.click(screen.getByRole("button", { name: "下一個月" }));
      await screen.findByText("無法載入報表，請稍後再試。");
      expect(screen.queryByRole("group", { name: "設計師篩選" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "重試" }));
      await screen.findByTestId("revenue-main");
      expect(screen.getByRole("button", { name: /陳阿傑/ })).toHaveAttribute("aria-pressed", "true");
      expect(revenueMain()).toBe("NT$2,000");
    });

    it("按「重試」以同一期間重新查詢，成功後顯示數字", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok(monthData()));
      render(<ReportsView />);
      await user.click(await screen.findByRole("button", { name: "重試" }));

      expect(await screen.findByTestId("revenue-main")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][1]).toEqual(mockFetch.mock.calls[0][1]);
      expect(screen.queryByText("無法載入報表，請稍後再試。")).toBeNull();
    });

    it("重試再失敗：回到錯誤狀態", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValue(failed);
      render(<ReportsView />);
      await user.click(await screen.findByRole("button", { name: "重試" }));

      expect(await screen.findByRole("button", { name: "重試" })).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("錯誤後切到別的期間：重新查詢並顯示新資料；報表頁籤同樣顯示錯誤", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok(monthData()));
      render(<ReportsView />);
      await screen.findByText("無法載入報表，請稍後再試。");

      await user.click(screen.getByRole("tab", { name: "報表" }));
      expect(screen.getByText("無法載入報表，請稍後再試。")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "上一個月" }));
      expect(await screen.findByTestId("summary-row")).toBeInTheDocument();
    });
  });

  describe("超過筆數上限", () => {
    it("顯示專用提示、沒有重試按鈕，也不顯示一般錯誤文案；兩個頁籤一致", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValue(tooMany);
      render(<ReportsView />);

      expect(await screen.findByText("此期間的預約筆數超過上限（5,000 筆）")).toBeInTheDocument();
      expect(screen.getByText("請改用較短的期間（日或週）。")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "重試" })).not.toBeInTheDocument();
      expect(screen.queryByText("無法載入報表，請稍後再試。")).not.toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "報表" }));
      expect(screen.getByText("此期間的預約筆數超過上限（5,000 筆）")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "重試" })).not.toBeInTheDocument();
      // 匯出沒有資料可匯出。
      expect(screen.getByRole("button", { name: "↓ 匯出 Excel（.xlsx）" })).toBeDisabled();
    });

    it("工具列仍可操作：改成週粒度後重新查詢並恢復顯示資料", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValueOnce(tooMany).mockResolvedValueOnce(ok(monthData()));
      render(<ReportsView />);
      await screen.findByText("此期間的預約筆數超過上限（5,000 筆）");

      await user.click(screen.getByRole("button", { name: "週" }));

      expect(await screen.findByTestId("revenue-main")).toBeInTheDocument();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(lastPeriod()).toEqual({ from: "2026-10-19", to: "2026-10-25" });
      expect(screen.queryByText("此期間的預約筆數超過上限（5,000 筆）")).not.toBeInTheDocument();
    });

    it("一般失敗仍是原本的錯誤文案與重試按鈕", async () => {
      mockFetch.mockResolvedValue(failed);
      render(<ReportsView />);

      expect(await screen.findByText("無法載入報表，請稍後再試。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "重試" })).toBeInTheDocument();
      expect(screen.queryByText(/超過上限/)).not.toBeInTheDocument();
    });
  });

  describe("匯出 Excel", () => {
    const EXPORT_NAME = "↓ 匯出 Excel（.xlsx）";

    beforeEach(() => {
      mockExport.mockResolvedValue("報表_2026-10_全部設計師.xlsx");
    });

    async function openTable(user: ReturnType<typeof userEvent.setup>) {
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");
      await user.click(screen.getByRole("tab", { name: "報表" }));
      await screen.findByTestId("summary-row");
    }

    it("只在報表頁籤出現，儀表板頁籤不顯示", async () => {
      const user = userEvent.setup({ delay: null });
      render(<ReportsView />);
      await screen.findByTestId("revenue-main");
      expect(screen.queryByRole("button", { name: EXPORT_NAME })).not.toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "報表" }));
      expect(await screen.findByRole("button", { name: EXPORT_NAME })).toBeEnabled();

      await user.click(screen.getByRole("tab", { name: "儀表板" }));
      expect(screen.queryByRole("button", { name: EXPORT_NAME })).not.toBeInTheDocument();
    });

    it("收到的內容與畫面一致：期間、設計師、彙總、排行、趨勢", async () => {
      const user = userEvent.setup({ delay: null });
      await openTable(user);

      await user.click(screen.getByRole("button", { name: EXPORT_NAME }));

      expect(mockExport).toHaveBeenCalledTimes(1);
      const data = mockExport.mock.calls[0][0];
      expect(data.period).toMatchObject({ granularity: "month", from: "2026-10-01", to: "2026-10-31" });
      expect(data.designerNames).toEqual([]);
      expect(data.totals).toEqual({ booked: 3, completed: 2, pending: 1, cancelled: 1, revenue: 3000, estimated: 500 });
      expect(data.ranking.map((row) => [row.name, row.count, row.revenue])).toEqual([
        ["染髮", 2, 2000],
        ["剪髮", 1, 1000],
      ]);
      expect(data.trend).toHaveLength(31);
      expect(data.exportedAt).toBeInstanceOf(Date);
      // 不為匯出新增任何查詢。
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("套用設計師篩選：匯出的是篩選後的數字與設計師名稱", async () => {
      const user = userEvent.setup({ delay: null });
      await openTable(user);
      await user.click(screen.getByRole("button", { name: /陳阿傑/ }));

      await user.click(screen.getByRole("button", { name: EXPORT_NAME }));

      const data = mockExport.mock.calls[0][0];
      expect(data.designerNames).toEqual(["陳阿傑"]);
      expect(data.totals).toMatchObject({ booked: 1, revenue: 2000, cancelled: 1 });
      expect(data.ranking.map((row) => row.name)).toEqual(["染髮"]);
    });

    it("匯出中：停用並顯示「匯出中…」，完成後恢復，顯示成功 Toast", async () => {
      const user = userEvent.setup({ delay: null });
      const pending = deferred<string>();
      mockExport.mockReturnValue(pending.promise);
      await openTable(user);

      await user.click(screen.getByRole("button", { name: EXPORT_NAME }));

      const busy = await screen.findByRole("button", { name: /匯出中…/ });
      expect(busy).toBeDisabled();
      expect(screen.queryByRole("button", { name: EXPORT_NAME })).not.toBeInTheDocument();

      pending.resolve("報表_2026-10_全部設計師.xlsx");
      expect(await screen.findByText("已匯出「報表_2026-10_全部設計師.xlsx」")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: EXPORT_NAME })).toBeEnabled();
    });

    it("連點只觸發一次", async () => {
      const user = userEvent.setup({ delay: null });
      const pending = deferred<string>();
      mockExport.mockReturnValue(pending.promise);
      await openTable(user);

      // 同一個 act 內連按兩次：React 還沒重繪（按鈕尚未停用），只有 ref 守衛擋得住第二次。
      const button = screen.getByRole("button", { name: EXPORT_NAME });
      act(() => {
        button.click();
        button.click();
      });

      expect(mockExport).toHaveBeenCalledTimes(1);
      pending.resolve("x.xlsx");
      await screen.findByText("已匯出「x.xlsx」");
    });

    it("失敗：顯示錯誤 Toast，按鈕恢復，可以再按一次重試", async () => {
      const user = userEvent.setup({ delay: null });
      mockExport.mockRejectedValueOnce(new Error("匯出失敗，請稍後再試。"));
      await openTable(user);

      await user.click(screen.getByRole("button", { name: EXPORT_NAME }));
      expect(await screen.findByText("匯出失敗，請稍後再試。")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: EXPORT_NAME })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: EXPORT_NAME }));
      expect(mockExport).toHaveBeenCalledTimes(2);
      // 成功 Toast 排在錯誤 Toast 後面（一次只顯示一則），這裡只確認第二次有成功送出且按鈕恢復。
      expect(await screen.findByRole("button", { name: EXPORT_NAME })).toBeEnabled();
    });

    it("沒有資料時停用，也不會呼叫匯出", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValue(ok([]));
      render(<ReportsView />);
      await screen.findByText("此期間沒有預約");
      await user.click(screen.getByRole("tab", { name: "報表" }));

      const button = screen.getByRole("button", { name: EXPORT_NAME });
      expect(button).toBeDisabled();
      act(() => button.click());
      expect(mockExport).not.toHaveBeenCalled();
    });

    it("載入中與錯誤時停用", async () => {
      const user = userEvent.setup({ delay: null });
      const pending = deferred<ReturnType<typeof ok>>();
      mockFetch.mockReturnValue(pending.promise);
      render(<ReportsView />);
      await user.click(screen.getByRole("tab", { name: "報表" }));
      expect(screen.getByRole("button", { name: EXPORT_NAME })).toBeDisabled();

      pending.resolve(ok(monthData()));
      await screen.findByTestId("summary-row");
      expect(screen.getByRole("button", { name: EXPORT_NAME })).toBeEnabled();
    });

    it("錯誤狀態下停用", async () => {
      const user = userEvent.setup({ delay: null });
      mockFetch.mockResolvedValue(failed);
      render(<ReportsView />);
      await screen.findByText("無法載入報表，請稍後再試。");
      await user.click(screen.getByRole("tab", { name: "報表" }));

      expect(screen.getByRole("button", { name: EXPORT_NAME })).toBeDisabled();
    });
  });

  describe("純文字渲染", () => {
    it("服務名稱含標記字元時以文字顯示，不產生元素", async () => {
      mockFetch.mockResolvedValue(ok([appt({ serviceName: "<img src=x onerror=alert(1)>", serviceId: "s-x" })]));
      const { container } = render(<ReportsView />);
      await screen.findByRole("list", { name: "熱門服務排行" });

      expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
      expect(container.querySelector("img[src='x']")).toBeNull();
    });
  });
});
