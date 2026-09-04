"use client";

import * as React from "react";
import IconButton from "@mui/material/IconButton";
import { useColorScheme } from "@mui/material/styles";

// Variant A（純圖示按鈕）：見 ai/artifacts/專案設置/mockups/theme-toggle-variant-a.html。
// 圖示依「目前模式」顯示切換後的目標（亮色顯示月亮＝可切暗；暗色顯示太陽＝可切亮）。
// 本專案沒有安裝 icon library（@mui/icons-material），沿用 mockup 手繪的 SVG path。

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function ColorModeToggle() {
  const { mode, systemMode, setMode } = useColorScheme();
  // SSR 渲染當下不知道使用者的 localStorage 偏好，mode 會是 undefined；掛載後才知道
  // 實際模式，避免 hydration mismatch（比照 InitColorSchemeScript 官方建議做法）。用
  // useSyncExternalStore 而非 useEffect+setState 取得「是否已在瀏覽器掛載」，避免
  // react-hooks/set-state-in-effect（effect 內同步 setState 會多觸發一次 render）。
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!mounted) return null;

  const resolvedMode = mode === "system" ? systemMode : mode;
  const isDark = resolvedMode === "dark";

  return (
    <IconButton
      size="small"
      onClick={() => setMode(isDark ? "light" : "dark")}
      aria-label={isDark ? "切換為亮色模式" : "切換為暗色模式"}
      title={isDark ? "切換為亮色模式" : "切換為暗色模式"}
      sx={{ width: 32, height: 32, borderRadius: "8px", color: "text.secondary" }}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}
