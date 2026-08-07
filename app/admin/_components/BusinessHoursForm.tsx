"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import { createClient } from "@/lib/supabase/client";
import {
  findAffectedAppointments,
  getAllBusinessHours,
  updateBusinessHours,
  validateBusinessHoursRow,
  type AffectedAppointment,
  type BusinessHoursInput,
  type BusinessHoursRow,
} from "@/lib/admin/business-hours";
import { WEEKDAY_LABELS } from "@/lib/admin/week-range";
import { formatAppointmentDateLabel, formatTaipeiTime } from "@/lib/admin/format";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/ToastProvider";
import { ClosedDatesSection } from "./ClosedDatesSection";

// 顯示順序「週一至週日」，資料庫的 weekday 是 0=週日...6=週六，故顯示順序把 0 移到最後。
const DISPLAY_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

// Postgres time 欄位透過 PostgREST 回傳含秒數（"10:00:00"），但 <input type="time">
// 沒有設定 step 時只接受/顯示到分鐘（"HH:mm"）——截斷秒數，避免顯示格式不一致；
// 表單編輯狀態與送出的新值全程維持這個「HH:mm」形狀，見 lib/admin/business-hours.ts
// 的 BusinessHoursInput。
function formatTimeInput(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

// 保底把 DISPLAY_WEEKDAYS 七天都建成一列，即使 business_hours 表在某個環境下缺了某天
// 的資料（理論上不會，7 列由 seed script 建立，但查詢結果不該被無條件信任剛好有 7 筆）。
// 缺列的情況下預設為公休，是最安全的保守值，不會是「凍結成看似可編輯、實際打不開」的
// 欄位（比照 updateRow 找不到列時直接 no-op 的既有防呆，這裡再往前補一層）。
function toEditableRows(rows: BusinessHoursRow[]): Map<number, BusinessHoursInput> {
  const map = new Map<number, BusinessHoursInput>();
  for (const weekday of DISPLAY_WEEKDAYS) {
    map.set(weekday, { weekday, open_time: "", close_time: "", is_closed: true });
  }
  for (const row of rows) {
    map.set(row.weekday, {
      weekday: row.weekday,
      open_time: formatTimeInput(row.open_time),
      close_time: formatTimeInput(row.close_time),
      is_closed: row.is_closed,
    });
  }
  return map;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; rows: Map<number, BusinessHoursInput> };

export function BusinessHoursForm() {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [submitting, setSubmitting] = React.useState(false);
  const [warningAppointments, setWarningAppointments] = React.useState<AffectedAppointment[] | null>(null);
  const [warningConfirmLoading, setWarningConfirmLoading] = React.useState(false);
  // 行內錯誤只在「欄位失焦過」或「已嘗試送出過」才顯示，不要 row 一改就立刻跳錯誤
  // ——例如把公休切回營業的當下，時間欄位還沒填，不應該馬上顯示「請填寫開店與打烊
  // 時間」，要等使用者離開該欄位或按下儲存才提示。
  const [touchedWeekdays, setTouchedWeekdays] = React.useState<Set<number>>(new Set());
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const openTimeRefs = React.useRef(new Map<number, HTMLInputElement | null>());

  function markTouched(weekday: number) {
    setTouchedWeekdays((prev) => (prev.has(weekday) ? prev : new Set(prev).add(weekday)));
  }

  const loadRows = React.useCallback(async () => {
    const res = await getAllBusinessHours(supabase);
    if (res.ok) {
      setState({ status: "loaded", rows: toEditableRows(res.data) });
    } else {
      setState({ status: "error" });
    }
  }, [supabase]);

  // 掛載時的初次載入：setState 要放在 promise .then() 回呼裡，不能在 effect 主體同步呼叫
  // （本專案 react-hooks/set-state-in-effect 規則要求，比照 AdminDashboard.tsx／
  // AppointmentDetailDialog.tsx 的既有寫法），所以這裡不能直接呼叫上面的 loadRows()，
  // 改成內聯同樣的邏輯＋cancelled guard；loadRows() 本身留給 doSave() 在成功寫入後
  // 的重新整理呼叫（那是使用者操作觸發的一般函式呼叫，不在 effect 裡，不受這條規則限制）。
  React.useEffect(() => {
    let cancelled = false;
    getAllBusinessHours(supabase).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setState({ status: "loaded", rows: toEditableRows(res.data) });
      } else {
        setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const rows = state.status === "loaded" ? state.rows : null;

  const errors = React.useMemo(() => {
    const map = new Map<number, string | null>();
    if (rows) {
      for (const [weekday, row] of rows) {
        map.set(weekday, validateBusinessHoursRow(row));
      }
    }
    return map;
  }, [rows]);

  function updateRow(weekday: number, patch: Partial<BusinessHoursInput>) {
    setState((prev) => {
      if (prev.status !== "loaded") return prev;
      const current = prev.rows.get(weekday);
      if (!current) return prev;
      const next = new Map(prev.rows);
      next.set(weekday, { ...current, ...patch });
      return { status: "loaded", rows: next };
    });
  }

  function handleToggleClosed(weekday: number, closed: boolean) {
    updateRow(weekday, closed ? { is_closed: true, open_time: "", close_time: "" } : { is_closed: false });
  }

  async function handleSubmit() {
    if (!rows) return;
    setSubmitAttempted(true);

    const firstInvalid = DISPLAY_WEEKDAYS.find((weekday) => errors.get(weekday));
    if (firstInvalid !== undefined) {
      openTimeRefs.current.get(firstInvalid)?.focus();
      return;
    }

    const newRows = Array.from(rows.values());
    // submitting 要一路蓋到實際寫入完成（用 finally 收尾），不能在「查詢受影響預約」
    // 這一步結束就提早關掉——中間那段空窗期按鈕會恢復可點擊、欄位恢復可編輯，使用者
    // 能夠再按一次儲存觸發第二個並行的 upsert，或在寫入進行中繼續編輯，被隨後
    // doSave() 成功後的 loadRows() 重新整理悄悄蓋掉剛打的字。
    setSubmitting(true);
    try {
      const affectedRes = await findAffectedAppointments(supabase, newRows);
      if (!affectedRes.ok) {
        showToast("操作失敗，請稍後再試", "error");
        return;
      }
      if (affectedRes.data.length > 0) {
        setWarningAppointments(affectedRes.data);
        return;
      }
      await doSave(newRows);
    } finally {
      setSubmitting(false);
    }
  }

  async function doSave(newRows: BusinessHoursInput[]): Promise<boolean> {
    const res = await updateBusinessHours(supabase, newRows);
    if (res.ok) {
      showToast("營業時間已更新", "success");
      await loadRows();
      return true;
    }
    showToast("操作失敗，請稍後再試", "error");
    return false;
  }

  async function handleConfirmSaveWithWarning() {
    if (!rows) return;
    setWarningConfirmLoading(true);
    // 送出失敗時保留警告 Dialog 開啟（比照 AdminDashboard.tsx 的取消預約確認流程：
    // 失敗不關閉 Dialog，讓使用者看得到目前狀態、可以重試或改按「再想想」放棄），
    // 只有成功才關閉。
    const success = await doSave(Array.from(rows.values()));
    setWarningConfirmLoading(false);
    if (success) setWarningAppointments(null);
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Typography variant="h6" component="h2">
        營業時間設定
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
        設定每週固定的開店/打烊時間與公休日
      </Typography>

      {state.status === "error" && (
        <Alert severity="error">無法載入營業時間設定，請重新整理再試一次。</Alert>
      )}

      {state.status !== "error" && (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Paper variant="outlined" sx={{ width: "100%" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>星期</TableCell>
                  <TableCell>公休</TableCell>
                  <TableCell>開店時間</TableCell>
                  <TableCell>打烊時間</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.status === "loading"
                  ? DISPLAY_WEEKDAYS.map((weekday) => (
                      <TableRow key={weekday}>
                        <TableCell colSpan={4}>
                          <Skeleton variant="rounded" height={36} />
                        </TableCell>
                      </TableRow>
                    ))
                  : DISPLAY_WEEKDAYS.map((weekday) => {
                      const row = rows?.get(weekday);
                      const isClosed = row?.is_closed ?? false;
                      const showError = touchedWeekdays.has(weekday) || submitAttempted;
                      const rowError = showError ? errors.get(weekday) : null;
                      return (
                        <TableRow key={weekday} sx={{ opacity: isClosed ? 0.6 : 1, verticalAlign: "top" }}>
                          <TableCell sx={{ fontWeight: 600, pt: 1.5 }}>週{WEEKDAY_LABELS[weekday]}</TableCell>
                          <TableCell sx={{ pt: 1 }}>
                            <Switch
                              checked={isClosed}
                              onChange={(_event, checked) => handleToggleClosed(weekday, checked)}
                              disabled={submitting}
                              size="small"
                              slotProps={{ input: { "aria-label": "公休" } }}
                            />
                          </TableCell>
                          <TableCell sx={{ pt: 1 }}>
                            <TextField
                              type="time"
                              size="small"
                              disabled={isClosed || submitting}
                              value={row?.open_time ?? ""}
                              onChange={(event) => updateRow(weekday, { open_time: event.target.value })}
                              onBlur={() => markTouched(weekday)}
                              inputRef={(el: HTMLInputElement | null) => {
                                openTimeRefs.current.set(weekday, el);
                              }}
                              slotProps={{ htmlInput: { "aria-label": "開店時間" } }}
                            />
                          </TableCell>
                          <TableCell sx={{ pt: 1 }}>
                            <TextField
                              type="time"
                              size="small"
                              disabled={isClosed || submitting}
                              value={row?.close_time ?? ""}
                              onChange={(event) => updateRow(weekday, { close_time: event.target.value })}
                              onBlur={() => markTouched(weekday)}
                              slotProps={{ htmlInput: { "aria-label": "打烊時間" } }}
                            />
                            {rowError && (
                              <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
                                {rowError}
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          </Paper>

          <Button variant="contained" onClick={handleSubmit} loading={submitting} disabled={state.status !== "loaded"}>
            儲存變更
          </Button>
        </Stack>
      )}

      <ClosedDatesSection />

      <ConfirmDialog
        open={warningAppointments !== null}
        title="部分預約將落在新的營業時間之外"
        description={
          warningAppointments
            ? `以下 ${warningAppointments.length} 筆未來預約會受影響：`
            : undefined
        }
        confirmLabel="仍要儲存"
        cancelLabel="再想想"
        loading={warningConfirmLoading}
        onConfirm={handleConfirmSaveWithWarning}
        onClose={() => {
          if (!warningConfirmLoading) setWarningAppointments(null);
        }}
      >
        {warningAppointments && (
          <Box sx={{ maxHeight: 220, overflowY: "auto", mt: 1 }}>
            {warningAppointments.map((appointment) => (
              <Stack
                key={appointment.id}
                direction="row"
                sx={{ justifyContent: "space-between", py: 1, borderBottom: "1px solid", borderColor: "grey.200" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {appointment.customer_name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatAppointmentDateLabel(appointment.start_at)} {formatTaipeiTime(appointment.start_at)}
                </Typography>
              </Stack>
            ))}
          </Box>
        )}
      </ConfirmDialog>
    </Box>
  );
}
