// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { AdminDashboard } from "@/app/admin/_components/AdminDashboard";
import { ToastProvider } from "@/components/ui/ToastProvider";
import {
  cancelAppointment,
  getAppointmentDetail,
  getAppointmentsForWeek,
  rescheduleAppointment,
  type WeekAppointment,
} from "@/lib/admin/appointments";
import { getBusinessHoursForWeekday, getOccupiedRangesForDate, isDesignerOnLeave } from "@/lib/admin/reschedule-slots";
import { getAllBusinessHours } from "@/lib/admin/business-hours";
import { getClosedDatesInRange, isDateClosed } from "@/lib/admin/closed-dates";
import { getDesignerFilterOptions, getDesignerLeavesInRange } from "@/lib/admin/designers";
import { buildDateRange } from "@/lib/booking/date-range";
import { getTaipeiToday } from "@/lib/admin/week-range";

// TASK-115：Demo 的改期／取消在最終確認後先顯示寄信說明視窗；一般管理員流程不變。
// 資料層全部換成 mock，以「資料層的呼叫次數」驗證返回不寫入、繼續才寫入。

// 每個案例要走完「週曆列表 → 詳情 → 確認框 → 說明視窗」，全套件平行執行時 5 秒預設逾時不夠
// （比照 reports-view.test.tsx）。
vi.setConfig({ testTimeout: 30000 });

const state = vi.hoisted(() => ({ isDemo: true }));

vi.mock("@/app/admin/_components/AdminProfileContext", () => ({
  useAdminProfile: () => ({ isDemo: state.isDemo }),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@/lib/admin/appointments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/appointments")>()),
  getAppointmentsForWeek: vi.fn(),
  getAppointmentDetail: vi.fn(),
  cancelAppointment: vi.fn(),
  rescheduleAppointment: vi.fn(),
  markAppointmentCompleted: vi.fn(),
}));
vi.mock("@/lib/admin/reschedule-slots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/reschedule-slots")>()),
  getBusinessHoursForWeekday: vi.fn(),
  getOccupiedRangesForDate: vi.fn(),
  isDesignerOnLeave: vi.fn(),
}));
vi.mock("@/lib/admin/business-hours", () => ({ getAllBusinessHours: vi.fn() }));
vi.mock("@/lib/admin/closed-dates", () => ({ getClosedDatesInRange: vi.fn(), isDateClosed: vi.fn() }));
vi.mock("@/lib/admin/designers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/designers")>()),
  getDesignerFilterOptions: vi.fn(),
  getDesignerLeavesInRange: vi.fn(),
}));

const LIN_ID = "00000000-0000-4000-8000-000000000001";
const APPOINTMENT: WeekAppointment = {
  id: "00000000-0000-4000-8000-0000000000aa",
  customer_name: "王小姐",
  start_at: "2099-01-05T03:00:00+00:00",
  end_at: "2099-01-05T04:00:00+00:00",
  status: "confirmed",
  service_name: "韓系剪髮",
  duration_minutes: 30,
  buffer_minutes: 0,
  designer_id: LIN_ID,
  designer: { id: LIN_ID, name: "林小美", avatar_url: null },
};

const RESCHEDULE_TITLE = "顧客會收到這封改期通知信";
const CANCEL_TITLE = "顧客會收到這封取消通知信";

beforeEach(() => {
  vi.clearAllMocks();
  state.isDemo = true;
  vi.mocked(getAppointmentsForWeek).mockResolvedValue({ ok: true, data: [APPOINTMENT] });
  vi.mocked(getAppointmentDetail).mockResolvedValue({ ok: true, data: { ...APPOINTMENT, customer_phone: "0912345678" } });
  vi.mocked(cancelAppointment).mockResolvedValue({ ok: true, data: undefined });
  vi.mocked(rescheduleAppointment).mockResolvedValue({ ok: true, data: undefined });
  vi.mocked(getAllBusinessHours).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(getClosedDatesInRange).mockResolvedValue({ ok: true, data: new Set<string>() });
  vi.mocked(getDesignerFilterOptions).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(getDesignerLeavesInRange).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(getBusinessHoursForWeekday).mockResolvedValue({
    ok: true,
    data: { open_time: "10:00", close_time: "19:00", is_closed: false },
  });
  vi.mocked(getOccupiedRangesForDate).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(isDateClosed).mockResolvedValue({ ok: true, data: false });
  vi.mocked(isDesignerOnLeave).mockResolvedValue({ ok: true, data: false });
});

afterEach(() => cleanup());

// 列表檢視用文字就能點到那筆預約，不必依賴週曆格狀排版。
async function openAppointmentDetail() {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <AdminDashboard />
    </ToastProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "列表" }));
  await user.click(await screen.findByText("王小姐"));
  await screen.findByRole("button", { name: "取消預約" });
  return user;
}

async function goToCancelConfirm() {
  const user = await openAppointmentDetail();
  await user.click(screen.getByRole("button", { name: "取消預約" }));
  const confirm = await screen.findByRole("dialog", { name: "確認取消預約？" });
  return { user, confirm };
}

async function goToRescheduleSubmit() {
  const user = await openAppointmentDetail();
  await user.click(screen.getByRole("button", { name: "改期" }));
  const tomorrow = buildDateRange(getTaipeiToday(), 21)[1];
  await user.click(await screen.findByRole("button", { name: `週${tomorrow.weekdayLabel} ${tomorrow.day}` }));
  await user.click(await screen.findByRole("button", { name: "10:00" }));
  return user;
}

