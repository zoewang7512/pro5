"use client";

import * as React from "react";
import NextLink from "next/link";
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
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import { createClient } from "@/lib/supabase/client";
import {
  countFutureAppointmentsForDesigner,
  listDesigners,
  setDesignerActive,
  swapDesignerOrder,
  type AdminDesigner,
  type DesignerListData,
} from "@/lib/admin/designers";
import { designerInitial, resolveDesignerAssetUrl } from "@/lib/designers";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/ToastProvider";

// 設計師管理列表。TASK-067：唯讀骨架；TASK-069：新增、編輯（連到編輯頁）、停用／重新啟用、上下箭頭排序。
// 欄位比照已核准的 mockup Variant A（表格列表）。

type LoadState = { status: "loading" } | { status: "error" } | { status: "loaded"; data: DesignerListData };

// 停用確認對話框的狀態。futureCount：undefined＝查詢中、null＝查詢失敗（不顯示 0，仍可確認停用）。
type DeactivateTarget = { designer: AdminDesigner; futureCount: number | null | undefined; isLastActive: boolean };

const SKELETON_ROWS = 3;
const COLUMN_COUNT = 6;
// 後台以桌面為主，窄寬度時讓表格在容器內橫向捲動，不要把名字與表頭折成直排。
const TABLE_MIN_WIDTH = 720;
const NO_WRAP = { whiteSpace: "nowrap" } as const;
const GENERIC_ERROR_TOAST = "操作失敗，請稍後再試";

