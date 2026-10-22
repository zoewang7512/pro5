// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestThemeWrapper } from "../test-utils";
import {
  UnsavedChangesProvider,
  useIsUnsavedDirty,
  useUnsavedChangesActions,
  useUnsavedChangesGuard,
} from "@/app/admin/_components/UnsavedChangesProvider";

// rerender 要保留 Provider（與其 store）：用 wrapper 選項，不能用 renderWithTheme（它的 rerender 會整棵重掛）。
function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: TestThemeWrapper });
}

const nav = vi.hoisted(() => ({ pathname: "/admin/booking-policy", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
}));

// 測試用表單：回報 dirty，並提供「離開」按鈕走 confirmIfDirty。
function Form({
  guardKey = "form",
  dirty,
  onLeave,
  confirmKey,
  leaving,
}: {
  guardKey?: string;
  dirty: boolean;
  onLeave: () => void;
  confirmKey?: string;
  leaving?: boolean;
}) {
  useUnsavedChangesGuard(guardKey, dirty);
  const { confirmIfDirty } = useUnsavedChangesActions();
  return (
    <button type="button" onClick={() => confirmIfDirty(onLeave, { key: confirmKey, leaving })}>
      離開
    </button>
  );
}

function NavLink({ href }: { href: string }) {
  const { guardNavigate } = useUnsavedChangesActions();
  return (
    <a
      href={href}
      onClick={(event) => {
        // 模擬 next/link 的 onNavigate：Next 已先 preventDefault，再呼叫 onNavigate({ preventDefault })。
        event.preventDefault();
        guardNavigate(href, { preventDefault: () => (event as unknown as { __prevented?: boolean }).__prevented = true });
      }}
    >
      前往 {href}
    </a>
  );
}

function DirtyDot({ watchKey }: { watchKey: string }) {
  const dirty = useIsUnsavedDirty(watchKey);
  return <span data-testid={`dot-${watchKey}`}>{dirty ? "dirty" : "clean"}</span>;
}

function fireBeforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("UnsavedChangesProvider", () => {
  beforeEach(() => {
    nav.pathname = "/admin/booking-policy";
    nav.push.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("沒有 Provider 時（既有表單測試的情境）", () => {
    it("所有 hook 是安全的 no-op：confirmIfDirty 立刻執行動作、useIsUnsavedDirty 回 false、不註冊 beforeunload", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <>
          <Form dirty onLeave={onLeave} />
          <DirtyDot watchKey="form" />
        </>,
      );

      expect(screen.getByTestId("dot-form")).toHaveTextContent("clean");
      expect(fireBeforeUnload().defaultPrevented).toBe(false);

      await user.click(screen.getByRole("button", { name: "離開" }));
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
    });
  });

  describe("confirmIfDirty 與提示對話框", () => {
    it("沒有變更：立刻執行動作，不顯示提示", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty={false} onLeave={onLeave} />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
    });

    it("有變更：顯示提示與說明、不執行動作；預設焦點在「繼續編輯」", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={onLeave} />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      expect(screen.getByText("有尚未儲存的變更")).toBeInTheDocument();
      expect(screen.getByText("離開後，你輸入的內容會消失。")).toBeInTheDocument();
      expect(onLeave).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "繼續編輯" })).toHaveFocus();
    });

    it("「繼續編輯」：關閉提示、不執行動作，且之後再離開仍會提示（待執行動作已清掉、狀態仍是 dirty）", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={onLeave} />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      await user.click(screen.getByRole("button", { name: "繼續編輯" }));
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
      expect(onLeave).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "離開" }));
      expect(screen.getByText("有尚未儲存的變更")).toBeInTheDocument();
    });

    it("Esc 等同「繼續編輯」：不執行動作", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={onLeave} />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      await user.keyboard("{Escape}");
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
      expect(onLeave).not.toHaveBeenCalled();
    });

    it("按 Enter（預設焦點在「繼續編輯」）不會誤觸「放棄變更」", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={onLeave} />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      await user.keyboard("{Enter}");
      expect(onLeave).not.toHaveBeenCalled();
    });

    it("「放棄變更」：關閉提示並執行待執行動作一次", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={onLeave} />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      await user.click(screen.getByRole("button", { name: "放棄變更" }));
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
      expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it("StrictMode 下「放棄變更」仍只執行動作一次（待執行動作存在 ref，不是 useState）", async () => {
      const onLeave = vi.fn();
      const user = userEvent.setup();
      render(
        <React.StrictMode>
          <UnsavedChangesProvider>
            <Form dirty onLeave={onLeave} />
          </UnsavedChangesProvider>
        </React.StrictMode>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      await user.click(screen.getByRole("button", { name: "放棄變更" }));
      expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it("待執行動作丟出例外：對話框仍已關閉、錯誤被記錄，不會卡住使用者（放棄變更永遠可用）", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onLeave = vi.fn(() => {
        throw new Error("導覽失敗");
      });
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={onLeave} leaving />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      await user.click(screen.getByRole("button", { name: "放棄變更" }));
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      // 動作失敗後「離開中」標記已重設：beforeunload 仍會提示（使用者還在原頁、輸入還在）。
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });
  });

  describe("key 範圍", () => {
    it("指定 key 時只看該 key：別的表單有變更，不會讓沒變更的對話框誤跳提示", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form guardKey="other-form" dirty onLeave={vi.fn()} />
          <Form guardKey="service-form" dirty={false} onLeave={onClose} confirmKey="service-form" />
        </UnsavedChangesProvider>,
      );

      const buttons = screen.getAllByRole("button", { name: "離開" });
      await user.click(buttons[1]);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
    });

    it("指定 key 且該 key 有變更時會提示", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form guardKey="service-form" dirty onLeave={onClose} confirmKey="service-form" />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByRole("button", { name: "離開" }));
      expect(screen.getByText("有尚未儲存的變更")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("beforeunload", () => {
    it("有變更時註冊並攔截；沒有變更時不註冊", () => {
      const { rerender } = render(
        <UnsavedChangesProvider>
          <Form dirty={false} onLeave={vi.fn()} />
        </UnsavedChangesProvider>,
      );
      expect(fireBeforeUnload().defaultPrevented).toBe(false);

      rerender(
        <UnsavedChangesProvider>
          <Form dirty onLeave={vi.fn()} />
        </UnsavedChangesProvider>,
      );
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it("變更改回乾淨（改回原值或儲存成功）後移除處理常式", () => {
      const add = vi.spyOn(window, "addEventListener");
      const remove = vi.spyOn(window, "removeEventListener");
      const { rerender } = render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={vi.fn()} />
        </UnsavedChangesProvider>,
      );
      expect(add.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(1);
      expect(fireBeforeUnload().defaultPrevented).toBe(true);

      rerender(
        <UnsavedChangesProvider>
          <Form dirty={false} onLeave={vi.fn()} />
        </UnsavedChangesProvider>,
      );
      expect(remove.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(1);
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });

    it("表單卸載但 Provider 仍在：dirty 被清除、不再提示", () => {
      function Page({ show }: { show: boolean }) {
        return <UnsavedChangesProvider>{show ? <Form dirty onLeave={vi.fn()} /> : <span>別頁</span>}</UnsavedChangesProvider>;
      }
      const { rerender } = render(<Page show />);
      expect(fireBeforeUnload().defaultPrevented).toBe(true);

      rerender(<Page show={false} />);
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });
  });

  describe("guardNavigate（next/link 的 onNavigate）", () => {
    it("沒有變更：不攔截，也不提示", async () => {
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty={false} onLeave={vi.fn()} />
          <NavLink href="/admin/services" />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByText("前往 /admin/services"));
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("目標等於目前路徑：不攔截（沒有實際導覽）", async () => {
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={vi.fn()} />
          <NavLink href="/admin/booking-policy" />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByText("前往 /admin/booking-policy"));
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
    });

    it("有變更且目標不同：攔截並提示；「繼續編輯」不導覽", async () => {
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={vi.fn()} />
          <NavLink href="/admin/services" />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByText("前往 /admin/services"));
      expect(screen.getByText("有尚未儲存的變更")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "繼續編輯" }));
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("「放棄變更」：router.push 到目標；導覽進行中 beforeunload 不再提示（leavingRef），路徑改變後恢復", async () => {
      const user = userEvent.setup();
      // 每次 rerender 都要產生新的 element：傳同一個 element 物件，React 會直接跳過重繪，
      // 被 mock 的 usePathname 就沒機會重新讀取（真實應用裡 usePathname 靠 context 觸發重繪）。
      const tree = () => (
        <UnsavedChangesProvider>
          <Form dirty onLeave={vi.fn()} />
          <NavLink href="/admin/services" />
        </UnsavedChangesProvider>
      );
      const { rerender } = render(tree());

      await user.click(screen.getByText("前往 /admin/services"));
      await user.click(screen.getByRole("button", { name: "放棄變更" }));
      expect(nav.push).toHaveBeenCalledWith("/admin/services");

      // 導覽進行中（新頁面尚未 commit）：就算 Next 退回整頁導覽，也不再跳第二次原生提示。
      expect(fireBeforeUnload().defaultPrevented).toBe(false);

      // 路徑改變（導覽完成）後解除「離開中」：新頁面上的新表單 dirty 時會再提示。
      nav.pathname = "/admin/services";
      rerender(tree());
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it("離開中（放棄變更後、導覽完成前）再點另一個連結不會重複提示", async () => {
      const user = userEvent.setup();
      render(
        <UnsavedChangesProvider>
          <Form dirty onLeave={vi.fn()} />
          <NavLink href="/admin/services" />
          <NavLink href="/admin/account" />
        </UnsavedChangesProvider>,
      );

      await user.click(screen.getByText("前往 /admin/services"));
      await user.click(screen.getByRole("button", { name: "放棄變更" }));
      await user.click(screen.getByText("前往 /admin/account"));
      expect(screen.queryByText("有尚未儲存的變更")).not.toBeInTheDocument();
    });
  });

  describe("useIsUnsavedDirty（反應式）", () => {
    it("跟隨指定 key 的狀態；A 已 dirty 時 B 才變 dirty，B 的讀取者仍會更新", () => {
      function Harness({ aDirty, bDirty }: { aDirty: boolean; bDirty: boolean }) {
        return (
          <UnsavedChangesProvider>
            <Form guardKey="a" dirty={aDirty} onLeave={vi.fn()} />
            <Form guardKey="b" dirty={bDirty} onLeave={vi.fn()} />
            <DirtyDot watchKey="a" />
            <DirtyDot watchKey="b" />
          </UnsavedChangesProvider>
        );
      }
      const { rerender } = render(<Harness aDirty={false} bDirty={false} />);
      expect(screen.getByTestId("dot-a")).toHaveTextContent("clean");
      expect(screen.getByTestId("dot-b")).toHaveTextContent("clean");

      rerender(<Harness aDirty bDirty={false} />);
      expect(screen.getByTestId("dot-a")).toHaveTextContent("dirty");
      expect(screen.getByTestId("dot-b")).toHaveTextContent("clean");

      rerender(<Harness aDirty bDirty />);
      expect(screen.getByTestId("dot-b")).toHaveTextContent("dirty");

      rerender(<Harness aDirty={false} bDirty />);
      expect(screen.getByTestId("dot-a")).toHaveTextContent("clean");
      expect(screen.getByTestId("dot-b")).toHaveTextContent("dirty");
    });
  });

  describe("StrictMode 與 key 交接", () => {
    it("StrictMode 的 設定→清除→設定 之後狀態正確（有變更仍提示、乾淨不提示）", async () => {
      const user = userEvent.setup();
      const onLeave = vi.fn();
      render(
        <React.StrictMode>
          <UnsavedChangesProvider>
            <Form dirty onLeave={onLeave} />
          </UnsavedChangesProvider>
        </React.StrictMode>,
      );
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
      await user.click(screen.getByRole("button", { name: "離開" }));
      expect(screen.getByText("有尚未儲存的變更")).toBeInTheDocument();
    });

    it("兩個頁面先後使用同一個 key（舊頁卸載、新頁掛載）不會互相蓋掉", () => {
      function Page({ which }: { which: "old" | "new" }) {
        return (
          <UnsavedChangesProvider>
            {which === "old" ? <Form key="old" dirty onLeave={vi.fn()} /> : <Form key="new" dirty onLeave={vi.fn()} />}
          </UnsavedChangesProvider>
        );
      }
      const { rerender } = render(<Page which="old" />);
      rerender(<Page which="new" />);
      act(() => {});
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });
  });
});