describe("AdminDashboard 取消預約（TASK-115）", () => {
  it("Demo：確認取消後先看到取消通知信說明視窗，此時還沒有任何寫入", async () => {
    const { user, confirm } = await goToCancelConfirm();

    await user.click(within(confirm).getByRole("button", { name: "取消預約" }));

    expect(await screen.findByRole("dialog", { name: CANCEL_TITLE })).toBeInTheDocument();
    expect(cancelAppointment).not.toHaveBeenCalled();
  });

  it("Demo：按「我知道了，繼續」才呼叫 cancelAppointment，之後與現況相同", async () => {
    const { user, confirm } = await goToCancelConfirm();
    await user.click(within(confirm).getByRole("button", { name: "取消預約" }));

    await user.click(await screen.findByRole("button", { name: "我知道了，繼續" }));

    await waitFor(() => expect(cancelAppointment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(cancelAppointment).mock.calls[0][1]).toBe(APPOINTMENT.id);
    expect(await screen.findByText("已取消預約")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: CANCEL_TITLE })).not.toBeInTheDocument();
  });

  it("Demo：按「返回」不寫入，回到取消確認框原狀", async () => {
    const { user, confirm } = await goToCancelConfirm();
    await user.click(within(confirm).getByRole("button", { name: "取消預約" }));

    await user.click(await screen.findByRole("button", { name: "返回" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: CANCEL_TITLE })).not.toBeInTheDocument());
    expect(cancelAppointment).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "確認取消預約？" })).toBeInTheDocument();
  });

  it("Demo：Esc 視同返回，不寫入", async () => {
    const { user, confirm } = await goToCancelConfirm();
    await user.click(within(confirm).getByRole("button", { name: "取消預約" }));
    await screen.findByRole("dialog", { name: CANCEL_TITLE });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: CANCEL_TITLE })).not.toBeInTheDocument());
    expect(cancelAppointment).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "確認取消預約？" })).toBeInTheDocument();
  });

  it("Demo：返回後可以再按一次取消確認，流程可重複走", async () => {
    const { user, confirm } = await goToCancelConfirm();
    await user.click(within(confirm).getByRole("button", { name: "取消預約" }));
    await user.click(await screen.findByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: CANCEL_TITLE })).not.toBeInTheDocument());

    await user.click(within(screen.getByRole("dialog", { name: "確認取消預約？" })).getByRole("button", { name: "取消預約" }));
    await user.click(await screen.findByRole("button", { name: "我知道了，繼續" }));

    await waitFor(() => expect(cancelAppointment).toHaveBeenCalledTimes(1));
  });

  it("一般管理員：不出現說明視窗，確認後直接取消，圖片不載入", async () => {
    state.isDemo = false;
    const { user, confirm } = await goToCancelConfirm();

    await user.click(within(confirm).getByRole("button", { name: "取消預約" }));

    await waitFor(() => expect(cancelAppointment).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: CANCEL_TITLE })).not.toBeInTheDocument();
    expect(screen.queryByText(/正式環境會寄出這封信/)).not.toBeInTheDocument();
    expect(document.querySelector('img[src^="/demo/"]')).toBeNull();
  });
});

describe("AdminDashboard 改期（TASK-115）", () => {
  it("Demo：按「確認改期」後先看到改期通知信說明視窗，此時還沒有任何寫入", async () => {
    const user = await goToRescheduleSubmit();

    await user.click(screen.getByRole("button", { name: "確認改期" }));

    expect(await screen.findByRole("dialog", { name: RESCHEDULE_TITLE })).toBeInTheDocument();
    expect(rescheduleAppointment).not.toHaveBeenCalled();
  });

  it("Demo：按「我知道了，繼續」才呼叫 rescheduleAppointment（一次）", async () => {
    const user = await goToRescheduleSubmit();
    await user.click(screen.getByRole("button", { name: "確認改期" }));

    await user.click(await screen.findByRole("button", { name: "我知道了，繼續" }));

    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rescheduleAppointment).mock.calls[0][1]).toBe(APPOINTMENT.id);
    expect(await screen.findByText("已更新預約時段")).toBeInTheDocument();
  });

  it("Demo：按「返回」不寫入，停在改期表單且已選的時段保留", async () => {
    const user = await goToRescheduleSubmit();
    await user.click(screen.getByRole("button", { name: "確認改期" }));

    await user.click(await screen.findByRole("button", { name: "返回" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: RESCHEDULE_TITLE })).not.toBeInTheDocument());
    expect(rescheduleAppointment).not.toHaveBeenCalled();
    expect(screen.queryByText("已更新預約時段")).not.toBeInTheDocument();
    // 改期表單原狀：「確認改期」可再次按下（沒有卡在送出中），時段仍是選取狀態。
    const submit = screen.getByRole("button", { name: "確認改期" });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(await screen.findByRole("dialog", { name: RESCHEDULE_TITLE })).toBeInTheDocument();
  });

  it("一般管理員：按「確認改期」直接送出，不出現說明視窗", async () => {
    state.isDemo = false;
    const user = await goToRescheduleSubmit();

    await user.click(screen.getByRole("button", { name: "確認改期" }));

    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: RESCHEDULE_TITLE })).not.toBeInTheDocument();
    expect(document.querySelector('img[src^="/demo/"]')).toBeNull();
  });
});
