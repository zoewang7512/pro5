import { createTheme } from "@mui/material/styles";
import { colorPrimitive, motion, radius, shadow, spacingScale, typeScale, zIndex } from "./tokens";

const fontFamilySans =
  'var(--font-noto-sans), "PingFang TC", "Microsoft JhengHei", -apple-system, BlinkMacSystemFont, sans-serif';
const fontFamilySerif =
  'var(--font-noto-serif), "PingFang TC", "Microsoft JhengHei", serif';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
  spacing: spacingScale[0], // spacingScale[0] = 4 → theme.spacing(1) = 4px，對齊 4 的倍數間距 scale
  shape: { borderRadius: radius.sm },
  colorSchemes: {
    light: {
      palette: {
        mode: "light",
        primary: {
          light: colorPrimitive.primary[300],
          main: colorPrimitive.primary[500],
          dark: colorPrimitive.primary[700],
          contrastText: "#FFFFFF",
        },
        grey: colorPrimitive.grey,
        success: colorPrimitive.success,
        warning: colorPrimitive.warning,
        error: colorPrimitive.danger,
        info: colorPrimitive.info,
        background: { default: colorPrimitive.grey[100], paper: "#FFFFFF" },
        text: {
          primary: colorPrimitive.grey[900],
          secondary: colorPrimitive.grey[700],
          disabled: colorPrimitive.grey[500],
        },
        divider: colorPrimitive.grey[300],
      },
    },
    dark: {
      palette: {
        mode: "dark",
        primary: { light: "#E4C177", main: "#D4A84B", dark: "#A9812F", contrastText: "#201C18" },
        background: { default: "#201C18", paper: "#2A241F" },
        text: { primary: "#F3EEE6", secondary: "#C9BFB1", disabled: "#8A8074" },
        divider: "#423A31",
      },
    },
  },
  typography: {
    fontFamily: fontFamilySans,
    fontWeightRegular: typeScale.fontWeight.regular,
    fontWeightMedium: typeScale.fontWeight.medium,
    fontWeightBold: typeScale.fontWeight.bold,
    h1: { fontFamily: fontFamilySerif, fontSize: typeScale.fontSize["5xl"], fontWeight: typeScale.fontWeight.bold, lineHeight: typeScale.lineHeight.heading, letterSpacing: 0 },
    h2: { fontFamily: fontFamilySerif, fontSize: typeScale.fontSize["4xl"], fontWeight: typeScale.fontWeight.bold, lineHeight: typeScale.lineHeight.heading, letterSpacing: 0 },
    h3: { fontSize: typeScale.fontSize["3xl"], fontWeight: typeScale.fontWeight.bold, lineHeight: typeScale.lineHeight.heading, letterSpacing: 0 },
    h4: { fontSize: typeScale.fontSize["2xl"], fontWeight: typeScale.fontWeight.semibold, lineHeight: typeScale.lineHeight.heading, letterSpacing: 0 },
    h5: { fontSize: typeScale.fontSize.xl, fontWeight: typeScale.fontWeight.semibold, lineHeight: typeScale.lineHeight.subheading, letterSpacing: 0 },
    h6: { fontSize: typeScale.fontSize.lg, fontWeight: typeScale.fontWeight.semibold, lineHeight: typeScale.lineHeight.subheading, letterSpacing: 0 },
    subtitle1: { fontSize: typeScale.fontSize.md, fontWeight: typeScale.fontWeight.medium, lineHeight: typeScale.lineHeight.subheading, letterSpacing: 0 },
    subtitle2: { fontSize: typeScale.fontSize.base, fontWeight: typeScale.fontWeight.medium, lineHeight: typeScale.lineHeight.subheading, letterSpacing: 0 },
    body1: { fontSize: typeScale.fontSize.md, fontWeight: typeScale.fontWeight.regular, lineHeight: typeScale.lineHeight.body, letterSpacing: 0 },
    body2: { fontSize: typeScale.fontSize.base, fontWeight: typeScale.fontWeight.regular, lineHeight: typeScale.lineHeight.body, letterSpacing: 0 },
    button: { fontSize: typeScale.fontSize.base, fontWeight: typeScale.fontWeight.semibold, lineHeight: typeScale.lineHeight.dense, letterSpacing: 0, textTransform: "none" },
    caption: { fontSize: typeScale.fontSize.sm, fontWeight: typeScale.fontWeight.regular, lineHeight: typeScale.lineHeight.dense, letterSpacing: 0 },
    overline: { fontSize: typeScale.fontSize.xs, fontWeight: typeScale.fontWeight.semibold, lineHeight: typeScale.lineHeight.dense, letterSpacing: 0, textTransform: "none" },
  },
  // MUI 內建 duration/easing 沿用其 slot 名稱，只填入我們的 token 值，不另立新抽象。
  transitions: {
    duration: {
      shortest: motion.duration.short,
      shorter: motion.duration.short,
      short: motion.duration.base,
      standard: motion.duration.base,
      complex: motion.duration.long,
      enteringScreen: motion.duration.base,
      leavingScreen: motion.duration.short,
    },
    easing: {
      easeInOut: motion.easing.standard,
      easeOut: motion.easing.decelerate,
      easeIn: motion.easing.accelerate,
      sharp: motion.easing.standard,
    },
  },
  zIndex: {
    appBar: zIndex.appBar,
    drawer: zIndex.drawer,
    modal: zIndex.modal,
    snackbar: zIndex.snackbar,
    tooltip: zIndex.tooltip,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { borderRadius: radius.md, backgroundImage: "none" },
        elevation1: { boxShadow: shadow.light.elevation1 },
      },
    },
    MuiCard: {
      styleOverrides: { root: { borderRadius: radius.md, boxShadow: shadow.light.elevation1 } },
    },
    MuiButton: {
      styleOverrides: { root: { borderRadius: radius.sm } },
    },
  },
});
