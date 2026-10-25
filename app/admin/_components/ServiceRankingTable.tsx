"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { formatPrice } from "@/lib/admin/format";
import { rankingBarPercent, rankingShare, type RankingRow } from "@/lib/admin/reports-ranking";
import { RANKING_EMPTY_TEXT, formatCount } from "./ReportsStates";
import { ServiceRankingName } from "./ServiceRankingName";

// 報表頁籤的熱門服務排行（mockup 變體 C）：名次、服務、預約量、占比條＋百分比、營收。
// 純展示：rows 來自 buildServiceRanking；標題與外框由面板提供。窄視窗在容器內橫向捲動，不撐寬頁面。

const HEAD_CELL_SX = { fontSize: 12, fontWeight: 600, color: "text.secondary", whiteSpace: "nowrap" };
const NUMBER_CELL_SX = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

export function ServiceRankingTable({ rows }: { rows: RankingRow[] }) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 6, pb: 6 }}>
        {RANKING_EMPTY_TEXT}
      </Typography>
    );
  }

  return (
    <TableContainer>
      <Table size="small" aria-label="熱門服務排行" sx={{ minWidth: 480 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={HEAD_CELL_SX}>名次</TableCell>
            <TableCell sx={HEAD_CELL_SX}>服務</TableCell>
            <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>預約量</TableCell>
            <TableCell sx={{ ...HEAD_CELL_SX, width: 160 }}>
              占比
              <Box component="span" sx={{ fontWeight: 400 }}>
                （條長為相對最高）
              </Box>
            </TableCell>
            <TableCell sx={{ ...HEAD_CELL_SX, ...NUMBER_CELL_SX }}>營收</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.serviceId}>
              <TableCell sx={{ width: 48, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{index + 1}</TableCell>
              <TableCell component="th" scope="row" sx={{ fontWeight: 600 }}>
                <ServiceRankingName row={row} />
              </TableCell>
              <TableCell sx={{ ...NUMBER_CELL_SX, whiteSpace: "nowrap" }}>{formatCount(row.count)}</TableCell>
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  {/* 條長＝預約量 ÷ 最大預約量（與 mockup 一致）；百分比為占排行總預約量的比例。條純裝飾。 */}
                  <Box aria-hidden sx={{ flex: 1, height: 8, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
                    <Box
                      data-testid="ranking-bar-fill"
                      sx={{ height: "100%", borderRadius: 1, bgcolor: "primary.main", width: `${rankingBarPercent(row.count, rows)}%` }}
                    />
                  </Box>
                  <Box component="span" sx={{ width: 40, textAlign: "right", fontSize: 12, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                    {rankingShare(row.count, rows)}%
                  </Box>
                </Box>
              </TableCell>
              <TableCell sx={{ ...NUMBER_CELL_SX, whiteSpace: "nowrap" }}>{formatPrice(row.revenue)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
