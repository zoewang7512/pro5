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
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { createClient } from "@/lib/supabase/client";
import { listServices, setServiceActive } from "@/lib/admin/services";
import { formatPrice } from "@/lib/admin/format";
import type { Service } from "@/lib/booking/types";
import { ServiceFormDialog } from "./ServiceFormDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/ToastProvider";

// 架構基礎（TASK-034）＋新增/編輯（TASK-035）＋下架/重新上架（TASK-036）。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; services: Service[] };

type DialogState = { mode: "create" } | { mode: "edit"; service: Service } | null;

const SKELETON_ROWS = 4;

export function ServicesTable() {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [toggleTarget, setToggleTarget] = React.useState<Service | null>(null);
  const [toggleLoading, setToggleLoading] = React.useState(false);

  const loadServices = React.useCallback(async () => {
    const res = await listServices(supabase);
    setState(res.ok ? { status: "loaded", services: res.data } : { status: "error" });
  }, [supabase]);

  // 掛載時的初次載入：setState 要放在 promise .then() 回呼裡，不能在 effect 主體同步
  // 呼叫（比照 BusinessHoursForm.tsx 既有寫法），loadServices() 留給新增/編輯/下架/
  // 上架成功後的重新整理呼叫。
  React.useEffect(() => {
    let cancelled = false;
    listServices(supabase).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { status: "loaded", services: res.data } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function handleDialogSuccess() {
    setDialog(null);
    loadServices();
  }

  async function handleConfirmToggle() {
    if (!toggleTarget) return;
    setToggleLoading(true);
    const nextActive = !toggleTarget.is_active;
    const result = await setServiceActive(supabase, toggleTarget.id, nextActive);
    setToggleLoading(false);

    if (result.ok) {
      showToast(nextActive ? `「${toggleTarget.name}」已重新上架` : `「${toggleTarget.name}」已下架`, "success");
      setToggleTarget(null);
      loadServices();
    } else {
      // 失敗時保留 Dialog 開啟（比照 BusinessHoursForm.tsx 既有的取消預約確認流程），
      // 讓使用者看得到目前狀態、可以重試或改按「再想想」放棄。
      showToast("操作失敗，請稍後再試", "error");
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", mb: 2 }}>
        <Box>
          <Typography variant="h6" component="h2">
            服務項目管理
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            管理店內提供的服務項目，下架後顧客端不再顯示
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setDialog({ mode: "create" })}>
          ＋ 新增服務項目
        </Button>
      </Stack>

      {state.status === "error" && (
        <Alert severity="error">無法載入服務項目，請重新整理再試一次。</Alert>
      )}

      {state.status === "loading" && (
        <Paper variant="outlined">
          <Table size="small">
            <TableBody>
              {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={5}>
                    <Skeleton variant="rounded" height={36} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {state.status === "loaded" && state.services.length === 0 && (
        <Alert severity="info">目前尚無服務項目，點右上角「新增服務項目」開始建立</Alert>
      )}

      {state.status === "loaded" && state.services.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>名稱</TableCell>
                <TableCell>價格</TableCell>
                <TableCell>時長</TableCell>
                <TableCell>狀態</TableCell>
                <TableCell align="right"></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.services.map((service) => (
                <TableRow key={service.id} sx={{ opacity: service.is_active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {service.name}
                    </Typography>
                    {service.description && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          display: "block",
                          maxWidth: 260,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {service.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{formatPrice(service.price)}</TableCell>
                  <TableCell>{service.duration_minutes} 分鐘</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={service.is_active ? "上架中" : "已下架"}
                      color={service.is_active ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setDialog({ mode: "edit", service })}
                      >
                        編輯
                      </Button>
                      <Button
                        size="small"
                        color={service.is_active ? "inherit" : "primary"}
                        onClick={() => setToggleTarget(service)}
                      >
                        {service.is_active ? "下架" : "重新上架"}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {dialog !== null && (
        <ServiceFormDialog
          key={dialog.mode === "edit" ? dialog.service.id : "create"}
          mode={dialog.mode}
          service={dialog.mode === "edit" ? dialog.service : null}
          onClose={() => setDialog(null)}
          onSuccess={handleDialogSuccess}
        />
      )}

      <ConfirmDialog
        open={toggleTarget !== null}
        title={
          toggleTarget?.is_active
            ? `確定要下架「${toggleTarget.name}」？`
            : `確定要重新上架「${toggleTarget?.name}」？`
        }
        description={
          toggleTarget?.is_active
            ? "下架後顧客前台將不再顯示此服務，也無法用來建立新預約。已存在的預約不受影響，之後仍可重新上架。"
            : undefined
        }
        confirmLabel={toggleTarget?.is_active ? "下架" : "重新上架"}
        confirmColor={toggleTarget?.is_active ? "error" : "primary"}
        loading={toggleLoading}
        onConfirm={handleConfirmToggle}
        onClose={() => {
          if (!toggleLoading) setToggleTarget(null);
        }}
      />
    </Box>
  );
}
