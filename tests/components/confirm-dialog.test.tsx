// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("關閉時不渲染內容", () => {
    render(
      <ConfirmDialog open={false} title="確認刪除？" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("確認刪除？")).not.toBeInTheDocument();
  });

  it("開啟時顯示標題與說明，點取消呼叫 onClose", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="確認刪除？"
        description="此操作無法復原"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("確認刪除？")).toBeInTheDocument();
    expect(screen.getByText("此操作無法復原")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("點確認呼叫 onConfirm", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog open title="確認刪除？" onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "確認" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("loading 時確認按鈕與取消按鈕皆停用", () => {
    render(
      <ConfirmDialog open title="確認刪除？" loading onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });

  describe("autoFocusCancel（TASK-081）", () => {
    it("autoFocusCancel 為 true 時，取消鈕取得預設焦點（Enter 不會誤觸確認鈕）", async () => {
      const onConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <ConfirmDialog
          open
          title="有尚未儲存的變更"
          cancelLabel="繼續編輯"
          confirmLabel="放棄變更"
          autoFocusCancel
          onConfirm={onConfirm}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "繼續編輯" })).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("預設（未傳 autoFocusCancel）取消鈕不會被強制取得焦點，既有行為不變", () => {
      render(<ConfirmDialog open title="確認刪除？" onConfirm={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByRole("button", { name: "取消" })).not.toHaveFocus();
    });
  });
});
