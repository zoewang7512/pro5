import type { Metadata } from "next";
import { Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { ThemeRegistry } from "@/lib/theme/ThemeRegistry";
import "./globals.css";

const notoSans = Noto_Sans_TC({
  variable: "--font-noto-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});

const notoSerif = Noto_Serif_TC({
  variable: "--font-noto-serif",
  weight: ["500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "理髮廳線上預約系統",
  description: "理髮廳線上預約系統",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className={`${notoSans.variable} ${notoSerif.variable}`}
      // InitColorSchemeScript 在 hydrate 前就直接改寫這個 <html> 的 class（加上 light/dark）
      // 以避免明暗模式閃爍，屬預期的 DOM 竄改，需要 suppressHydrationWarning 才不會被 React
      // 誤判成 hydration mismatch（MUI 官方文件亦要求這個設定）。
      suppressHydrationWarning
    >
      <body>
        <InitColorSchemeScript attribute="class" defaultMode="system" />
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
