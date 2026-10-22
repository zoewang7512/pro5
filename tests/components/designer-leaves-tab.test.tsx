// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerLeavesTab } from "@/app/admin/_components/DesignerLeavesTab";
import {
  addDesignerLeave,
  findAffectedAppointmentsForDesignerLeave,
  listDesignerLeaves,
  removeDesignerLeave,
} from "@/lib/admin/designers";
import { getAllBusinessHours, type BusinessHoursRow } from "@/lib/admin/business-hours";
import { getAllClosedDates } from "@/lib/admin/closed-dates";
import { getNextMonth } from "@/lib/admin/month-range";
import { getTaipeiToday } from "@/lib/admin/week-range";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

// isShopClosedDate 是純函式，用真實實作；其餘資料存取一律 mock。
vi.mock("@/lib/admin/designers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/designers")>("@/lib/admin/designers");
  return {
    isShopClosedDate: actual.isShopClosedDate,
    listDesignerLeaves: vi.fn(),
    addDesignerLeave: vi.fn(),
    removeDesignerLeave: vi.fn(),
    findAffectedAppointmentsForDesignerLeave: vi.fn(),
  };
});
vi.mock("@/lib/admin/business-hours", () => ({ getAllBusinessHours: vi.fn() }));
vi.mock("@/lib/admin/closed-dates", () => ({ getAllClosedDates: vi.fn() }));

const DESIGNER_ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
const OK = { ok: true as const, data: undefined };
const FAIL = { ok: false as const, error: { message: "發生未預期的錯誤，請稍後再試。" } };

const ALL_OPEN: BusinessHoursRow[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  open_time: "10:00:00",
  close_time: "19:00:00",
  is_closed: false,
}));

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 下個月的第 N 天：不管測試在哪天執行，一定落在今天之後。
function nextMonthDay(day: number): string {
  const [year, month] = getTaipeiToday().split("-").map(Number);
  const next = getNextMonth(year, month);
  return `${next.year}-${pad2(next.month)}-${pad2(day)}`;
}

function firstSundayOfNextMonth(): string {
  for (let day = 1; day <= 7; day += 1) {
    const date = nextMonthDay(day);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) return date;
  }
  throw new Error("unreachable");
}

const REMOVE_BUTTON = /^移除 .* 的請假日$/;

// 對話框標題的日期格式「10/24（六）」。
function formatTitleDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}（${["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T00:00:00Z`).getUTCDay()]}）`;
}

function arrange(options: { leaves?: string[]; closedDates?: string[]; hours?: BusinessHoursRow[] } = {}) {
  vi.mocked(listDesignerLeaves).mockResolvedValue({ ok: true, data: options.leaves ?? [] });
  vi.mocked(getAllBusinessHours).mockResolvedValue({ ok: true, data: options.hours ?? ALL_OPEN });
  vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: (options.closedDates ?? []).map((date) => ({ date })) });
  const onCountChange = vi.fn();
  render(<DesignerLeavesTab designerId={DESIGNER_ID} designerName="林小美" onCountChange={onCountChange} />);
  return { onCountChange, user: userEvent.setup({ delay: null }) };
}

async function goToNextMonth(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "下個月" }));
}

