"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { createClient } from "@/lib/supabase/client";
import { buildDateRange } from "@/lib/booking/date-range";
import { buildSlotGrid, type SlotCell } from "@/lib/booking/slot-grid";
import {
  getAppointmentDetail,
  getAvailableActions,
  type AppointmentDetail,
  type RescheduleResult,
  type WeekAppointment,
} from "@/lib/admin/appointments";
import { computeAvailableSlots, getBusinessHoursForWeekday, getOccupiedRangesForDate } from "@/lib/admin/reschedule-slots";
import { isDateClosed } from "@/lib/admin/closed-dates";
import { getTaipeiToday, getWeekday } from "@/lib/admin/week-range";
import { STATUS_LABEL, formatAppointmentDateLabel, formatTimeRange } from "@/lib/admin/format";
import { useToast } from "@/components/ui/ToastProvider";

// 詳情 Modal：比照 ConfirmDialog.tsx 內部用法直接用 MUI Dialog 拼出。取消預約的二次確認
// 不在這裡刻一份確認 UI，而是由父層關閉本 Dialog、開啟既有的 ConfirmDialog（見
// AdminDashboard.tsx 的 onCancelRequest），兩者是平行的 Dialog，不是 Dialog 裡嵌 Dialog。
//
// 改期則相反：同一個 Dialog 元件內用 view state 在「詳情」「改期表單」間切換（比照 mockup
// 畫面 3「改期表單（Modal 內切換）」），不是另開 Dialog——因為改期表單需要顯示「目前時段」
// 對照新選的時段，留在同一個 Modal 視窗內比較直覺。實際送出（呼叫 rescheduleAppointment、
// 更新週曆／列表資料）交給父層 AdminDashboard.tsx 的 onReschedule，寫法比照
// onMarkCompleted／onCancelRequest：本檔案只管表單 UI 與呈現，不管資料層。

export type AppointmentDetailDialogProps = {
  open: boolean;
  appointment: WeekAppointment | null;
  markCompletedLoading: boolean;
  onClose: () => void;
  onMarkCompleted: () => void;
  onCancelRequest: () => void;
  onReschedule: (newStartAt: string, newEndAt: string) => Promise<RescheduleResult>;
};

type DetailResult = { key: string; status: "loaded" | "error"; data: AppointmentDetail | null };
type SlotsResult = { key: string; status: "loaded" | "error"; cells: SlotCell[] };

const RESCHEDULE_DATE_RANGE_DAYS = 21;

