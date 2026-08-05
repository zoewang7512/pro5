import * as React from "react";
import { render } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";

// 測試環境關閉 ripple：MUI 的 touch ripple 用 setTimeout 觸發，常在 jsdom 環境
// teardown 後才 fire，造成 "window is not defined" 的 unhandled error（非測試斷言失敗，
// 但會污染輸出）。
// Dialog/Modal 的 enter transition 也用 setTimeout；同理在測試中關閉，避免動畫計時器
// 在元件已 unmount、jsdom teardown 後才觸發。
const testTheme = createTheme({
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiDialog: { defaultProps: { transitionDuration: 0 } },
  },
});

export function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>);
}

export * from "@testing-library/react";
