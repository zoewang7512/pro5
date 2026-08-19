// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithTheme as render } from "../test-utils";
import { OtpInput, distributeOtpPaste, OTP_LENGTH } from "@/components/ui/OtpInput";

afterEach(cleanup);

describe("distributeOtpPaste", () => {
  it("擷取貼上內容中的數字，截斷到指定長度", () => {
    expect(distributeOtpPaste("481212")).toEqual(["4", "8", "1", "2", "1", "2"]);
  });

  it("忽略非數字字元", () => {
    expect(distributeOtpPaste("48-121 2")).toEqual(["4", "8", "1", "2", "1", "2"]);
  });

  it("超過長度時截斷", () => {
    expect(distributeOtpPaste("12345678")).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("不足長度時回傳實際擷取到的位數", () => {
    expect(distributeOtpPaste("48")).toEqual(["4", "8"]);
  });

  it("空字串回傳空陣列", () => {
    expect(distributeOtpPaste("")).toEqual([]);
  });

  it("可傳入自訂長度", () => {
    expect(distributeOtpPaste("1234", 4)).toEqual(["1", "2", "3", "4"]);
  });
});

function getBoxes() {
  return screen.getAllByLabelText(/驗證碼第 \d 碼/);
}

describe("OtpInput", () => {
  it("渲染 6 格獨立輸入框", () => {
    render(<OtpInput value="" onChange={vi.fn()} />);
    expect(getBoxes()).toHaveLength(OTP_LENGTH);
  });

  it("value prop 依序分配到各格", () => {
    render(<OtpInput value="481" onChange={vi.fn()} />);
    const boxes = getBoxes();
    expect(boxes[0]).toHaveValue("4");
    expect(boxes[1]).toHaveValue("8");
    expect(boxes[2]).toHaveValue("1");
    expect(boxes[3]).toHaveValue("");
  });

  it("輸入單一數字時呼叫 onChange 帶入更新後的完整字串", () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);

    fireEvent.change(getBoxes()[0], { target: { value: "4" } });

    expect(onChange).toHaveBeenCalledWith("4");
  });

  it("輸入數字後自動 focus 下一格", () => {
    render(<OtpInput value="" onChange={vi.fn()} />);
    const boxes = getBoxes();

    fireEvent.change(boxes[0], { target: { value: "4" } });

    expect(boxes[1]).toHaveFocus();
  });

  it("在空格按 Backspace 時 focus 回上一格", () => {
    render(<OtpInput value="4" onChange={vi.fn()} />);
    const boxes = getBoxes();

    fireEvent.keyDown(boxes[1], { key: "Backspace" });

    expect(boxes[0]).toHaveFocus();
  });

  it("貼上完整驗證碼時分配到各格並呼叫 onChange", () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);
    const boxes = getBoxes();

    fireEvent.paste(boxes[0], { clipboardData: { getData: () => "481212" } });

    expect(onChange).toHaveBeenCalledWith("481212");
  });

  it("error 為 true 時每格輸入框皆標示錯誤狀態", () => {
    render(<OtpInput value="" onChange={vi.fn()} error />);
    getBoxes().forEach((box) => {
      expect(box).toHaveAttribute("aria-invalid", "true");
    });
  });

  it("disabled 為 true 時每格輸入框皆停用", () => {
    render(<OtpInput value="" onChange={vi.fn()} disabled />);
    getBoxes().forEach((box) => {
      expect(box).toBeDisabled();
    });
  });
});