describe("DesignerLeavesTab", () => {
  beforeEach(() => {
    vi.mocked(findAffectedAppointmentsForDesignerLeave).mockResolvedValue({ ok: true, data: [] });
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("載入後只列出今天以後的請假日，並回報今天以後的天數（過去的請假日不算）", async () => {
    const { onCountChange } = arrange({ leaves: ["2000-01-02", nextMonthDay(20), nextMonthDay(5)] });

    expect(await screen.findAllByRole("button", { name: REMOVE_BUTTON })).toHaveLength(2);
    expect(screen.queryByText("1/2（日）")).toBeNull();
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    expect(listDesignerLeaves).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID);
  });

  it("沒有請假日時顯示空狀態並回報 0", async () => {
    const { onCountChange } = arrange();
    expect(await screen.findByText("目前沒有排定的請假日")).toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith(0);
  });

  it.each([
    ["請假日", () => vi.mocked(listDesignerLeaves).mockResolvedValue(FAIL)],
    ["營業時間", () => vi.mocked(getAllBusinessHours).mockResolvedValue(FAIL)],
    ["公休日", () => vi.mocked(getAllClosedDates).mockResolvedValue(FAIL)],
  ])("%s載入失敗：顯示錯誤，不渲染月曆", async (_name, fail) => {
    vi.mocked(listDesignerLeaves).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(getAllBusinessHours).mockResolvedValue({ ok: true, data: ALL_OPEN });
    vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: [] });
    fail();
    render(<DesignerLeavesTab designerId={DESIGNER_ID} designerName="林小美" onCountChange={vi.fn()} />);

    expect(await screen.findByText("無法載入請假日設定，請重新整理頁面再試一次。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下個月" })).toBeNull();
  });

  it("讀取函式拋出例外（不是回傳失敗）：顯示錯誤，不會一直停在載入中", async () => {
    vi.mocked(listDesignerLeaves).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(getAllBusinessHours).mockRejectedValue(new Error("network down"));
    vi.mocked(getAllClosedDates).mockResolvedValue({ ok: true, data: [] });
    render(<DesignerLeavesTab designerId={DESIGNER_ID} designerName="林小美" onCountChange={vi.fn()} />);

    expect(await screen.findByText("無法載入請假日設定，請重新整理頁面再試一次。")).toBeInTheDocument();
  });

  it("點未來日期且沒有受影響預約：直接新增，不跳警告，成功後重讀並回報新天數", async () => {
    const date = nextMonthDay(15);
    const { user, onCountChange } = arrange();
    vi.mocked(addDesignerLeave).mockResolvedValue(OK);
    await goToNextMonth(user);

    vi.mocked(listDesignerLeaves).mockResolvedValue({ ok: true, data: [date] });
    await user.click(await screen.findByRole("button", { name: "15" }));

    await waitFor(() => expect(addDesignerLeave).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, date));
    expect(findAffectedAppointmentsForDesignerLeave).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, date);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(1));
    expect(showToast).toHaveBeenCalledWith("已標記請假", "success");
    expect(await screen.findAllByRole("button", { name: REMOVE_BUTTON })).toHaveLength(1);
  });

  it("有受影響預約：先跳警告列出時間、顧客、服務；確認後才寫入", async () => {
    const date = nextMonthDay(15);
    const { user, onCountChange } = arrange();
    vi.mocked(findAffectedAppointmentsForDesignerLeave).mockResolvedValue({
      ok: true,
      data: [
        { id: "a1", customer_name: "王小姐", start_at: `${date}T03:00:00Z`, service_name: "韓系剪髮" },
        { id: "a2", customer_name: "李先生", start_at: `${date}T07:30:00Z`, service_name: "" },
      ],
    });
    vi.mocked(addDesignerLeave).mockResolvedValue(OK);
    await goToNextMonth(user);
    await user.click(await screen.findByRole("button", { name: "15" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(`標記 ${formatTitleDate(date)}為林小美的請假日？`)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "林小美當天已經有以下 2 筆預約。標記請假後，這些預約不會自動取消，也不會通知顧客，請記得另外處理。",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("11:00")).toBeInTheDocument();
    expect(within(dialog).getByText("王小姐 · 韓系剪髮")).toBeInTheDocument();
    expect(within(dialog).getByText("15:30")).toBeInTheDocument();
    expect(within(dialog).getByText("李先生")).toBeInTheDocument();
    expect(addDesignerLeave).not.toHaveBeenCalled();

    vi.mocked(listDesignerLeaves).mockResolvedValue({ ok: true, data: [date] });
    await user.click(within(dialog).getByRole("button", { name: "仍要標記請假" }));

    await waitFor(() => expect(addDesignerLeave).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, date));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(showToast).toHaveBeenCalledWith("已標記請假", "success");

    // 確認成功後要重讀（以資料庫為準）、回報新天數，並解除鎖定讓店長可以繼續操作。
    expect(listDesignerLeaves).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(1));
    expect(await screen.findAllByRole("button", { name: REMOVE_BUTTON })).toHaveLength(1);
    vi.mocked(findAffectedAppointmentsForDesignerLeave).mockClear();
    await user.click(screen.getByRole("button", { name: "16" }));
    await waitFor(() => expect(findAffectedAppointmentsForDesignerLeave).toHaveBeenCalledTimes(1));
  });

  it("警告對話框按「取消」：不寫入，月曆解除鎖定可再次操作", async () => {
    const date = nextMonthDay(15);
    const { user } = arrange();
    vi.mocked(findAffectedAppointmentsForDesignerLeave).mockResolvedValue({
      ok: true,
      data: [{ id: "a1", customer_name: "王小姐", start_at: `${date}T03:00:00Z`, service_name: "韓系剪髮" }],
    });
    await goToNextMonth(user);
    await user.click(await screen.findByRole("button", { name: "15" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(addDesignerLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "15" }));
    await waitFor(() => expect(findAffectedAppointmentsForDesignerLeave).toHaveBeenCalledTimes(2));
  });

  it("警告後確認寫入失敗：Toast 錯誤、保留對話框讓店長決定", async () => {
    const date = nextMonthDay(15);
    const { user } = arrange();
    vi.mocked(findAffectedAppointmentsForDesignerLeave).mockResolvedValue({
      ok: true,
      data: [{ id: "a1", customer_name: "王小姐", start_at: `${date}T03:00:00Z`, service_name: "韓系剪髮" }],
    });
    vi.mocked(addDesignerLeave).mockResolvedValue(FAIL);
    await goToNextMonth(user);
    await user.click(await screen.findByRole("button", { name: "15" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "仍要標記請假" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // 保留對話框後可以再按一次重試，成功才關閉。
    vi.mocked(addDesignerLeave).mockResolvedValue(OK);
    vi.mocked(listDesignerLeaves).mockResolvedValue({ ok: true, data: [date] });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "仍要標記請假" }));
    await waitFor(() => expect(addDesignerLeave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(showToast).toHaveBeenCalledWith("已標記請假", "success");
  });

  it("查詢受影響預約失敗：不寫入（fail closed），只顯示錯誤 Toast", async () => {
    const { user } = arrange();
    vi.mocked(findAffectedAppointmentsForDesignerLeave).mockResolvedValue(FAIL);
    await goToNextMonth(user);
    await user.click(await screen.findByRole("button", { name: "15" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(addDesignerLeave).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("新增失敗：Toast 錯誤並重讀（以資料庫為準）", async () => {
    const { user } = arrange();
    vi.mocked(addDesignerLeave).mockResolvedValue(FAIL);
    await goToNextMonth(user);
    await user.click(await screen.findByRole("button", { name: "15" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    await waitFor(() => expect(listDesignerLeaves).toHaveBeenCalledTimes(2));
  });

  it("點已標記的日期：直接移除，不查受影響預約、不警告", async () => {
    const date = nextMonthDay(15);
    const { user } = arrange({ leaves: [date] });
    vi.mocked(removeDesignerLeave).mockResolvedValue(OK);
    await goToNextMonth(user);

    vi.mocked(listDesignerLeaves).mockResolvedValue({ ok: true, data: [] });
    await user.click(await screen.findByRole("button", { name: "15" }));

    await waitFor(() => expect(removeDesignerLeave).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, date));
    expect(findAffectedAppointmentsForDesignerLeave).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("目前沒有排定的請假日")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith("已移除請假日", "success");
  });

  it("清單的「移除」直接刪除；失敗時 Toast 錯誤並重讀", async () => {
    const date = nextMonthDay(15);
    const { user, onCountChange } = arrange({ leaves: [date] });
    vi.mocked(removeDesignerLeave).mockResolvedValue(FAIL);

    await user.click(await screen.findByRole("button", { name: REMOVE_BUTTON }));

    await waitFor(() => expect(removeDesignerLeave).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, date));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    await waitFor(() => expect(listDesignerLeaves).toHaveBeenCalledTimes(2));
    expect(findAffectedAppointmentsForDesignerLeave).not.toHaveBeenCalled();
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it("全店公休日（closed_dates 與每週固定公休）在月曆上唯讀：不能點、不查詢、不寫入", async () => {
    // 下個月 20 日為特殊公休；每週日固定公休。
    const sunday = firstSundayOfNextMonth();
    const hours = ALL_OPEN.map((row) =>
      row.weekday === 0 ? { ...row, open_time: null, close_time: null, is_closed: true } : row,
    );
    const { user } = arrange({ closedDates: [nextMonthDay(20)], hours });
    await goToNextMonth(user);

    const special = await screen.findByRole("button", { name: "20 日，全店公休" });
    const weekly = screen.getByRole("button", { name: `${Number(sunday.slice(8))} 日，全店公休` });
    for (const cell of [special, weekly]) {
      expect(cell).toHaveAttribute("aria-disabled", "true");
      await user.click(cell);
    }
    expect(findAffectedAppointmentsForDesignerLeave).not.toHaveBeenCalled();
    expect(addDesignerLeave).not.toHaveBeenCalled();
  });

  it("同一天既是請假又是全店公休：月曆上唯讀，但右側清單仍可移除", async () => {
    const date = nextMonthDay(20);
    const { user } = arrange({ leaves: [date], closedDates: [date] });
    vi.mocked(removeDesignerLeave).mockResolvedValue(OK);
    await goToNextMonth(user);

    await user.click(await screen.findByRole("button", { name: "20 日，全店公休" }));
    expect(removeDesignerLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: REMOVE_BUTTON }));
    await waitFor(() => expect(removeDesignerLeave).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, date));
  });

  it("寫入成功但重讀失敗：保留畫面現狀並用 Toast 提醒，不換成整頁錯誤", async () => {
    const existing = nextMonthDay(5);
    const { user } = arrange({ leaves: [existing] });
    vi.mocked(addDesignerLeave).mockResolvedValue(OK);
    await goToNextMonth(user);

    vi.mocked(listDesignerLeaves).mockResolvedValue(FAIL);
    await user.click(await screen.findByRole("button", { name: "15" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("無法更新請假日，請重新整理頁面", "error"));
    expect(screen.queryByText("無法載入請假日設定，請重新整理頁面再試一次。")).toBeNull();
    expect(screen.getAllByRole("button", { name: REMOVE_BUTTON })).toHaveLength(1);
  });

  it("寫入進行中整個月曆鎖定，避免並行寫入", async () => {
    const { user } = arrange();
    let finish: () => void = () => {};
    vi.mocked(addDesignerLeave).mockReturnValue(new Promise((resolve) => (finish = () => resolve(OK))));
    await goToNextMonth(user);

    await user.click(await screen.findByRole("button", { name: "15" }));
    await waitFor(() => expect(addDesignerLeave).toHaveBeenCalledTimes(1));
    // 畫面層用 pointer-events 鎖住；fireEvent 繞過 CSS，直接驗證處理函式自己的 busy 防呆。
    fireEvent.click(screen.getByRole("button", { name: "16" }));
    expect(findAffectedAppointmentsForDesignerLeave).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("已標記請假", "success"));
  });

  it("寫入進行中，清單的「移除」與月曆上已標記日期的點擊也被 busy 擋下（處理函式自己的防呆）", async () => {
    const existing = nextMonthDay(5);
    const { user } = arrange({ leaves: [existing] });
    let finish: () => void = () => {};
    vi.mocked(addDesignerLeave).mockReturnValue(new Promise((resolve) => (finish = () => resolve(OK))));
    await goToNextMonth(user);

    await user.click(await screen.findByRole("button", { name: "15" }));
    await waitFor(() => expect(addDesignerLeave).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: REMOVE_BUTTON }));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(removeDesignerLeave).not.toHaveBeenCalled();

    finish();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("已標記請假", "success"));
  });

  it("「今天」本身算即將到來：列入清單與頁籤天數，月曆上也可以點", async () => {
    const today = getTaipeiToday();
    const { onCountChange, user } = arrange({ leaves: [today] });

    expect(await screen.findAllByRole("button", { name: REMOVE_BUTTON })).toHaveLength(1);
    expect(onCountChange).toHaveBeenLastCalledWith(1);

    // 今天已標記：點月曆上的今天直接移除（今天不是過去日期）。
    vi.mocked(removeDesignerLeave).mockResolvedValue(OK);
    await user.click(screen.getByRole("button", { name: String(Number(today.slice(8))) }));
    await waitFor(() => expect(removeDesignerLeave).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, today));
  });
});
