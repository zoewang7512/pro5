"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatPrice } from "@/lib/admin/format";
import { rankingBarPercent, type RankingRow } from "@/lib/admin/reports-ranking";
import { RANKING_EMPTY_TEXT, formatCount } from "./ReportsStates";
import { ServiceRankingName } from "./ServiceRankingName";

// 儀表板頁籤的熱門服務排行（mockup 變體 B）：名次、服務、橫條（長度＝預約量 ÷ 最大預約量）、預約量、營收。
// 純展示：rows 來自 buildServiceRanking；標題與外框由面板提供。

// 名次｜服務（窄寬度可換行）｜橫條（有最小寬度）｜預約量｜營收。
const ROW_GRID = "24px minmax(72px, 144px) minmax(40px, 1fr) 56px minmax(72px, auto)";

export function ServiceRankingBars({ rows }: { rows: RankingRow[] }) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {RANKING_EMPTY_TEXT}
      </Typography>
    );
  }

  return (
    <Box component="ol" aria-label="熱門服務排行" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((row, index) => (
        <Box
          component="li"
          key={row.serviceId}
          sx={{ display: "grid", gridTemplateColumns: ROW_GRID, columnGap: 3, alignItems: "center", fontSize: 14 }}
        >
          <Box component="span" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
            {index + 1}
          </Box>
          <Box sx={{ fontWeight: 600, minWidth: 0 }}>
            <ServiceRankingName row={row} />
          </Box>
          {/* 軌道＋填色純裝飾（數字已在右側以文字呈現），不進無障礙樹。 */}
          <Box aria-hidden sx={{ height: 12, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
            <Box
              data-testid="ranking-bar-fill"
              sx={{ height: "100%", borderRadius: 1, bgcolor: "primary.main", width: `${rankingBarPercent(row.count, rows)}%` }}
            />
          </Box>
          <Box component="span" sx={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {formatCount(row.count)}
          </Box>
          <Box component="span" sx={{ textAlign: "right", color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {formatPrice(row.revenue)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
