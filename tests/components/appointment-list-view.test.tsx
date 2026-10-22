// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { AppointmentListView } from "@/app/admin/_components/AppointmentListView";
import type { WeekAppointment } from "@/lib/admin/appointments";

const APPOINTMENT: WeekAppointment = {
  id: "a1",
  customer_name: "王小姐",
  start_at: "2026-10-21T03:00:00+00:00",
  end_at: "2026-10-21T04:00:00+00:00",
  status: "confirmed",
  service_name: "韓系剪髮",
  duration_minutes: 60,
  buffer_minutes: 0,
  designer_id: "00000000-0000-4000-8000-000000000001",
  designer: { id: "00000000-0000-4000-8000-000000000001", name: "林小美", avatar_url: null },
};

describe("AppointmentListView 設計師欄", () => {
  afterEach(() => cleanup());

  it("表頭有「設計師」欄，每列顯示該預約的設計師名稱", () => {
    render(<AppointmentListView status="loaded" appointments={[APPOINTMENT]} />);
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["日期", "時段", "顧客", "服務", "設計師", "狀態"]);
    expect(screen.getByText("林小美")).toBeInTheDocument();
  });

  it("embed 缺漏（designer 為 null）時顯示破折號，不報錯", () => {
    render(<AppointmentListView status="loaded" appointments={[{ ...APPOINTMENT, designer: null }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("空狀態與載入中的列橫跨全部 6 欄", () => {
    const { container, rerender } = render(<AppointmentListView status="loaded" appointments={[]} />);
    expect(container.querySelector("tbody td")).toHaveAttribute("colspan", "6");
    expect(screen.getByText("本週沒有預約")).toBeInTheDocument();

    rerender(<AppointmentListView status="loading" appointments={[]} />);
    expect(container.querySelector("tbody td")).toHaveAttribute("colspan", "6");
  });

  it("篩選後沒有預約：顯示「○○本週沒有預約」與提示，不是「本週沒有預約」", () => {
    render(<AppointmentListView status="loaded" appointments={[]} filteredEmptyTitle="王大明本週沒有預約" />);
    expect(screen.getByText("王大明本週沒有預約")).toBeInTheDocument();
    expect(screen.getByText(/切換到「全部」或其他週次看看/)).toBeInTheDocument();
    expect(screen.queryByText("本週沒有預約")).not.toBeInTheDocument();
  });
});
