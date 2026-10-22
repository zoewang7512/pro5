// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { SuccessSection } from "@/app/_components/booking/SuccessSection";
import type { AppointmentConfirmation } from "@/lib/booking/types";

afterEach(cleanup);

const confirmation: AppointmentConfirmation = {
  service_name: "剪髮造型",
  start_at: "2026-10-23T02:00:00+00:00",
  end_at: "2026-10-23T03:00:00+00:00",
  customer_name: "王小美",
  customer_phone: "0912345678",
  designer_id: "designer-1",
  designer_name: "林小美",
};

describe("SuccessSection 的設計師顯示", () => {
  it("指定設計師：顯示設計師列（名字），沒有「不指定」說明", () => {
    render(<SuccessSection confirmation={confirmation} designer={{ name: "林小美", avatarUrl: null }} requestedAny={false} />);
    expect(screen.getByText("設計師")).toBeInTheDocument();
    expect(screen.getByText("林小美")).toBeInTheDocument();
    expect(screen.queryByText(/你選擇了「不指定設計師」/)).not.toBeInTheDocument();
  });

  it("不指定：加一行說明，帶出系統安排的設計師名字", () => {
    render(<SuccessSection confirmation={confirmation} designer={{ name: "林小美", avatarUrl: null }} requestedAny />);
    expect(screen.getByText("你選擇了「不指定設計師」，系統已為你安排林小美。")).toBeInTheDocument();
  });

  it("沒有頭像網址時退回名字首字", () => {
    render(<SuccessSection confirmation={confirmation} designer={{ name: "林小美", avatarUrl: null }} requestedAny={false} />);
    expect(screen.getByText("林")).toBeInTheDocument();
  });

  it("回傳沒有設計師名字（designer 為 null）：不顯示設計師列與說明，其他欄位照常顯示", () => {
    render(<SuccessSection confirmation={confirmation} designer={null} requestedAny />);
    expect(screen.queryByText("設計師")).not.toBeInTheDocument();
    expect(screen.queryByText(/你選擇了/)).not.toBeInTheDocument();
    expect(screen.getByText("剪髮造型")).toBeInTheDocument();
    expect(screen.getByText("王小美")).toBeInTheDocument();
  });

  it("設計師名字當成純文字渲染，不解析 HTML", () => {
    const { container } = render(
      <SuccessSection confirmation={confirmation} designer={{ name: "<img src=x onerror=alert(1)>", avatarUrl: null }} requestedAny={false} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});
