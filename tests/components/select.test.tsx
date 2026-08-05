// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithTheme as render } from "../test-utils";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";

function ServiceSelect() {
  const [value, setValue] = React.useState("cut");
  return (
    <Select
      aria-label="服務項目"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    >
      <MenuItem value="cut">剪髮造型</MenuItem>
      <MenuItem value="color">染髮設計</MenuItem>
      <MenuItem value="scalp">頭皮護理</MenuItem>
    </Select>
  );
}

describe("Select（服務項目選取）", () => {
  it("預設顯示第一個選項，點選後切換為新選項", async () => {
    const user = userEvent.setup();
    render(<ServiceSelect />);

    const trigger = screen.getByRole("combobox", { name: "服務項目" });
    expect(trigger).toHaveTextContent("剪髮造型");

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "染髮設計" }));

    expect(screen.getByRole("combobox", { name: "服務項目" })).toHaveTextContent("染髮設計");
  });
});
