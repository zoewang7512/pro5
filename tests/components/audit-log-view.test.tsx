// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { AuditLogView } from "@/app/admin/_components/AuditLogView";
import { listAuditLog, type AuditLogRow } from "@/lib/admin/audit-log";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

// 只替換資料讀取；中文事件名稱與差異文字（describeAuditEntry）用真的，才測得到列表實際顯示的內容。
vi.mock("@/lib/admin/audit-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/audit-log")>()),
  listAuditLog: vi.fn(),
}));

type Page = { rows: AuditLogRow[]; nextCursor: string | null };

function row(id: number, overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id,
    // 2026-10-24 15:12 UTC＝台北 23:12
    created_at: "2026-10-24T15:12:00.000Z",
    event_type: "booking_policy.updated",
    entity_type: "booking_policy",
    entity_id: "1",
    summary: {},
    changes: { min_lead_time_hours: { from: 2, to: 720 } },
    ...overrides,
  };
}

function cancelledRow(id: number): AuditLogRow {
  return row(id, {
    event_type: "appointment.cancelled",
    entity_type: "appointment",
    entity_id: `a${id}`,
    summary: {
      appointment_id: `a${id}`,
      service_name: "剪髮",
      designer_name: "林小美",
      start_at: "2026-10-25T07:00:00.000Z",
      end_at: "2026-10-25T08:00:00.000Z",
    },
    changes: { status: { from: "confirmed", to: "cancelled" } },
  });
}

function ok(page: Page) {
  return { ok: true as const, data: page };
}

