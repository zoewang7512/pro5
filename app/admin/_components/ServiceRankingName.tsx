"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import type { RankingRow } from "@/lib/admin/reports-ranking";

// 排行（橫條／表格）共用的服務名稱：純文字節點（<bdi> 隔離方向、允許換行），已下架者加標籤。
export function ServiceRankingName({ row }: { row: Pick<RankingRow, "name" | "isActive"> }) {
  return (
    <Box component="span" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <bdi>{row.name}</bdi>
      {!row.isActive && <Chip size="small" label="已下架" sx={{ ml: 2, verticalAlign: "middle" }} />}
    </Box>
  );
}
