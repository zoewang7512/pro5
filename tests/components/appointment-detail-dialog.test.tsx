// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { AppointmentDetailDialog } from "@/app/admin/_components/AppointmentDetailDialog";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { getAppointmentDetail, type WeekAppointment } from "@/lib/admin/appointments";
import { getBusinessHoursForWeekday, getOccupiedRangesForDate, isDesignerOnLeave } from "@/lib/admin/reschedule-slots";
import { isDateClosed } from "@/lib/admin/closed-dates";
import { buildDateRange } from "@/lib/booking/date-range";
import { getTaipeiToday } from "@/lib/admin/week-range";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@/lib/admin/appointments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/appointments")>()),
  getAppointmentDetail: vi.fn(),
}));

// computeAvailableSlots 用真的（純函式），只換掉會打資料庫的三個查詢。
vi.mock("@/lib/admin/reschedule-slots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/reschedule-slots")>()),
  getBusinessHoursForWeekday: vi.fn(),
  getOccupiedRangesForDate: vi.fn(),
  isDesignerOnLeave: vi.fn(),
}));

vi.mock("@/lib/admin/closed-dates", () => ({ isDateClosed: vi.fn() }));

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
const GENERIC_ERROR = { ok: false as const, error: { message: "發生未預期的錯誤，請稍後再試。" } };

function renderDialog() {
  return render(
    <ToastProvider>
      <AppointmentDetailDialog
        open
        appointment={APPOINTMENT}
        markCompletedLoading={false}
        onClose={vi.fn()}
        onMarkCompleted={vi.fn()}
        onCancelRequest={vi.fn()}
        onReschedule={vi.fn()}
      />
    </ToastProvider>,
  );
}

// 預設用「明天」：今天可能已經過了最後一個可預約時段，會讓有時段的案例變得不穩定。
async function openRescheduleOnTomorrow() {
  const user = userEvent.setup();
  renderDialog();
  await user.click(await screen.findByRole("button", { name: "改期" }));
  const tomorrow = buildDateRange(getTaipeiToday(), 21)[1];
  await user.click(screen.getByRole("button", { name: `週${tomorrow.weekdayLabel} ${tomorrow.day}` }));
}

describe("AppointmentDetailDialog 設計師", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppointmentDetail).mockResolvedValue({
      ok: true,
      data: { ...APPOINTMENT, customer_phone: "0912345678" },
    });
    vi.mocked(getBusinessHoursForWeekday).mockResolvedValue({
      ok: true,
      data: { open_time: "10:00", close_time: "19:00", is_closed: false },
    });
    vi.mocked(getOccupiedRangesForDate).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(isDateClosed).mockResolvedValue({ ok: true, data: false });
    vi.mocked(isDesignerOnLeave).mockResolvedValue({ ok: true, data: false });
  });

  afterEach(() => cleanup());

  it("詳情顯示「設計師」列（名稱）", async () => {
    renderDialog();
    expect(await screen.findByText("設計師：")).toBeInTheDocument();
    expect(screen.getByText("林小美")).toBeInTheDocument();
  });

  it("embed 缺漏時設計師列顯示破折號", async () => {
    vi.mocked(getAppointmentDetail).mockResolvedValue({
      ok: true,
      data: { ...APPOINTMENT, designer: null, customer_phone: null },
    });
    render(
      <ToastProvider>
        <AppointmentDetailDialog
          open
          appointment={{ ...APPOINTMENT, designer: null }}
          markCompletedLoading={false}
          onClose={vi.fn()}
          onMarkCompleted={vi.fn()}
          onCancelRequest={vi.fn()}
          onReschedule={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(await screen.findByText("設計師：")).toBeInTheDocument();
    expect(screen.queryByText("林小美")).not.toBeInTheDocument();
  });

  it("改期表單：設計師唯讀並說明不能更換；時段查詢與請假查詢都用這位設計師，並排除這筆預約", async () => {
    await openRescheduleOnTomorrow();

    expect(await screen.findByText("（改期不能更換設計師）")).toBeInTheDocument();
    expect(screen.getByText("林小美")).toBeInTheDocument();
    // 唯讀：沒有任何可以更換設計師的表單控制項。
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await waitFor(() => expect(getOccupiedRangesForDate).toHaveBeenCalled());
    const [, params] = vi.mocked(getOccupiedRangesForDate).mock.calls.at(-1)!;
    expect(params).toMatchObject({ designerId: LIN_ID, excludeAppointmentId: APPOINTMENT.id });
    expect(params.designerId).not.toBe(params.excludeAppointmentId);
    const [, leaveDesignerId] = vi.mocked(isDesignerOnLeave).mock.calls.at(-1)!;
    expect(leaveDesignerId).toBe(LIN_ID);
  });

  it("沒有請假：照常列出可選時段（對照組）", async () => {
    await openRescheduleOnTomorrow();
    expect(await screen.findByRole("button", { name: "10:00" })).toBeEnabled();
  });

  it("設計師當天請假：直接顯示說明，不畫出任何灰掉的時段按鈕", async () => {
    vi.mocked(isDesignerOnLeave).mockResolvedValue({ ok: true, data: true });
    await openRescheduleOnTomorrow();

    expect(await screen.findByText(/設計師請假/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "10:00" })).not.toBeInTheDocument();
  });

  it("請假查詢失敗：fail-closed 顯示錯誤，不當成沒請假（不列出時段）", async () => {
    vi.mocked(isDesignerOnLeave).mockResolvedValue(GENERIC_ERROR);
    await openRescheduleOnTomorrow();

    expect(await screen.findByText("無法載入可預約時段，請重新整理頁面再試一次。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "10:00" })).not.toBeInTheDocument();
  });

  it("佔用時段查詢失敗（例如 designerId 不合法）：同樣 fail-closed 顯示錯誤", async () => {
    vi.mocked(getOccupiedRangesForDate).mockResolvedValue(GENERIC_ERROR);
    await openRescheduleOnTomorrow();

    expect(await screen.findByText("無法載入可預約時段，請重新整理頁面再試一次。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "10:00" })).not.toBeInTheDocument();
  });
});
