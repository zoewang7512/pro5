// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DemoMailNoticeDialog, type DemoMailNoticeKind } from "@/app/admin/_components/DemoMailNoticeDialog";

const NOTE = "正式環境會寄出這封信；體驗帳號不會真的寄出。";

function renderDialog(kind: DemoMailNoticeKind = "reschedule", open = true) {
  const onContinue = vi.fn();
  const onBack = vi.fn();
  const view = render(<DemoMailNoticeDialog open={open} kind={kind} onContinue={onContinue} onBack={onBack} />);
  return { onContinue, onBack, ...view };
}

afterEach(() => cleanup());

describe("DemoMailNoticeDialog（TASK-115）", () => {
  it("改期：標題、示意圖（含替代文字）、一句說明與兩個按鈕", () => {
    renderDialog("reschedule");

    const dialog = screen.getByRole("dialog", { name: "顧客會收到這封改期通知信" });
    expect(dialog).toBeInTheDocument();
    const image = screen.getByRole("img", { name: /改期通知信示意：主旨「預約已改期/ });
    expect(image).toHaveAttribute("src", "/demo/mail-notice-reschedule.png");
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我知道了，繼續" })).toBeInTheDocument();
  });

  it("取消：換成取消通知信的標題與示意圖，說明句相同", () => {
    renderDialog("cancel");

    expect(screen.getByRole("dialog", { name: "顧客會收到這封取消通知信" })).toBeInTheDocument();
    const image = screen.getByRole("img", { name: /取消通知信示意：主旨「預約已取消/ });
    expect(image).toHaveAttribute("src", "/demo/mail-notice-cancel.png");
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("不宣稱「已寄出」，只說明正式環境的行為", () => {
    renderDialog("reschedule");
    expect(screen.queryByText(/已寄出|已經寄出|已發送/)).not.toBeInTheDocument();
  });

  it("按「我知道了，繼續」只呼叫 onContinue", async () => {
    const user = userEvent.setup();
    const { onContinue, onBack } = renderDialog();

    await user.click(screen.getByRole("button", { name: "我知道了，繼續" }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("按「返回」只呼叫 onBack", async () => {
    const user = userEvent.setup();
    const { onContinue, onBack } = renderDialog();

    await user.click(screen.getByRole("button", { name: "返回" }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("按 Esc 視同返回（純鍵盤可操作，不會繼續）", async () => {
    const user = userEvent.setup();
    const { onContinue, onBack } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("焦點在視窗內，Tab 可依序到達兩個按鈕", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    const back = screen.getByRole("button", { name: "返回" });
    const proceed = screen.getByRole("button", { name: "我知道了，繼續" });
    const reached = new Set<Element | null>([document.activeElement]);
    for (let i = 0; i < 3; i++) {
      await user.tab();
      reached.add(document.activeElement);
    }
    expect(reached.has(back)).toBe(true);
    expect(reached.has(proceed)).toBe(true);
  });

  it("圖片載入失敗：改顯示主旨與內容摘要的文字替代，不顯示錯誤訊息，按鈕照常", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderDialog("reschedule");

    fireEvent.error(screen.getByRole("img"));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("主旨：預約已改期：{新日期} {新時間}")).toBeInTheDocument();
    expect(screen.getByText(/內容會列出服務項目、原時段與新時段，並附店家聯絡方式。/)).toBeInTheDocument();
    expect(screen.queryByText(/失敗|錯誤|無法/)).not.toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "我知道了，繼續" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("改期的圖片失敗後換成取消：取消的圖片仍會正常載入（失敗只針對該張圖）", () => {
    const { rerender } = renderDialog("reschedule");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    rerender(<DemoMailNoticeDialog open kind="cancel" onContinue={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByRole("img", { name: /取消通知信示意/ })).toBeInTheDocument();
  });

  it("未開啟：不渲染視窗，也不載入圖片", () => {
    renderDialog("reschedule", false);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
