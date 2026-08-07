// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ClosedDatesSection } from "@/app/admin/_components/ClosedDatesSection";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { getTaipeiToday } from "@/lib/admin/week-range";
import { getNextMonth } from "@/lib/admin/month-range";
import {
  addClosedDate,
  findAffectedAppointmentsForClosedDate,
  getAllClosedDates,
  removeClosedDate,
} from "@/lib/admin/closed-dates";

// 元件掛載時會呼叫 createClient()，測試環境沒有 Supabase 環境變數，且元件的所有資料存取
// 都經由下方 mock 的 lib/admin/closed-dates.ts 函式，不需要真正的 client 實例。
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/admin/closed-dates", () => ({
  getAllClosedDates: vi.fn(),
  addClosedDate: vi.fn(),
  removeClosedDate: vi.fn(),
  findAffectedAppointmentsForClosedDate: vi.fn(),
}));

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 用「下個月的第 15 天」當作測試用的未來日期：不管測試在哪一天執行，下個月一定全部
// 落在今天之後，避免依賴系統當天日期硬編出一個可能已經過去的日期字串。
function nextMonthDay(day: number): string {
  const today = getTaipeiToday();
  const [year, month] = today.split("-").map(Number);
  const next = getNextMonth(year, month);
  return `${next.year}-${pad2(next.month)}-${pad2(day)}`;
}

function renderSection() {
  return render(
    <ToastProvider>
      <ClosedDatesSection />
    </ToastProvider>,
  );
}

describe("ClosedDatesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // MUI Dialog 渲染在 React Portal，跨測試殘留會讓下一個測試看到重複元素；明確呼叫
  // cleanup() 而非依賴自動偵測，確保每個 it() 之間 DOM 完全重置。
  afterEach(() => {
    cleanup();
  });

  it("清單為空時顯示空狀態提示", async () => {
    vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: [] });
    renderSection();
    expect(await screen.findByText("尚無設定的特殊公休日")).toBeInTheDocument();
  });

  it("載入失敗時顯示錯誤訊息，不阻擋頁面其他部分", async () => {
    vi.mocked(getAllClosedDates).mockResolvedValue({
      ok: false,
      error: { message: "boom" },
    });
    renderSection();
    expect(
      await screen.findByText("無法載入特殊公休日設定，請重新整理再試一次。"),
    ).toBeInTheDocument();
    // 頁面標題與月曆本體仍然渲染，不因清單載入失敗而整段消失。
    expect(screen.getByText("特殊公休日")).toBeInTheDocument();
  });

  it("清單的移除按鈕直接刪除，不顯示警告，並重新整理清單", async () => {
    vi.mocked(getAllClosedDates)
      .mockResolvedValueOnce({ ok: true, data: [{ date: "2099-01-01" }] })
      .mockResolvedValueOnce({ ok: true, data: [] });
    vi.mocked(removeClosedDate).mockResolvedValue({ ok: true, data: undefined });

    const user = userEvent.setup();
    renderSection();

    expect(await screen.findByText("2099/01/01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移除公休日" }));

    await waitFor(() => expect(removeClosedDate).toHaveBeenCalledWith({}, "2099-01-01"));
    expect(screen.queryByText("部分預約將落在新的公休日")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("尚無設定的特殊公休日")).toBeInTheDocument());
    expect(getAllClosedDates).toHaveBeenCalledTimes(2);
  });

  it("移除失敗時顯示錯誤 Toast，清單維持不變", async () => {
    vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: [{ date: "2099-01-01" }] });
    vi.mocked(removeClosedDate).mockResolvedValue({ ok: false, error: { message: "boom" } });

    const user = userEvent.setup();
    renderSection();

    expect(await screen.findByText("2099/01/01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移除公休日" }));

    expect(await screen.findByText("操作失敗，請稍後再試")).toBeInTheDocument();
    expect(screen.getByText("2099/01/01")).toBeInTheDocument();
    expect(getAllClosedDates).toHaveBeenCalledTimes(1);
  });

  it("點選未標記且無受影響預約的日期，直接新增不顯示警告", async () => {
    vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(findAffectedAppointmentsForClosedDate).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(addClosedDate).mockResolvedValue({ ok: true, data: undefined });

    const user = userEvent.setup();
    renderSection();
    await screen.findByText("尚無設定的特殊公休日");

    await user.click(screen.getByRole("button", { name: "下個月" }));
    await user.click(screen.getByRole("button", { name: "15" }));

    const expectedDate = nextMonthDay(15);
    await waitFor(() =>
      expect(findAffectedAppointmentsForClosedDate).toHaveBeenCalledWith({}, expectedDate),
    );
    expect(screen.queryByText("部分預約將落在新的公休日")).not.toBeInTheDocument();
    await waitFor(() => expect(addClosedDate).toHaveBeenCalledWith({}, expectedDate));
  });

  it("點選有受影響預約的日期顯示警告，確認後才新增；取消不寫入", async () => {
    vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(findAffectedAppointmentsForClosedDate).mockResolvedValue({
      ok: true,
      data: [{ id: "a1", customer_name: "王小美", start_at: "2026-01-01T02:00:00Z" }],
    });
    vi.mocked(addClosedDate).mockResolvedValue({ ok: true, data: undefined });

    const user = userEvent.setup();
    renderSection();
    await screen.findByText("尚無設定的特殊公休日");

    await user.click(screen.getByRole("button", { name: "下個月" }));
    await user.click(screen.getByRole("button", { name: "20" }));

    expect(await screen.findByText("部分預約將落在新的公休日")).toBeInTheDocument();
    expect(screen.getByText("王小美")).toBeInTheDocument();
    expect(addClosedDate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "仍要新增" }));

    const expectedDate = nextMonthDay(20);
    await waitFor(() => expect(addClosedDate).toHaveBeenCalledWith({}, expectedDate));
    await waitFor(() =>
      expect(screen.queryByText("部分預約將落在新的公休日")).not.toBeInTheDocument(),
    );
  });

  it("警告 Modal 確認新增失敗時保留 Modal 開啟，顯示錯誤 Toast", async () => {
    vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(findAffectedAppointmentsForClosedDate).mockResolvedValue({
      ok: true,
      data: [{ id: "a1", customer_name: "王小美", start_at: "2026-01-01T02:00:00Z" }],
    });
    vi.mocked(addClosedDate).mockResolvedValue({ ok: false, error: { message: "boom" } });

    const user = userEvent.setup();
    renderSection();
    await screen.findByText("尚無設定的特殊公休日");

    await user.click(screen.getByRole("button", { name: "下個月" }));
    await user.click(screen.getByRole("button", { name: "20" }));
    expect(await screen.findByText("部分預約將落在新的公休日")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "仍要新增" }));

    expect(await screen.findByText("操作失敗，請稍後再試")).toBeInTheDocument();
    expect(screen.getByText("部分預約將落在新的公休日")).toBeInTheDocument();
  });
});
