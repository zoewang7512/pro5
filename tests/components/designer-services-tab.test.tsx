// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerServicesTab } from "@/app/admin/_components/DesignerServicesTab";
import { listDesignerServiceIds, setDesignerService } from "@/lib/admin/designers";
import { listServices } from "@/lib/admin/services";
import type { AdminService } from "@/lib/booking/types";

const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("@/lib/admin/designers", () => ({
  listDesignerServiceIds: vi.fn(),
  setDesignerService: vi.fn(),
}));

vi.mock("@/lib/admin/services", () => ({
  listServices: vi.fn(),
}));

const DESIGNER_ID = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const GONE = "44444444-4444-4444-8444-444444444444";

function service(id: string, name: string, overrides: Partial<AdminService> = {}): AdminService {
  return {
    id,
    name,
    description: null,
    price: 800,
    duration_minutes: 60,
    buffer_minutes: 0,
    is_active: true,
    sort_order: 0,
    ...overrides,
  };
}

const SERVICES = [service(S1, "韓系剪髮"), service(S2, "洗剪吹", { price: 600, duration_minutes: 45 }), service(S3, "漸層染髮")];
const GENERIC = { ok: false as const, error: { message: "發生未預期的錯誤，請稍後再試。" } };
const OK = { ok: true as const, data: undefined };

function arrange(enabledIds: string[] = [S1, S2], services: AdminService[] = SERVICES) {
  vi.mocked(listServices).mockResolvedValue({ ok: true, data: services });
  vi.mocked(listDesignerServiceIds).mockResolvedValue({ ok: true, data: enabledIds });
  const onCountChange = vi.fn();
  render(<DesignerServicesTab designerId={DESIGNER_ID} onCountChange={onCountChange} />);
  return { onCountChange };
}

const toggle = (name: string) => screen.getByRole("switch", { name: `開放「${name}」` });

describe("DesignerServicesTab", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("載入後每個上架中的服務一列（名稱、時長、價格、Switch），已開啟的為勾選，並回報開啟數", async () => {
    const { onCountChange } = arrange();

    expect(await screen.findByText("韓系剪髮")).toBeInTheDocument();
    expect(screen.getByText("45 分鐘 · NT$600")).toBeInTheDocument();
    expect(toggle("韓系剪髮")).toBeChecked();
    expect(toggle("洗剪吹")).toBeChecked();
    expect(toggle("漸層染髮")).not.toBeChecked();
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    expect(screen.getByText(/關閉服務不會影響已經成立的預約，只會影響之後的新預約/)).toBeInTheDocument();
    expect(listDesignerServiceIds).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID);
  });

  it("下架中的服務不列出，也不計入開啟數（即使設計師有開）", async () => {
    const { onCountChange } = arrange([S1, GONE], [service(S1, "韓系剪髮"), service(GONE, "已下架服務", { is_active: false })]);

    await screen.findByText("韓系剪髮");
    expect(screen.queryByText("已下架服務")).toBeNull();
    expect(onCountChange).toHaveBeenLastCalledWith(1);
  });

  it("沒有任何上架中的服務：顯示空狀態，不畫 Switch", async () => {
    arrange([], []);
    expect(await screen.findByText(/目前沒有上架中的服務/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("開啟：寫入成功後保持勾選、開啟數加一；寫入期間該列 Switch 停用，其他列不受影響", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCountChange } = arrange();
    let finish: (value: typeof OK) => void = () => {};
    vi.mocked(setDesignerService).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await screen.findByText("漸層染髮");

    await user.click(toggle("漸層染髮"));

    expect(setDesignerService).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, S3, true);
    expect(toggle("漸層染髮")).toBeDisabled();
    expect(toggle("韓系剪髮")).toBeEnabled();
    finish(OK);
    await waitFor(() => expect(toggle("漸層染髮")).toBeEnabled());
    expect(toggle("漸層染髮")).toBeChecked();
    expect(onCountChange).toHaveBeenLastCalledWith(3);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("關閉：呼叫 enabled=false，成功後開啟數減一", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCountChange } = arrange();
    vi.mocked(setDesignerService).mockResolvedValue(OK);
    await screen.findByText("韓系剪髮");

    await user.click(toggle("韓系剪髮"));

    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(1));
    expect(setDesignerService).toHaveBeenCalledWith(expect.anything(), DESIGNER_ID, S1, false);
    expect(toggle("韓系剪髮")).not.toBeChecked();
  });

  it("寫入失敗：Toast 並重讀資料庫，畫面以資料庫為準（Switch 回復、數字回復）", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCountChange } = arrange();
    vi.mocked(setDesignerService).mockResolvedValue(GENERIC);
    await screen.findByText("漸層染髮");
    vi.mocked(listDesignerServiceIds).mockResolvedValue({ ok: true, data: [S1, S2] });

    await user.click(toggle("漸層染髮"));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("操作失敗，請稍後再試", "error"));
    await waitFor(() => expect(toggle("漸層染髮")).toBeEnabled());
    expect(toggle("漸層染髮")).not.toBeChecked();
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    expect(listDesignerServiceIds).toHaveBeenCalledTimes(2);
  });

  it("寫入結果不明（回報失敗但伺服器其實已寫入）：重讀後畫面顯示實際已開啟", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCountChange } = arrange();
    vi.mocked(setDesignerService).mockResolvedValue(GENERIC);
    await screen.findByText("漸層染髮");
    vi.mocked(listDesignerServiceIds).mockResolvedValue({ ok: true, data: [S1, S2, S3] });

    await user.click(toggle("漸層染髮"));

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    await waitFor(() => expect(toggle("漸層染髮")).toBeEnabled());
    expect(toggle("漸層染髮")).toBeChecked();
    expect(onCountChange).toHaveBeenLastCalledWith(3);
  });

  it("寫入失敗且重讀也失敗：只把這一列回復原值", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCountChange } = arrange();
    vi.mocked(setDesignerService).mockResolvedValue(GENERIC);
    await screen.findByText("韓系剪髮");
    vi.mocked(listDesignerServiceIds).mockResolvedValue(GENERIC);

    await user.click(toggle("韓系剪髮"));

    await waitFor(() => expect(toggle("韓系剪髮")).toBeEnabled());
    expect(toggle("韓系剪髮")).toBeChecked();
    expect(toggle("洗剪吹")).toBeChecked();
    expect(onCountChange).toHaveBeenLastCalledWith(2);
  });

  it("服務清單讀取失敗：顯示錯誤，不畫 Switch，也不回報開啟數", async () => {
    vi.mocked(listServices).mockResolvedValue(GENERIC);
    vi.mocked(listDesignerServiceIds).mockResolvedValue({ ok: true, data: [S1] });
    const onCountChange = vi.fn();
    render(<DesignerServicesTab designerId={DESIGNER_ID} onCountChange={onCountChange} />);

    expect(await screen.findByText("無法載入提供服務的設定，請重新整理頁面再試一次。")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(onCountChange).not.toHaveBeenCalled();
  });

  it("designer_services 讀取失敗：同樣顯示錯誤，不畫出一整排「全部關閉」的 Switch", async () => {
    vi.mocked(listServices).mockResolvedValue({ ok: true, data: SERVICES });
    vi.mocked(listDesignerServiceIds).mockResolvedValue(GENERIC);
    render(<DesignerServicesTab designerId={DESIGNER_ID} onCountChange={vi.fn()} />);

    expect(await screen.findByText("無法載入提供服務的設定，請重新整理頁面再試一次。")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
