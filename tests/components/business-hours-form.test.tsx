// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestThemeWrapper } from "../test-utils";
import { BusinessHoursForm } from "@/app/admin/_components/BusinessHoursForm";
import { UnsavedChangesProvider, useIsUnsavedDirty } from "@/app/admin/_components/UnsavedChangesProvider";
import {
  findAffectedAppointments,
  getAllBusinessHours,
  updateBusinessHours,
  type BusinessHoursRow,
} from "@/lib/admin/business-hours";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/business-hours",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

// 公休日區塊是另一個即時儲存的元件，與本測試無關。
vi.mock("@/app/admin/_components/ClosedDatesSection", () => ({
  ClosedDatesSection: () => null,
}));

vi.mock("@/lib/admin/business-hours", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/business-hours")>();
  return {
    ...actual,
    getAllBusinessHours: vi.fn(),
    updateBusinessHours: vi.fn(),
    findAffectedAppointments: vi.fn(),
  };
});

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: TestThemeWrapper });
}

function Probe() {
  const dirty = useIsUnsavedDirty("business-hours");
  return <span data-testid="probe">{dirty ? "dirty" : "clean"}</span>;
}

// 資料庫形狀（含秒數）；週日（0）公休。
function dbRows(overrides: Partial<Record<number, Partial<BusinessHoursRow>>> = {}): BusinessHoursRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    open_time: weekday === 0 ? null : "10:00:00",
    close_time: weekday === 0 ? null : "19:00:00",
    is_closed: weekday === 0,
    ...overrides[weekday],
  }));
}

async function renderLoaded() {
  const user = userEvent.setup();
  render(
    <UnsavedChangesProvider>
      <BusinessHoursForm />
      <Probe />
    </UnsavedChangesProvider>,
  );
  // 七列各有一個「公休」開關；等載入完成。
  await screen.findAllByLabelText("開店時間");
  return { user };
}

// DISPLAY_WEEKDAYS 順序是 週一…週日，所以索引 0＝週一、6＝週日。
function openTimeInputs() {
  return screen.getAllByLabelText("開店時間") as HTMLInputElement[];
}
function closeTimeInputs() {
  return screen.getAllByLabelText("打烊時間") as HTMLInputElement[];
}
function closedSwitches() {
  return screen.getAllByLabelText("公休") as HTMLInputElement[];
}

describe("BusinessHoursForm 未儲存變更回報（TASK-082，key: business-hours）", () => {
  beforeEach(() => {
    showToast.mockReset();
    vi.mocked(getAllBusinessHours).mockResolvedValue({ ok: true, data: dbRows() });
    vi.mocked(updateBusinessHours).mockReset();
    vi.mocked(findAffectedAppointments).mockResolvedValue({ ok: true, data: [] });
  });
  afterEach(() => {
    cleanup();
  });

  it("載入完成、沒有改動：乾淨", async () => {
    await renderLoaded();
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("載入中：乾淨（骨架畫面不計入變更）", () => {
    vi.mocked(getAllBusinessHours).mockReturnValue(new Promise(() => {}));
    render(
      <UnsavedChangesProvider>
        <BusinessHoursForm />
        <Probe />
      </UnsavedChangesProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("載入失敗：乾淨", async () => {
    vi.mocked(getAllBusinessHours).mockResolvedValue({ ok: false, error: { message: "x" } });
    render(
      <UnsavedChangesProvider>
        <BusinessHoursForm />
        <Probe />
      </UnsavedChangesProvider>,
    );
    expect(await screen.findByText("無法載入營業時間設定，請重新整理再試一次。")).toBeInTheDocument();
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("切換公休：有變更；切回去：回到乾淨", async () => {
    const { user } = await renderLoaded();
    await user.click(closedSwitches()[0]); // 週一 → 公休
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
    await user.click(closedSwitches()[0]); // 切回營業；時間欄位被清空，所以仍有變更
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
    fireEvent.change(openTimeInputs()[0], { target: { value: "10:00" } });
    fireEvent.change(closeTimeInputs()[0], { target: { value: "19:00" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("改開店時間：有變更；改回原值：乾淨", async () => {
    await renderLoaded();
    fireEvent.change(openTimeInputs()[1], { target: { value: "11:00" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
    fireEvent.change(openTimeInputs()[1], { target: { value: "10:00" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("改打烊時間：有變更", async () => {
    await renderLoaded();
    fireEvent.change(closeTimeInputs()[4], { target: { value: "20:00" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
  });

  it("連續編輯不會洗掉 savedRows（防回歸）：改兩個不同欄位後改回其一仍是有變更", async () => {
    await renderLoaded();
    fireEvent.change(openTimeInputs()[0], { target: { value: "11:00" } });
    fireEvent.change(closeTimeInputs()[2], { target: { value: "20:00" } });
    fireEvent.change(openTimeInputs()[0], { target: { value: "10:00" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
    fireEvent.change(closeTimeInputs()[2], { target: { value: "19:00" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("clean");
  });

  it("儲存成功並重新載入後：乾淨", async () => {
    vi.mocked(updateBusinessHours).mockResolvedValue({ ok: true, data: undefined });
    const { user } = await renderLoaded();
    fireEvent.change(openTimeInputs()[1], { target: { value: "11:00" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");

    // 儲存後重新載入會拿到新值。
    vi.mocked(getAllBusinessHours).mockResolvedValue({
      ok: true,
      data: dbRows({ 2: { open_time: "11:00:00" } }),
    });
    await user.click(screen.getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(updateBusinessHours).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("clean"));
    expect(openTimeInputs()[1]).toHaveValue("11:00");
  });

  it("儲存失敗：維持有變更", async () => {
    vi.mocked(updateBusinessHours).mockResolvedValue({ ok: false, error: { message: "x" } });
    const { user } = await renderLoaded();
    fireEvent.change(openTimeInputs()[1], { target: { value: "11:00" } });
    await user.click(screen.getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    expect(screen.getByTestId("probe")).toHaveTextContent("dirty");
  });

  it("沒有 Provider 時照常運作（既有行為不變）", async () => {
    render(<BusinessHoursForm />);
    expect((await screen.findAllByLabelText("開店時間")).length).toBe(7);
  });
});