const failed = { ok: false as const, error: { message: "發生未預期的錯誤，請稍後再試。" } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockList = vi.mocked(listAuditLog);

describe("AuditLogView", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("載入中顯示 Skeleton，不顯示表格與空狀態", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AuditLogView />);
    expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("尚無任何紀錄")).not.toBeInTheDocument();
  });

  it("第一次載入用「全部」且沒有游標", async () => {
    mockList.mockResolvedValue(ok({ rows: [row(1)], nextCursor: null }));
    render(<AuditLogView />);
    await screen.findByRole("table");
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList.mock.calls[0][1]).toEqual({ category: "all" });
  });

  it("顯示時間（Asia/Taipei）、中文事件、對象與差異；沒有的欄位顯示「—」", async () => {
    mockList.mockResolvedValue(
      ok({
        rows: [
          row(3),
          cancelledRow(2),
          row(1, {
            event_type: "service.deactivated",
            entity_type: "service",
            summary: { service_name: "漸層染髮" },
            changes: {},
          }),
        ],
        nextCursor: null,
      }),
    );
    render(<AuditLogView />);
    await screen.findByRole("table");

    const rows = screen.getAllByRole("row").slice(1); // 去掉表頭
    expect(rows).toHaveLength(3);

    const policy = within(rows[0]);
    expect(policy.getByText("10/24 23:12")).toBeInTheDocument();
    expect(policy.getByText("修改預約規則")).toBeInTheDocument();
    expect(policy.getByText("最短提前預約時間：2 小時 → 720 小時")).toBeInTheDocument();
    expect(policy.getAllByText("—")).toHaveLength(1); // 沒有對象

    const cancelled = within(rows[1]);
    expect(cancelled.getByText("取消預約")).toBeInTheDocument();
    expect(cancelled.getByText("剪髮・林小美・10/25 15:00–16:00")).toBeInTheDocument();
    expect(cancelled.getByText("狀態：已確認 → 已取消")).toBeInTheDocument();

    const deactivated = within(rows[2]);
    expect(deactivated.getByText("下架服務")).toBeInTheDocument();
    expect(deactivated.getByText("漸層染髮")).toBeInTheDocument();
    expect(deactivated.getAllByText("—")).toHaveLength(1); // 沒有差異
  });

  it("時間欄的 title 帶完整年月日（不依賴瀏覽器時區）", async () => {
    mockList.mockResolvedValue(ok({ rows: [row(1)], nextCursor: null }));
    render(<AuditLogView />);
    const cell = (await screen.findByText("10/24 23:12")).closest("td");
    expect(cell).toHaveAttribute("title", "2026/10/24 23:12");
  });

  it("一律純文字渲染：事件內容裡的 HTML 不會變成元素", async () => {
    mockList.mockResolvedValue(
      ok({
        rows: [
          row(1, {
            event_type: "service.created",
            entity_type: "service",
            summary: { service_name: '<img src=x onerror="alert(1)">' },
            changes: {},
          }),
        ],
        nextCursor: null,
      }),
    );
    const { container } = render(<AuditLogView />);
    await screen.findByRole("table");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  });

  it("沒有下一頁：顯示「已顯示全部紀錄」，沒有「載入更多」", async () => {
    mockList.mockResolvedValue(ok({ rows: [row(1)], nextCursor: null }));
    render(<AuditLogView />);
    await screen.findByRole("table");
    expect(screen.getByText("已顯示全部紀錄")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "載入更多" })).not.toBeInTheDocument();
  });

  describe("空狀態", () => {
    it("類別「全部」沒有資料：尚無任何紀錄", async () => {
      mockList.mockResolvedValue(ok({ rows: [], nextCursor: null }));
      render(<AuditLogView />);
      expect(await screen.findByText("尚無任何紀錄")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText("此類別沒有紀錄")).not.toBeInTheDocument();
    });

    it("篩選後沒有資料：此類別沒有紀錄", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      mockList.mockResolvedValueOnce(ok({ rows: [], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "預約" }));
      expect(await screen.findByText("此類別沒有紀錄")).toBeInTheDocument();
      expect(screen.queryByText("尚無任何紀錄")).not.toBeInTheDocument();
    });
  });

  describe("錯誤", () => {
    it("首次載入失敗：顯示錯誤與重試、不顯示表格；重試成功後顯示資料", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(failed);
      render(<AuditLogView />);
      expect(await screen.findByText("無法載入稽核紀錄，請稍後再試。")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();

      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "重試" }));
      await screen.findByRole("table");
      expect(screen.queryByText("無法載入稽核紀錄，請稍後再試。")).not.toBeInTheDocument();
      expect(mockList).toHaveBeenCalledTimes(2);
      expect(mockList.mock.calls[1][1]).toEqual({ category: "all" });
    });

    it("切換類別失敗：不顯示舊類別的資料（不顯示部分資料），重試沿用新類別", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      mockList.mockResolvedValueOnce(failed);
      await user.click(screen.getByRole("button", { name: "設定" }));
      expect(await screen.findByText("無法載入稽核紀錄，請稍後再試。")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "設定" })).toHaveAttribute("aria-pressed", "true");

      mockList.mockResolvedValueOnce(ok({ rows: [row(2)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "重試" }));
      await screen.findByRole("table");
      expect(mockList.mock.calls[2][1]).toEqual({ category: "settings" });
    });
  });

  describe("載入更多", () => {
    it("以最後一筆的游標載入下一頁並接在後面；沒有下一頁後按鈕消失", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(3), row(2)], nextCursor: "2" }));
      render(<AuditLogView />);
      await screen.findByRole("table");
      expect(screen.getAllByRole("row")).toHaveLength(3);

      mockList.mockResolvedValueOnce(ok({ rows: [cancelledRow(1)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "載入更多" }));

      await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
      expect(mockList.mock.calls[1][1]).toEqual({ category: "all", cursor: "2" });
      expect(screen.queryByRole("button", { name: "載入更多" })).not.toBeInTheDocument();
      expect(screen.getByText("已顯示全部紀錄")).toBeInTheDocument();
    });

    it("載入更多中：保留既有列、按鈕停用並顯示「載入中…」，不會重複送出", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(2)], nextCursor: "2" }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      const pending = deferred<ReturnType<typeof ok>>();
      mockList.mockReturnValueOnce(pending.promise);
      await user.click(screen.getByRole("button", { name: "載入更多" }));

      const loadingButton = await screen.findByRole("button", { name: /載入中/ });
      expect(loadingButton).toBeDisabled();
      expect(screen.getAllByRole("row")).toHaveLength(2); // 表頭＋既有 1 列
      fireEvent.click(loadingButton); // userEvent 會因 pointer-events: none 拒絕點擊；直接送事件確認不會重複請求
      expect(mockList).toHaveBeenCalledTimes(2);

      pending.resolve(ok({ rows: [row(1)], nextCursor: null }));
      await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    });

    it("載入更多失敗：既有列保留、顯示行內錯誤；重試用同一個游標，成功後附加", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(3), row(2)], nextCursor: "2" }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      mockList.mockResolvedValueOnce(failed);
      await user.click(screen.getByRole("button", { name: "載入更多" }));
      expect(await screen.findByText("無法載入更多紀錄，請稍後再試。")).toBeInTheDocument();
      expect(screen.getAllByRole("row")).toHaveLength(3); // 既有列還在
      expect(screen.queryByText("無法載入稽核紀錄，請稍後再試。")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "載入更多" })).not.toBeInTheDocument();

      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "重試" }));
      await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
      expect(screen.queryByText("無法載入更多紀錄，請稍後再試。")).not.toBeInTheDocument();
      expect(mockList.mock.calls[2][1]).toEqual({ category: "all", cursor: "2" });
    });

    it("下一頁含已顯示過的 id 時不重複列出", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(3), row(2)], nextCursor: "2" }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      mockList.mockResolvedValueOnce(ok({ rows: [row(2), row(1)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "載入更多" }));
      await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    });
  });

  describe("類別篩選", () => {
    it("預設選取「全部」；點選後以該類別重新載入並替換列表，選取狀態跟著變", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(2)], nextCursor: null }));
      render(<AuditLogView />);
      await screen.findByRole("table");
      expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "預約" })).toHaveAttribute("aria-pressed", "false");

      mockList.mockResolvedValueOnce(ok({ rows: [cancelledRow(1)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "預約" }));

      await screen.findByText("取消預約");
      expect(screen.queryByText("修改預約規則")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "預約" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "false");
      expect(mockList.mock.calls[1][1]).toEqual({ category: "appointment" });
    });

    it("切換類別時進入載入中（先清掉舊列）", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      const { container } = render(<AuditLogView />);
      await screen.findByRole("table");

      mockList.mockReturnValueOnce(new Promise(() => {}));
      await user.click(screen.getByRole("button", { name: "設定" }));
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(container.querySelectorAll(".MuiSkeleton-root").length).toBeGreaterThan(0);
    });

    it("篩選變更重置游標：載入更多後切換類別，新請求不帶游標；之後的「載入更多」用新類別的游標", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(5)], nextCursor: "5" }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      mockList.mockResolvedValueOnce(ok({ rows: [row(4)], nextCursor: "4" }));
      await user.click(screen.getByRole("button", { name: "載入更多" }));
      await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));

      mockList.mockResolvedValueOnce(ok({ rows: [cancelledRow(9)], nextCursor: "9" }));
      await user.click(screen.getByRole("button", { name: "預約" }));
      await screen.findByText("取消預約");
      expect(mockList.mock.calls[2][1]).toEqual({ category: "appointment" });
      expect(screen.getAllByRole("row")).toHaveLength(2); // 舊類別累積的列已清掉

      mockList.mockResolvedValueOnce(ok({ rows: [], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "載入更多" }));
      await waitFor(() => expect(mockList).toHaveBeenCalledTimes(4));
      expect(mockList.mock.calls[3][1]).toEqual({ category: "appointment", cursor: "9" });
    });

    it("點目前已選的類別：不重新載入", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      render(<AuditLogView />);
      await screen.findByRole("table");
      await user.click(screen.getByRole("button", { name: "全部" }));
      expect(mockList).toHaveBeenCalledTimes(1);
    });
  });

  describe("競態", () => {
    it("較慢的舊請求不得覆蓋較新的結果（先點預約、再點設定，預約的回應最後才到）", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      const slowAppointment = deferred<ReturnType<typeof ok>>();
      const fastSettings = deferred<ReturnType<typeof ok>>();
      mockList.mockReturnValueOnce(slowAppointment.promise).mockReturnValueOnce(fastSettings.promise);

      await user.click(screen.getByRole("button", { name: "預約" }));
      await user.click(screen.getByRole("button", { name: "設定" }));

      fastSettings.resolve(ok({ rows: [row(7, { event_type: "service.deactivated", summary: { service_name: "新請求" }, changes: {} })], nextCursor: null }));
      await screen.findByText("新請求");

      slowAppointment.resolve(ok({ rows: [cancelledRow(8)], nextCursor: null }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.getByText("新請求")).toBeInTheDocument();
      expect(screen.queryByText("取消預約")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "設定" })).toHaveAttribute("aria-pressed", "true");
    });

    it("舊請求失敗得較晚，也不會把新結果蓋成錯誤狀態", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(1)], nextCursor: null }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      const slowFail = deferred<typeof failed>();
      mockList.mockReturnValueOnce(slowFail.promise).mockResolvedValueOnce(ok({ rows: [cancelledRow(2)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "設定" }));
      await user.click(screen.getByRole("button", { name: "預約" }));
      await screen.findByText("取消預約");

      slowFail.resolve(failed);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByText("無法載入稽核紀錄，請稍後再試。")).not.toBeInTheDocument();
      expect(screen.getByText("取消預約")).toBeInTheDocument();
    });

    it("載入更多尚未回來就切換類別：晚到的舊類別資料不會附加到新類別", async () => {
      const user = userEvent.setup();
      mockList.mockResolvedValueOnce(ok({ rows: [row(5)], nextCursor: "5" }));
      render(<AuditLogView />);
      await screen.findByRole("table");

      const slowMore = deferred<ReturnType<typeof ok>>();
      mockList.mockReturnValueOnce(slowMore.promise).mockResolvedValueOnce(ok({ rows: [cancelledRow(9)], nextCursor: null }));
      await user.click(screen.getByRole("button", { name: "載入更多" }));
      await user.click(screen.getByRole("button", { name: "預約" }));
      await screen.findByText("取消預約");

      slowMore.resolve(ok({ rows: [row(4, { changes: { min_lead_time_hours: { from: 1, to: 999 } } })], nextCursor: null }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.getAllByRole("row")).toHaveLength(2); // 表頭＋1 列
      expect(screen.queryByText(/999/)).not.toBeInTheDocument();
    });
  });
});
