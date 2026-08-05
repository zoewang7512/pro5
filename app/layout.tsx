import type { Metadata } from "next";
import { Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";
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
    <html lang="zh-Hant" className={`${notoSans.variable} ${notoSerif.variable}`}>
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
