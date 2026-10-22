// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerPickerSection, DESIGNER_STEP_ID } from "@/app/_components/booking/DesignerPickerSection";
import { ANY_DESIGNER } from "@/lib/booking/booking-flow-state";
import type { DesignerSelection, PublicDesigner } from "@/lib/booking/types";

const MEI_ID = "11111111-1111-4111-8111-111111111111";
const JIE_ID = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_ID = "33333333-3333-4333-8333-333333333333";

// jsdom 的 window.history 在同一個測試檔內共用，每個測試前重置。
beforeEach(() => {
  window.history.replaceState(null, "");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeDesigner(id: string, overrides: Partial<PublicDesigner> = {}): PublicDesigner {
  return {
    id,
    name: `設計師${id}`,
    bio: null,
    specialties: [],
    instagram_handle: null,
    avatar_url: null,
    sort_order: 0,
    portfolio: [],
    ...overrides,
  };
}

const mei = makeDesigner(MEI_ID, {
  name: "林小美",
  bio: "第一行\n第二行 <b>不是 HTML</b>",
  specialties: ["韓系剪髮", "漸層染"],
  portfolio: Array.from({ length: 6 }, (_, i) => ({
    id: `img${i}`,
    image_url: `https://project-ref.supabase.co/storage/v1/object/public/designer-assets/portfolio/mei/${i}.webp`,
    created_at: `2026-10-0${i + 1}`,
  })),
});
const jie = makeDesigner(JIE_ID, { name: "陳阿傑" });

function renderSection(
  props: Partial<React.ComponentProps<typeof DesignerPickerSection>> = {},
  selection: DesignerSelection = ANY_DESIGNER,
) {
  const onSelect = vi.fn();
  const onEdit = vi.fn();
  const view = render(
    <DesignerPickerSection
      status="loaded"
      designers={[mei, jie]}
      selection={selection}
      collapsed={false}
      onSelect={onSelect}
      onEdit={onEdit}
      {...props}
    />,
  );
  return { onSelect, onEdit, ...view };
}

describe("DesignerPickerSection", () => {
  it("預設：「不指定」排第一且被選取，預覽卡顯示說明文字，沒有作品集連結", () => {
    renderSection();

    const buttons = screen.getAllByRole("button", { pressed: undefined });
    expect(buttons[0]).toHaveAccessibleName(/不指定/);
    expect(screen.getByRole("button", { name: /不指定/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("不指定設計師")).toBeInTheDocument();
    expect(screen.getByText(/送出預約後由系統安排一位有空的設計師/)).toBeInTheDocument();
    expect(screen.queryByText(/看完整作品集/)).not.toBeInTheDocument();
  });

  it("選取設計師：預覽卡顯示簡介（純文字，不解析 HTML）、專長標籤、前 4 張作品與「看完整作品集 ›」", () => {
    const { container } = renderSection({}, { kind: "designer", designer: mei });

    expect(screen.getByRole("button", { name: /林小美/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/第一行/)).toHaveTextContent("<b>不是 HTML</b>");
    expect(container.querySelector("section b")).toBeNull();
    expect(screen.getByText("韓系剪髮")).toBeInTheDocument();
    expect(screen.getByText("漸層染")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByText("看完整作品集 ›")).toBeInTheDocument();
  });

  it("作品圖帶 no-referrer、lazy；載入失敗後移除 <img>，保留底色格子", () => {
    renderSection({}, { kind: "designer", designer: mei });

    const [first] = screen.getAllByRole("img");
    expect(first).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(first).toHaveAttribute("loading", "lazy");
    fireEvent.error(first);
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("沒有作品、沒有簡介、沒有專長時不畫對應區塊", () => {
    renderSection({}, { kind: "designer", designer: jie });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("韓系剪髮")).not.toBeInTheDocument();
  });

  it("點頭像用 onSelect 回傳完整的設計師物件；點「不指定」回傳 any", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSection({}, { kind: "designer", designer: mei });

    await user.click(screen.getByRole("button", { name: /陳阿傑/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "designer", designer: jie });

    await user.click(screen.getByRole("button", { name: /不指定/ }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "any" });
  });

  it("載入中：骨架屏，沒有頭像列", () => {
    renderSection({ status: "loading", designers: [] });
    expect(screen.getByLabelText("設計師載入中")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "選擇設計師" })).not.toBeInTheDocument();
  });

  it("載入失敗：錯誤 Alert，沒有頭像列", () => {
    renderSection({ status: "error", designers: [] });
    expect(screen.getByRole("alert")).toHaveTextContent("無法載入設計師名單，請重新整理頁面再試一次。");
    expect(screen.queryByRole("group", { name: "選擇設計師" })).not.toBeInTheDocument();
  });

  it("空名單：資訊提示請顧客改選其他服務", () => {
    renderSection({ status: "loaded", designers: [] });
    expect(screen.getByRole("alert")).toHaveTextContent("目前沒有設計師提供這項服務，請選擇其他服務。");
  });

  it("收合：摘要列顯示選擇結果與「修改」，點修改呼叫 onEdit；最外層有固定 id", async () => {
    const user = userEvent.setup();
    const { onEdit, container, rerender } = renderSection({ collapsed: true }, { kind: "designer", designer: mei });

    expect(screen.getByText("林小美")).toBeInTheDocument();
    expect(container.querySelector(`#${DESIGNER_STEP_ID}`)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "修改" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    rerender(
      <DesignerPickerSection
        status="loaded"
        designers={[mei, jie]}
        selection={ANY_DESIGNER}
        collapsed
        onSelect={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText("不指定設計師")).toBeInTheDocument();
  });
});

// 受控版本：測試中途要換 props（名單、收合）時用。直接呼叫 render 的 rerender 會因為少了 ThemeProvider 包裝而重新掛載。
function renderControlled(initial: Partial<React.ComponentProps<typeof DesignerPickerSection>> = {}) {
  type Props = React.ComponentProps<typeof DesignerPickerSection>;
  let setProps!: (patch: Partial<Props>) => void;
  function Harness() {
    const [props, set] = React.useState<Props>({
      status: "loaded",
      designers: [mei, jie],
      selection: ANY_DESIGNER,
      collapsed: false,
      onSelect: () => {},
      onEdit: () => {},
      ...initial,
    });
    setProps = (patch) => set((prev) => ({ ...prev, ...patch }));
    return <DesignerPickerSection {...props} />;
  }
  const view = render(<Harness />);
  return { ...view, update: (patch: Partial<Props>) => act(() => setProps(patch)) };
}

function openProfile() {
  fireEvent.click(screen.getByText("看完整作品集 ›"));
}

function profileDialog() {
  return screen.queryByRole("dialog");
}

async function waitForClosed() {
  await waitFor(() => expect(profileDialog()).not.toBeInTheDocument());
}

function dispatchPopState(state: unknown) {
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
}

describe("DesignerPickerSection 全頁個人頁與瀏覽器歷史紀錄", () => {
  it("開啟：pushState 一次（只有 state 與空標題，沒有 url），state 只含設計師 id 與 session 值；不改變目前的選擇", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const { onSelect } = renderSection({}, { kind: "designer", designer: mei });

    expect(profileDialog()).not.toBeInTheDocument();
    openProfile();

    expect(profileDialog()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "選擇林小美" })).toBeInTheDocument();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]).toHaveLength(2);
    expect(pushState.mock.calls[0][0]).toEqual({ designerProfile: MEI_ID, designerProfileSession: expect.any(String) });
    expect(Object.keys(pushState.mock.calls[0][0] as object)).toHaveLength(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("連點兩次「看完整作品集 ›」：第二次改寫同一筆 entry，不再多 push", () => {
    renderSection({}, { kind: "designer", designer: mei });
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");

    openProfile();
    openProfile();

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("AppBar 返回鍵：呼叫 history.back() 一次，popstate 之後才關閉（真的來回一次）", async () => {
    const back = vi.spyOn(window.history, "back");
    renderSection({}, { kind: "designer", designer: mei });
    openProfile();

    fireEvent.click(screen.getByRole("button", { name: "關閉個人頁" }));
    expect(back).toHaveBeenCalledTimes(1);
    await waitForClosed();
    expect(window.history.state).toBeNull();
  });

  it("連點關閉（返回鍵兩次＋Esc）只呼叫一次 back()，不會連退兩頁", async () => {
    const back = vi.spyOn(window.history, "back");
    renderSection({}, { kind: "designer", designer: mei });
    openProfile();

    fireEvent.click(screen.getByRole("button", { name: "關閉個人頁" }));
    fireEvent.click(screen.getByRole("button", { name: "關閉個人頁", hidden: true }));
    fireEvent.keyDown(screen.getByRole("dialog", { hidden: true }), { key: "Escape" });

    expect(back).toHaveBeenCalledTimes(1);
    await waitForClosed();
  });

  it("Esc 與返回鍵走同一條路徑：呼叫 back()，不留下孤兒 entry", async () => {
    const back = vi.spyOn(window.history, "back");
    renderSection({}, { kind: "designer", designer: mei });
    openProfile();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(back).toHaveBeenCalledTimes(1);
    await waitForClosed();
  });

  it("「選擇○○」：onSelect 收到名單裡的同一個物件，關閉流程只跑一次（連點也一樣）", async () => {
    const back = vi.spyOn(window.history, "back");
    const { onSelect } = renderSection({}, { kind: "designer", designer: mei });
    openProfile();

    const choose = screen.getByRole("button", { name: "選擇林小美" });
    fireEvent.click(choose);
    fireEvent.click(choose);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].kind).toBe("designer");
    expect(onSelect.mock.calls[0][0].designer).toBe(mei);
    expect(back).toHaveBeenCalledTimes(1);
    await waitForClosed();
  });

  it("瀏覽器返回鍵（popstate）關閉個人頁；再按「前進」會重新開啟", async () => {
    renderSection({}, { kind: "designer", designer: mei });
    openProfile();

    act(() => window.history.back());
    await waitForClosed();

    act(() => window.history.forward());
    await waitFor(() => expect(profileDialog()).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "選擇林小美" })).toBeInTheDocument();
  });

  it("popstate 的 state 不合格一律關閉、不拋例外、不開錯人", async () => {
    renderSection({}, { kind: "designer", designer: mei });
    openProfile();
    const session = window.history.state.designerProfileSession as string;
    const bad: unknown[] = [
      null,
      5,
      "x",
      [],
      {},
      { designerProfile: 123, designerProfileSession: session },
      { designerProfile: {}, designerProfileSession: session },
      { designerProfile: "__proto__", designerProfileSession: session },
      { designerProfile: "constructor", designerProfileSession: session },
      { designerProfile: "a".repeat(100000), designerProfileSession: session },
      { designerProfile: UNKNOWN_ID, designerProfileSession: session },
      { designerProfile: MEI_ID, designerProfileSession: "old-session" },
      { designerProfile: MEI_ID },
    ];

    for (const state of bad) {
      dispatchPopState({ designerProfile: MEI_ID, designerProfileSession: session });
      await waitFor(() => expect(profileDialog()).toBeInTheDocument());
      expect(() => dispatchPopState(state)).not.toThrow();
      await waitForClosed();
    }
  });

  it("popstate 帶合法 id 與 session，但名單裡沒有這個 id：不開啟；名單內的 id 則開啟", async () => {
    renderSection({}, { kind: "designer", designer: mei });
    openProfile();
    const session = window.history.state.designerProfileSession as string;

    dispatchPopState(null);
    await waitForClosed();

    dispatchPopState({ designerProfile: UNKNOWN_ID, designerProfileSession: session });
    expect(profileDialog()).not.toBeInTheDocument();

    dispatchPopState({ designerProfile: JIE_ID, designerProfileSession: session });
    await waitFor(() => expect(profileDialog()).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "選擇陳阿傑" })).toBeInTheDocument();
  });

  it("重新整理後殘留的舊 entry（session 不符）：掛載時不開啟也不呼叫 back()；之後開啟是新 push，關閉只需一次 back()", async () => {
    window.history.replaceState({ designerProfile: MEI_ID, designerProfileSession: "previous-load" }, "");
    const back = vi.spyOn(window.history, "back");
    const pushState = vi.spyOn(window.history, "pushState");
    renderSection({}, { kind: "designer", designer: mei });

    expect(profileDialog()).not.toBeInTheDocument();
    expect(back).not.toHaveBeenCalled();

    openProfile();
    expect(pushState).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "關閉個人頁" }));
    expect(back).toHaveBeenCalledTimes(1);
    await waitForClosed();
    // 回到舊 entry（session 不符），個人頁維持關閉。
    expect(window.history.state.designerProfileSession).toBe("previous-load");
  });

  it("pushState 拋出例外（例如 iOS 頻率上限）：仍然開啟，關閉時直接關、不呼叫 back()", async () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {
      throw new DOMException("too many calls", "SecurityError");
    });
    const back = vi.spyOn(window.history, "back");
    renderSection({}, { kind: "designer", designer: mei });

    openProfile();
    expect(profileDialog()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "關閉個人頁" }));
    expect(back).not.toHaveBeenCalled();
    await waitForClosed();
  });

  it("名單換掉後找不到這位設計師：當成已關閉，不呼叫 back()", async () => {
    const back = vi.spyOn(window.history, "back");
    const { update } = renderControlled({ selection: { kind: "designer", designer: mei } });
    openProfile();
    expect(profileDialog()).toBeInTheDocument();

    update({ designers: [jie], selection: ANY_DESIGNER });
    await waitForClosed();
    expect(back).not.toHaveBeenCalled();
  });

  it("區塊收合（例如選擇後預約進度往下一步）時，個人頁不會被卸載，也不會重新 push", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const { update } = renderControlled({ selection: { kind: "designer", designer: mei } });
    openProfile();

    update({ collapsed: true });
    expect(screen.getByText("設計師")).toBeInTheDocument();
    expect(profileDialog()).toBeInTheDocument();
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("開關過程沒有網路請求；卸載時移除 popstate 監聽", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderSection({}, { kind: "designer", designer: mei });
    openProfile();

    unmount();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
  });
});
