// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import { ReportsTabs, type ReportsTabValue } from "@/app/admin/_components/ReportsTabs";

// 模擬容器（TASK-092）：頁籤與控制區的 state 都在父層，這裡驗證切頁籤不會讓它們消失或重置。
function Harness({ initial = "dashboard", onChange }: { initial?: ReportsTabValue; onChange?: (v: ReportsTabValue) => void }) {
  const [tab, setTab] = React.useState<ReportsTabValue>(initial);
  const [note, setNote] = React.useState("");
  return (
    <ReportsTabs
      value={tab}
      onChange={(next) => {
        onChange?.(next);
        setTab(next);
      }}
      controls={<input aria-label="共用控制" value={note} onChange={(event) => setNote(event.target.value)} />}
    >
      {tab === "dashboard" ? <div>儀表板內容</div> : <div>報表內容</div>}
    </ReportsTabs>
  );
}

describe("ReportsTabs", () => {
  afterEach(() => cleanup());

  it("有「儀表板」「報表」兩個頁籤，預設選取儀表板；頁籤列有名稱", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "儀表板與報表" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["儀表板", "報表"]);
    expect(screen.getByRole("tab", { name: "儀表板" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "報表" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("儀表板內容")).toBeInTheDocument();
    expect(screen.queryByText("報表內容")).toBeNull();
  });

  it("內容區是 tabpanel，由目前選取的頁籤命名並互相對應", () => {
    render(<Harness />);
    const panel = screen.getByRole("tabpanel", { name: "儀表板" });
    expect(screen.getByRole("tab", { name: "儀表板" })).toHaveAttribute("aria-controls", panel.id);
  });

  it("點「報表」：回報切換，內容換成報表，tabpanel 改由「報表」命名", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "報表" }));
    expect(onChange).toHaveBeenCalledWith("table");
    expect(screen.getByText("報表內容")).toBeInTheDocument();
    expect(screen.queryByText("儀表板內容")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "報表" })).toBeInTheDocument();
  });

  it("鍵盤：焦點在已選取的頁籤上，左右方向鍵切換並選取（Home／End 到首尾）", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness />);

    await user.tab();
    expect(screen.getByRole("tab", { name: "儀表板" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "報表" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "報表" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("報表內容")).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "儀表板" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "報表" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "儀表板" })).toHaveFocus();
  });

  it("只有目前選取的頁籤是 tab stop（roving tabindex）", () => {
    render(<Harness initial="table" />);
    expect(screen.getByRole("tab", { name: "報表" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "儀表板" })).toHaveAttribute("tabindex", "-1");
  });

  it("切換頁籤不遺失控制區與其內容（同一個 DOM 節點、輸入沒被清掉）", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness />);

    const input = screen.getByLabelText("共用控制");
    await user.type(input, "林小美");
    await user.click(screen.getByRole("tab", { name: "報表" }));
    await user.click(screen.getByRole("tab", { name: "儀表板" }));

    expect(screen.getByLabelText("共用控制")).toBe(input);
    expect(input).toHaveValue("林小美");
  });

  it("控制區位在頁籤列與內容區之間，且不在 tabpanel 內", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist");
    const controls = screen.getByLabelText("共用控制");
    const panel = screen.getByRole("tabpanel");
    expect(tablist.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.contains(controls)).toBe(false);
  });

  it("沒給 controls 也能運作", () => {
    render(
      <ReportsTabs value="dashboard" onChange={() => {}}>
        <div>x</div>
      </ReportsTabs>,
    );
    expect(screen.getByText("x")).toBeInTheDocument();
  });
});