export function AppointmentDetailDialog({
  open,
  appointment,
  markCompletedLoading,
  onClose,
  onMarkCompleted,
  onCancelRequest,
  onReschedule,
}: AppointmentDetailDialogProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const [detailResult, setDetailResult] = React.useState<DetailResult | null>(null);

  const appointmentId = appointment?.id ?? null;

  React.useEffect(() => {
    if (!open || !appointmentId) return;
    let cancelled = false;

    getAppointmentDetail(supabase, appointmentId).then((res) => {
      if (cancelled) return;
      setDetailResult(
        res.ok
          ? { key: appointmentId, status: "loaded", data: res.data }
          : { key: appointmentId, status: "error", data: null },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [open, appointmentId, supabase]);

  const matchesRequest = appointmentId !== null && detailResult?.key === appointmentId;
  const detailStatus: "loading" | "loaded" | "error" = matchesRequest ? detailResult!.status : "loading";
  const detail = matchesRequest ? detailResult!.data : null;

  // 改期表單的暫存狀態：日期／時段選擇、送出中、行內衝突錯誤訊息。
  const dateOptions = React.useMemo(() => buildDateRange(getTaipeiToday(), RESCHEDULE_DATE_RANGE_DAYS), []);
  const [view, setView] = React.useState<"detail" | "reschedule">("detail");
  const [rescheduleDate, setRescheduleDate] = React.useState(dateOptions[0].date);
  const [selectedSlot, setSelectedSlot] = React.useState<SlotCell | null>(null);
  const [slotsResult, setSlotsResult] = React.useState<SlotsResult | null>(null);
  const [rescheduleSubmitting, setRescheduleSubmitting] = React.useState(false);
  const [rescheduleError, setRescheduleError] = React.useState<string | null>(null);

  // Dialog 每次針對「新的一次開啟」重置改期子畫面的暫存狀態（比照 React 官方建議的
  // 「render 階段依 prop 變化調整 state」寫法，不是在 effect 內同步 setState，
  // 避免違反本專案的 react-hooks/set-state-in-effect 規則）。
  const openKey = open ? appointmentId : null;
  const [lastOpenKey, setLastOpenKey] = React.useState<string | null>(null);
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    if (openKey !== null) {
      setView("detail");
      setRescheduleDate(dateOptions[0].date);
      setSelectedSlot(null);
      setSlotsResult(null);
      setRescheduleError(null);
    }
  }

  const durationMinutes = detail?.duration_minutes ?? appointment?.duration_minutes ?? 0;
  const bufferMinutes = detail?.buffer_minutes ?? appointment?.buffer_minutes ?? 0;

  React.useEffect(() => {
    if (view !== "reschedule" || !appointmentId || durationMinutes <= 0) return;
    const key = rescheduleDate;
    let cancelled = false;

    (async () => {
      const weekday = getWeekday(rescheduleDate);
      const [hoursRes, occupiedRes, closedRes] = await Promise.all([
        getBusinessHoursForWeekday(supabase, weekday),
        getOccupiedRangesForDate(supabase, rescheduleDate, appointmentId),
        isDateClosed(supabase, rescheduleDate),
      ]);
      if (cancelled) return;

      if (hoursRes.ok && occupiedRes.ok && closedRes.ok) {
        // closedRes.data 為 true 時直接給空格點陣列，不呼叫 buildSlotGrid：buildSlotGrid
        // 只看 business_hours（不知道 closed_dates 的存在），當天 business_hours 若本來就
        // 正常營業，會照樣把整排格子畫出來、全部標成 disabled（因為 availableSlots 為
        // 空），使用者看到的是一整排灰掉的按鈕、沒有任何原因說明。直接給空陣列會落回既有
        // 「cells.length === 0」分支的 Alert（文案已涵蓋「當日公休或已無可預約時段」兩種
        // 情況，不需要新增文案）。
        const cells = closedRes.data
          ? []
          : buildSlotGrid({
              date: rescheduleDate,
              durationMinutes,
              businessHours: hoursRes.data,
              availableSlots: computeAvailableSlots({
                date: rescheduleDate,
                durationMinutes,
                businessHours: hoursRes.data,
                occupiedRanges: occupiedRes.data,
                now: Date.now(),
                bufferMinutes,
                isClosedDate: closedRes.data,
              }),
            });
        setSlotsResult({ key, status: "loaded", cells });
      } else {
        setSlotsResult({ key, status: "error", cells: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, appointmentId, rescheduleDate, durationMinutes, bufferMinutes, supabase]);

  const slotsMatchesRequest = view === "reschedule" && slotsResult?.key === rescheduleDate;
  const slotsStatus: "loading" | "loaded" | "error" = slotsMatchesRequest ? slotsResult!.status : "loading";
  const cells = slotsMatchesRequest ? slotsResult!.cells : [];

  if (!appointment) return null;

  // 操作按鈕與狀態文字一律以 getAppointmentDetail 單筆取回的權威 status 為準
  // （detail 到位後蓋過 TASK-014 整週查詢當下的舊快照），避免另一個分頁／另一次
  // session 已經把這筆改成 completed／cancelled 後，這裡還顯示舊狀態允許再次操作
  // ——即使畫面判斷有落差，updateAppointmentStatus／rescheduleAppointment 的伺服器端
  // 狀態條件仍是最終防線。
  const effectiveStatus = detail?.status ?? appointment.status;
  const actions = getAvailableActions(effectiveStatus);

  function handleSelectDate(date: string) {
    setRescheduleDate(date);
    setSelectedSlot(null);
    setRescheduleError(null);
  }

  async function handleSubmitReschedule() {
    if (!selectedSlot) return;
    const newEndAt = new Date(new Date(selectedSlot.startAt).getTime() + durationMinutes * 60_000).toISOString();

    setRescheduleSubmitting(true);
    setRescheduleError(null);
    const result = await onReschedule(selectedSlot.startAt, newEndAt);
    setRescheduleSubmitting(false);

    if (result.ok) {
      showToast("已更新預約時段", "success");
      onClose();
    } else if (result.error.code === "SLOT_CONFLICT") {
      setRescheduleError(result.error.message);
    } else {
      showToast(result.error.message, "error");
    }
  }

  if (view === "reschedule") {
    return (
      <Dialog open={open} onClose={onClose} aria-labelledby="reschedule-title" maxWidth="xs" fullWidth>
        <DialogTitle id="reschedule-title">改期：{appointment.customer_name}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              目前時段：{formatAppointmentDateLabel(appointment.start_at)}{" "}
              {formatTimeRange(appointment.start_at, appointment.end_at)}
            </Typography>

            <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
              {dateOptions.map((option) => (
                <Chip
                  key={option.date}
                  label={`週${option.weekdayLabel} ${option.day}`}
                  clickable
                  color={option.date === rescheduleDate ? "primary" : "default"}
                  variant={option.date === rescheduleDate ? "filled" : "outlined"}
                  onClick={() => handleSelectDate(option.date)}
                  sx={{ flex: "0 0 auto" }}
                />
              ))}
            </Stack>

            {slotsStatus === "loading" && (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} variant="rounded" height={36} />
                ))}
              </Box>
            )}

            {slotsStatus === "error" && (
              <Alert severity="error">無法載入可預約時段，請重新整理頁面再試一次。</Alert>
            )}

            {slotsStatus === "loaded" && cells.length === 0 && (
              <Alert severity="info">當日公休或已無可預約時段，請選擇其他日期。</Alert>
            )}

            {slotsStatus === "loaded" && cells.length > 0 && (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
                {cells.map((cell) => (
                  <Button
                    key={cell.startAt}
                    variant={selectedSlot?.startAt === cell.startAt ? "contained" : "outlined"}
                    disabled={cell.disabled}
                    onClick={() => setSelectedSlot(cell)}
                  >
                    {cell.timeLabel}
                  </Button>
                ))}
              </Box>
            )}

            {rescheduleError && <Alert severity="error">{rescheduleError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, flexDirection: "column", alignItems: "stretch", gap: 1 }}>
          <Button
            variant="contained"
            onClick={handleSubmitReschedule}
            loading={rescheduleSubmitting}
            disabled={!selectedSlot}
            fullWidth
          >
            確認改期
          </Button>
          <Button variant="text" onClick={() => setView("detail")} disabled={rescheduleSubmitting} fullWidth>
            取消
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="appointment-detail-title" maxWidth="xs" fullWidth>
      <DialogTitle id="appointment-detail-title">{appointment.customer_name}</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {formatAppointmentDateLabel(appointment.start_at)} ·{" "}
            {formatTimeRange(appointment.start_at, appointment.end_at)} · {appointment.service_name}
          </Typography>

          {detailStatus === "loading" && <Skeleton variant="text" width="60%" />}
          {detailStatus === "error" && (
            <Alert severity="error">無法載入完整詳情，請重新整理頁面再試一次。</Alert>
          )}
          {detailStatus === "loaded" && detail && (
            <Typography variant="body2">電話：{detail.customer_phone ?? "—"}</Typography>
          )}

          <Typography variant="body2">狀態：{STATUS_LABEL[effectiveStatus]}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, flexDirection: "column", alignItems: "stretch", gap: 1 }}>
        {actions.canComplete && (
          <Button variant="contained" onClick={onMarkCompleted} loading={markCompletedLoading} fullWidth>
            標記完成
          </Button>
        )}
        {actions.canReschedule && (
          <Button variant="outlined" onClick={() => setView("reschedule")} disabled={markCompletedLoading} fullWidth>
            改期
          </Button>
        )}
        {actions.canCancel && (
          <Button
            variant="outlined"
            color="error"
            onClick={onCancelRequest}
            disabled={markCompletedLoading}
            fullWidth
          >
            取消預約
          </Button>
        )}
        <Button variant="text" onClick={onClose} disabled={markCompletedLoading} fullWidth>
          關閉
        </Button>
      </DialogActions>
    </Dialog>
  );
}
