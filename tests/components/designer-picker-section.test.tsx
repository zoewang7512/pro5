// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { DesignerPickerSection, DESIGNER_STEP_ID } from "@/app/_components/booking/DesignerPickerSection";
import { ANY_DESIGNER } from "@/lib/booking/booking-flow-state";
import type { DesignerSelection, PublicDesigner } from "@/lib/booking/types";

afterEach(cleanup);

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

const mei = makeDesigner("mei", {
  name: "林小美",
  bio: "第一行\n第二行 <b>不是 HTML</b>",
  specialties: ["韓系剪髮", "漸層染"],
  portfolio: Array.from({ length: 6 }, (_, i) => ({
    id: `img${i}`,
    image_url: `https://project-ref.supabase.co/storage/v1/object/public/designer-assets/portfolio/mei/${i}.webp`,
    created_at: `2026-10-0${i + 1}`,
  })),
});
const jie = makeDesigner("jie", { name: "陳阿傑" });

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

  it("「看完整作品集 ›」本卡不做任何事（TASK-074 接上），點了也不會改變選擇", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSection({}, { kind: "designer", designer: mei });
    await user.click(screen.getByText("看完整作品集 ›"));
    expect(onSelect).not.toHaveBeenCalled();
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
