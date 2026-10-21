"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import { createClient } from "@/lib/supabase/client";
import { listDesigners, type DesignerListData } from "@/lib/admin/designers";
import { designerInitial, resolveDesignerAssetUrl } from "@/lib/designers";

// 設計師管理列表（TASK-067：唯讀骨架）。新增、編輯、停用、調整順序等操作先停用，
// 由 TASK-069 起的任務卡接上。欄位比照已核准的 mockup Variant A（表格列表）。

type LoadState = { status: "loading" } | { status: "error" } | { status: "loaded"; data: DesignerListData };

const SKELETON_ROWS = 3;
const COLUMN_COUNT = 6;
// 後台以桌面為主，窄寬度時讓表格在容器內橫向捲動，不要把名字與表頭折成直排。
const TABLE_MIN_WIDTH = 720;
const NO_WRAP = { whiteSpace: "nowrap" } as const;

export function DesignersTable() {
  const supabase = React.useMemo(() => createClient(), []);
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  // 掛載時的初次載入：setState 要放在 promise .then() 回呼裡，不能在 effect 主體同步呼叫
  // （比照 ServicesTable.tsx 既有寫法）。
  React.useEffect(() => {
    let cancelled = false;
    listDesigners(supabase).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { status: "loaded", data: res.data } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const loadedData = state.status === "loaded" ? state.data : null;

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", mb: 2 }}>
        <Box>
          <Typography variant="h6" component="h2">
            設計師
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            設計師的名字、頭像、專長、IG 和作品集會公開顯示在預約頁。
          </Typography>
        </Box>
        <Button variant="contained" disabled sx={{ ...NO_WRAP, flexShrink: 0, ml: 2 }}>
          ＋ 新增設計師
        </Button>
      </Stack>

      {state.status === "error" && <Alert severity="error">無法載入設計師資料，請重新整理頁面再試一次。</Alert>}

      {state.status === "loading" && (
        <Paper variant="outlined">
          <Table size="small">
            <TableBody>
              {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={COLUMN_COUNT}>
                    <Skeleton variant="rounded" height={40} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {loadedData && loadedData.designers.length === 0 && (
        <Alert severity="info">還沒有設計師，新增第一位設計師開始接受預約。</Alert>
      )}

      {loadedData && loadedData.designers.length > 0 && (
        <Paper variant="outlined">
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: TABLE_MIN_WIDTH }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 64, ...NO_WRAP }}>順序</TableCell>
                  <TableCell sx={NO_WRAP}>設計師</TableCell>
                  <TableCell sx={NO_WRAP}>專長</TableCell>
                  <TableCell sx={NO_WRAP}>提供服務</TableCell>
                  <TableCell sx={NO_WRAP}>狀態</TableCell>
                  <TableCell align="right" sx={NO_WRAP}>
                    操作
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loadedData.designers.map((designer, index) => (
                  <TableRow key={designer.id} sx={designer.is_active ? undefined : { color: "text.disabled" }}>
                    <TableCell sx={{ color: "text.secondary" }}>{index + 1}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                        <Avatar
                          src={resolveDesignerAssetUrl(designer.avatar_url) ?? undefined}
                          alt={designer.name}
                          sx={{ width: 40, height: 40, opacity: designer.is_active ? 1 : 0.5 }}
                        >
                          {designerInitial(designer.name)}
                        </Avatar>
                        <Typography
                          variant="body2"
                          sx={{
                            ...NO_WRAP,
                            fontWeight: 600,
                            color: designer.is_active ? "text.primary" : "text.disabled",
                          }}
                        >
                          {designer.name}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {designer.specialties.length === 0 ? (
                        <Typography variant="body2" sx={{ color: "text.disabled" }}>
                          —
                        </Typography>
                      ) : (
                        <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 0.5 }}>
                          {designer.specialties.map((tag) => (
                            <Chip key={tag} size="small" variant="outlined" label={tag} />
                          ))}
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell sx={NO_WRAP}>
                      {designer.service_count} / {loadedData.totalServices} 項
                    </TableCell>
                    <TableCell sx={NO_WRAP}>
                      <Chip
                        size="small"
                        label={designer.is_active ? "啟用中" : "已停用"}
                        color={designer.is_active ? "success" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right" sx={NO_WRAP}>
                      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                        <Button size="small" variant="outlined" disabled sx={NO_WRAP}>
                          編輯
                        </Button>
                        <Button size="small" color="inherit" disabled sx={NO_WRAP}>
                          {designer.is_active ? "停用" : "重新啟用"}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
