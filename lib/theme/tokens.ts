/**
 * Design token 原始值（primitive）。單一事實來源見 ai/context/design-system.md 的 S3 章節；
 * 這裡的每個數值都對應該文件的表格，異動請兩邊同步更新。
 */

export const colorPrimitive = {
  grey: {
    50: "#FBF9F6",
    100: "#F6F3EE",
    200: "#EFEAE2",
    300: "#E4DDD1",
    400: "#CFC5B6",
    500: "#A79E92",
    600: "#8C8276",
    700: "#6B6259",
    800: "#4A433C",
    900: "#2B2622",
  },
  primary: {
    50: "#FBF4E2",
    100: "#F3E2B8",
    200: "#E9CD87",
    300: "#DDB55A",
    400: "#C89F3E",
    500: "#A9812F",
    600: "#8C6A26",
    700: "#6F531E",
    800: "#523D16",
    900: "#38290F",
  },
  success: { light: "#E4EBE1", main: "#7A8B76", dark: "#57644F", contrastText: "#FFFFFF" },
  warning: { light: "#F6E8D6", main: "#C97A3D", dark: "#9C5C29", contrastText: "#FFFFFF" },
  danger: { light: "#F3DEDA", main: "#B3462E", dark: "#8A3320", contrastText: "#FFFFFF" },
  info: { light: "#E1E8ED", main: "#5B7C99", dark: "#43617A", contrastText: "#FFFFFF" },
} as const;

/** 中文字距一律 0（design-craft 規則）；字級只用下列 scale。 */
export const typeScale = {
  fontSize: {
    xs: 11,
    sm: 12,
    "sm+": 13,
    base: 14,
    md: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
    "4xl": 36,
    "5xl": 48,
  },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { heading: 1.25, subheading: 1.3, body: 1.7, dense: 1.5 },
  letterSpacing: 0,
} as const;

/** 4 的倍數間距 scale（design-craft 規則）；MUI theme.spacing(1) = 4px。 */
export const spacingScale = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

export const spacingSemantic = {
  pagePaddingMobile: 24,
  pagePaddingDesktop: 40,
  cardPadding: 24,
};

export const radius = {
  sm: 8, // 按鈕、輸入框
  md: 12, // 卡片、Modal、Surface
} as const;

/** Depth 只用陰影（S2 選定變體 A：shadow-only，不疊邊框）。 */
export const shadow = {
  light: {
    elevation1: "0 8px 24px rgba(43,38,34,0.10), 0 2px 6px rgba(43,38,34,0.06)",
    elevation2: "0 16px 40px rgba(43,38,34,0.16), 0 4px 10px rgba(43,38,34,0.08)",
  },
  dark: {
    elevation1: "0 8px 24px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.25)",
    elevation2: "0 16px 40px rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.30)",
  },
} as const;

/** 沿用 MUI 預設 z-index scale，避免另立一套並造成疊層混亂。 */
export const zIndex = {
  appBar: 1100,
  drawer: 1200,
  modal: 1300,
  snackbar: 1400,
  tooltip: 1500,
} as const;

/** 沿用 MUI 預設 motion curve；duration 依 design-craft 精神收斂為三檔。 */
export const motion = {
  duration: { short: 150, base: 200, long: 300 },
  easing: {
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    decelerate: "cubic-bezier(0.0, 0, 0.2, 1)",
    accelerate: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;