export function DesignersTable() {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  // 任何排序／停用／啟用寫入在途時，所有箭頭與停用按鈕都停用：避免快速連點用過時的列表發出交錯的 update。
  const [busy, setBusy] = React.useState(false);
  const [deactivateTarget, setDeactivateTarget] = React.useState<DeactivateTarget | null>(null);
  const latestTargetId = React.useRef<string | null>(null);

  const reload = React.useCallback(async () => {
    const res = await listDesigners(supabase);
    setState(res.ok ? { status: "loaded", data: res.data } : { status: "error" });
  }, [supabase]);

  // 掛載時的初次載入：setState 要放在 promise .then() 回呼裡，不能在 effect 主體同步呼叫
  // （比照 ServicesTable.tsx 既有寫法）；reload() 留給寫入操作之後的重新讀取。
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
  const designers = loadedData?.designers ?? [];

  async function handleMove(index: number, direction: "up" | "down") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await swapDesignerOrder(supabase, designers, index, direction);
      if (!res.ok) showToast(GENERIC_ERROR_TOAST, "error");
      // 不做樂觀更新：成功或失敗都重新讀取，畫面永遠反映資料庫實際順序。
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function openDeactivate(designer: AdminDesigner) {
    const isLastActive = designers.filter((item) => item.is_active).length === 1 && designer.is_active;
    latestTargetId.current = designer.id;
    setDeactivateTarget({ designer, futureCount: undefined, isLastActive });

    const res = await countFutureAppointmentsForDesigner(supabase, designer.id);
    // 對話框已關閉或換成別位設計師時，忽略過期的查詢結果。
    if (latestTargetId.current !== designer.id) return;
    setDeactivateTarget((prev) =>
      prev && prev.designer.id === designer.id ? { ...prev, futureCount: res.ok ? res.data : null } : prev,
    );
  }

  function closeDeactivate() {
    latestTargetId.current = null;
    setDeactivateTarget(null);
  }

  async function handleConfirmDeactivate() {
    if (!deactivateTarget || busy) return;
    const { designer } = deactivateTarget;
    setBusy(true);
    try {
      const res = await setDesignerActive(supabase, designer.id, false);
      if (res.ok) {
        showToast(`「${designer.name}」已停用`, "success");
        closeDeactivate();
      } else {
        // 失敗時保留對話框（比照 ServicesTable.tsx），讓店長可以重試或放棄。
        showToast(GENERIC_ERROR_TOAST, "error");
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function handleReactivate(designer: AdminDesigner) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await setDesignerActive(supabase, designer.id, true);
      showToast(res.ok ? `「${designer.name}」已重新啟用` : GENERIC_ERROR_TOAST, res.ok ? "success" : "error");
      await reload();
    } finally {
      setBusy(false);
    }
  }

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
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            順序也會影響顧客選「不指定設計師」時的自動指派優先順序。
          </Typography>
        </Box>
        {state.status === "loading" ? (
          <Button variant="contained" disabled sx={{ ...NO_WRAP, flexShrink: 0, ml: 2 }}>
            ＋ 新增設計師
          </Button>
        ) : (
          <Button
            variant="contained"
            component={NextLink}
            href="/admin/designers/new"
            sx={{ ...NO_WRAP, flexShrink: 0, ml: 2 }}
          >
            ＋ 新增設計師
          </Button>
        )}
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

      {loadedData && designers.length === 0 && (
        <Alert severity="info">還沒有設計師，新增第一位設計師開始接受預約。</Alert>
      )}

      {loadedData && designers.length > 0 && (
        <Paper variant="outlined">
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: TABLE_MIN_WIDTH }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 96, ...NO_WRAP }}>順序</TableCell>
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
                {designers.map((designer, index) => (
                  <TableRow key={designer.id} sx={designer.is_active ? undefined : { color: "text.disabled" }}>
                    <TableCell sx={{ color: "text.secondary", ...NO_WRAP }}>
                      <Stack direction="row" sx={{ alignItems: "center" }}>
                        <Box component="span" sx={{ minWidth: 20 }}>
                          {index + 1}
                        </Box>
                        <IconButton
                          size="small"
                          aria-label={`上移 ${designer.name}`}
                          disabled={busy || index === 0}
                          onClick={() => handleMove(index, "up")}
                        >
                          ▲
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={`下移 ${designer.name}`}
                          disabled={busy || index === designers.length - 1}
                          onClick={() => handleMove(index, "down")}
                        >
                          ▼
                        </IconButton>
                      </Stack>
                    </TableCell>
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
                        <Button
                          size="small"
                          variant="outlined"
                          component={NextLink}
                          href={`/admin/designers/${designer.id}`}
                          sx={NO_WRAP}
                        >
                          編輯
                        </Button>
                        {designer.is_active ? (
                          <Button
                            size="small"
                            color="inherit"
                            disabled={busy}
                            onClick={() => openDeactivate(designer)}
                            sx={NO_WRAP}
                          >
                            停用
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            color="primary"
                            disabled={busy}
                            onClick={() => handleReactivate(designer)}
                            sx={NO_WRAP}
                          >
                            重新啟用
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <ConfirmDialog
        open={deactivateTarget !== null}
        title={`確定要停用「${deactivateTarget?.designer.name ?? ""}」？`}
        description="停用後顧客前台將不再顯示這位設計師，也不會再被指派新的預約。已存在的預約不受影響，之後仍可重新啟用。"
        confirmLabel="停用"
        confirmColor="error"
        loading={busy}
        onConfirm={handleConfirmDeactivate}
        onClose={() => {
          if (!busy) closeDeactivate();
        }}
      >
        {deactivateTarget && (
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            {deactivateTarget.isLastActive && (
              <Alert severity="warning">停用後前台將沒有任何可預約的設計師。</Alert>
            )}
            <Alert severity={deactivateTarget.futureCount ? "warning" : "info"}>
              {deactivateTarget.futureCount === undefined && "正在查詢未來的有效預約…"}
              {deactivateTarget.futureCount === null && "無法取得未來預約筆數，仍可繼續停用。"}
              {deactivateTarget.futureCount === 0 && "這位設計師目前沒有未來的有效預約。"}
              {typeof deactivateTarget.futureCount === "number" &&
                deactivateTarget.futureCount > 0 &&
                `這位設計師還有 ${deactivateTarget.futureCount} 筆未來的有效預約。這些預約不會自動取消，也不會通知顧客，請記得另外處理。`}
            </Alert>
          </Stack>
        )}
      </ConfirmDialog>
    </Box>
  );
}
