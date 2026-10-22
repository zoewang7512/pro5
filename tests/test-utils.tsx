import * as React from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";

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

// 給 RTL render 的 { wrapper } 選項用：renderWithTheme 回傳的 rerender(ui) 會把整棵樹（含 ThemeProvider
// 以外你自己放進 ui 的 Provider）換掉重新掛載；需要「rerender 但保留 Provider 與其內部狀態」的測試
// （例如 TASK-081 的 UnsavedChangesProvider）改用 render(ui, { wrapper: TestThemeWrapper })。
export function TestThemeWrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={testTheme}>{children}</ThemeProvider>;
}

export function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={testTheme}>{ui}</ThemeProvider>);
}

// next/link 在點擊時有 `if (!router) return;`：沒有 router context（測試環境預設如此）時，
// 連 onClick／onNavigate 都不會走到。需要驗證 Link 導覽相關行為（TASK-081 的 onNavigate 攔截）時，
// 用這個 helper 提供最小的 router context，並回傳 mock router 方便斷言。
// 注意：vitest 裡 `next/link` 解析到的是 Pages Router 實作（dist/client/link.js，讀 RouterContext），
// 而正式建置時 Next 會把 App Router 專案的 next/link 換成 app-dir 實作（讀 AppRouterContext）。
// 兩者對 onNavigate 的語意相同，所以兩個 context 都提供；真正的 app-dir 行為以 Browser 走查為準。
export function renderWithAppRouter(ui: React.ReactElement) {
  const router = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(() => Promise.resolve()),
  };
  const result = render(
    <ThemeProvider theme={testTheme}>
      <RouterContext.Provider value={router as never}>
        <AppRouterContext.Provider value={router as never}>{ui}</AppRouterContext.Provider>
      </RouterContext.Provider>
    </ThemeProvider>,
  );
  return { ...result, router };
}

export * from "@testing-library/react";
