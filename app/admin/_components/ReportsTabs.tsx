"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";

// 「儀表板｜報表」頁籤殼：頁籤列＋兩個頁籤共用的 controls 區（工具列、設計師篩選）＋內容區。
// 受控元件：目前頁籤由容器持有，切換時 controls 與其中的狀態（期間、篩選）完全不動，只換 children。
// 方向鍵切換（selectionFollowsFocus）：MUI Tabs 本身是 roving tabindex，方向鍵移動焦點時同時選取。

export type ReportsTabValue = "dashboard" | "table";

const TAB_LABELS: Record<ReportsTabValue, string> = { dashboard: "儀表板", table: "報表" };

export const REPORTS_TABPANEL_ID = "reports-tabpanel";

export function reportsTabId(value: ReportsTabValue): string {
  return `reports-tab-${value}`;
}

export type ReportsTabsProps = {
  value: ReportsTabValue;
  onChange: (value: ReportsTabValue) => void;
  // 兩個頁籤共用的控制區（工具列、設計師篩選），位在頁籤列與內容區之間，不屬於 tabpanel。
  controls?: React.ReactNode;
  // 目前頁籤的內容（容器依 value 決定渲染哪個面板）。
  children: React.ReactNode;
};

export function ReportsTabs({ value, onChange, controls, children }: ReportsTabsProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Tabs
        value={value}
        onChange={(_event, next: ReportsTabValue) => onChange(next)}
        selectionFollowsFocus
        aria-label="儀表板與報表"
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        {(Object.keys(TAB_LABELS) as ReportsTabValue[]).map((tab) => (
          <Tab
            key={tab}
            value={tab}
            label={TAB_LABELS[tab]}
            id={reportsTabId(tab)}
            aria-controls={REPORTS_TABPANEL_ID}
            sx={{ px: 6, fontSize: 16 }}
          />
        ))}
      </Tabs>

      {controls}

      <Box role="tabpanel" id={REPORTS_TABPANEL_ID} aria-labelledby={reportsTabId(value)} tabIndex={-1} sx={{ outline: "none" }}>
        {children}
      </Box>
    </Box>
  );
}
