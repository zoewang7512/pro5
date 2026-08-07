"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import Stack from "@mui/material/Stack";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getAllBusinessHours } from "@/lib/admin/business-hours";
import { getClosedDatesInRange } from "@/lib/admin/closed-dates";
import { WeekCalendar } from "./WeekCalendar";
import { AppointmentListView } from "./AppointmentListView";
import { AppointmentDetailDialog } from "./AppointmentDetailDialog";
import {
  cancelAppointment,
  getAppointmentsForWeek,
  markAppointmentCompleted,
  rescheduleAppointment,
  type AppointmentStatus,
  type RescheduleResult,
  type WeekAppointment,
} from "@/lib/admin/appointments";
import { buildWeekDays, getNextWeek, getPreviousWeek, getTaipeiToday, getWeekRange } from "@/lib/admin/week-range";
import { formatAppointmentDateLabel, formatTimeRange, formatWeekRangeLabel } from "@/lib/admin/format";
import { useToast } from "@/components/ui/ToastProvider";

// 頁面層 state：週次與檢視模式集中於此，切換時只重新查詢對應區塊，不整頁重新整理。
// fetch 結果存 {key, status, data}，render 時比較目前依賴值與最後完成的 key 是否一致
// 推導 loading 狀態，寫法比照 app/_components/booking/BookingFlow.tsx
// （避免違反 react-hooks/set-state-in-effect 規則）。

type ViewMode = "calendar" | "list";
type AppointmentsResult = { key: string; status: "loaded" | "error"; appointments: WeekAppointment[] };

export function AdminDashboard() {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const todayDate = React.useMemo(() => getTaipeiToday(), []);

  const [weekStart, setWeekStart] = React.useState(() => getWeekRange(todayDate).weekStart);
  const [viewMode, setViewMode] = React.useState<ViewMode>("calendar");
  const [result, setResult] = React.useState<AppointmentsResult | null>(null);
  const [closedWeekdays, setClosedWeekdays] = React.useState<Set<number>>(() => new Set());
  const [closedDates, setClosedDates] = React.useState<Set<string>>(() => new Set());

  const [selectedAppointment, setSelectedAppointment] = React.useState<WeekAppointment | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = React.useState(false);
  const [markCompletedLoading, setMarkCompletedLoading] = React.useState(false);
  const [cancelLoading, setCancelLoading] = React.useState(false);
  // 改期可能把預約移出目前顯示的週次範圍（例如改到下週），本地 patch 沒辦法正確處理
  // 這種情況，所以改期成功後改成整個重新查詢目前週次，而不是像標記完成／取消那樣直接
  // patch 本地 state；bump 這個 token 觸發下面 fetch effect 重新執行。
  const [refetchToken, setRefetchToken] = React.useState(0);

  const weekRange = React.useMemo(() => getWeekRange(weekStart), [weekStart]);
  const weekDays = React.useMemo(() => buildWeekDays(weekRange.weekStart), [weekRange.weekStart]);

  React.useEffect(() => {
    const key = weekRange.weekStart;
    let cancelled = false;

    getAppointmentsForWeek(supabase, weekRange.weekStart, weekRange.weekEnd).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setResult({ key, status: "loaded", appointments: res.data });
      } else {
        setResult({ key, status: "error", appointments: [] });
        showToast("操作失敗，請稍後再試", "error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [supabase, weekRange.weekStart, weekRange.weekEnd, showToast, refetchToken]);

  // 公休日設定變更頻率遠低於預約異動，掛載時查一次即可，不需要跟著 weekStart／
  // refetchToken 重新查詢；本元件重新掛載（例如切換頁面再切回）會自動重新查詢，
  // 只有「另一個分頁改了設定、這個分頁的 AdminDashboard 沒有卸載」這種情況才會看到
  // 過期資料（已知限制，見 TASK-020 完成證據）。查詢失敗時維持空集合，不阻擋週曆渲染。
  React.useEffect(() => {
    let cancelled = false;

    getAllBusinessHours(supabase).then((res) => {
      if (cancelled || !res.ok) return;
      setClosedWeekdays(new Set(res.data.filter((row) => row.is_closed).map((row) => row.weekday)));
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // 與 closedWeekdays 不同，closed_dates 是「特定日期」而非「每週固定規則」：切換週次時
  // 可見的日期範圍會變，所以要跟著 weekRange 重新查詢，寫法比照上方 appointments 查詢
  // effect 的 cancelled guard。查詢失敗時維持既有值、不跳錯誤 Toast（比照 closedWeekdays
  // 既有的失敗處理原則，公休顯示是次要的視覺輔助資訊，不阻擋週曆本身渲染）。
  React.useEffect(() => {
    let cancelled = false;

    getClosedDatesInRange(supabase, weekRange.weekStart, weekRange.weekEnd).then((res) => {
      if (cancelled || !res.ok) return;
      setClosedDates(res.data);
    });

    return () => {
      cancelled = true;
    };
  }, [supabase, weekRange.weekStart, weekRange.weekEnd]);

  const matchesRequest = result?.key === weekRange.weekStart;
  const status: "loading" | "loaded" | "error" = matchesRequest ? result!.status : "loading";
  const appointments = matchesRequest ? result!.appointments : [];

  // 切換週次時關閉任何開啟中的 Modal／確認框，避免使用者看著上一週的預約詳情
  // 卻已經不在目前顯示的週次範圍內。
  function changeWeek(newWeekStart: string) {
    setWeekStart(newWeekStart);
    setDetailOpen(false);
    setCancelConfirmOpen(false);
  }

  function handleEventClick(appointment: WeekAppointment) {
    setSelectedAppointment(appointment);
    setDetailOpen(true);
  }

  // 標記完成／取消成功後直接更新本地 state 反映新狀態，不必整個重新查詢一次。
  function updateLocalAppointmentStatus(appointmentId: string, newStatus: AppointmentStatus) {
    setResult((prev) =>
      prev
        ? {
            ...prev,
            appointments: prev.appointments.map((appointment) =>
              appointment.id === appointmentId ? { ...appointment, status: newStatus } : appointment,
            ),
          }
        : prev,
    );
  }

  async function handleMarkCompleted() {
    if (!selectedAppointment) return;
    setMarkCompletedLoading(true);
    const res = await markAppointmentCompleted(supabase, selectedAppointment.id);
    setMarkCompletedLoading(false);

    if (res.ok) {
      updateLocalAppointmentStatus(selectedAppointment.id, "completed");
      setDetailOpen(false);
      showToast("已標記完成", "success");
    } else {
      showToast("操作失敗，請稍後再試", "error");
    }
  }

  function handleCancelRequest() {
    setDetailOpen(false);
    setCancelConfirmOpen(true);
  }

  async function handleConfirmCancel() {
    if (!selectedAppointment) return;
    setCancelLoading(true);
    const res = await cancelAppointment(supabase, selectedAppointment.id);
    setCancelLoading(false);

    if (res.ok) {
      updateLocalAppointmentStatus(selectedAppointment.id, "cancelled");
      setCancelConfirmOpen(false);
      showToast("已取消預約", "success");
    } else {
      showToast("操作失敗，請稍後再試", "error");
    }
  }

  // AppointmentDetailDialog 只負責改期表單的 UI（選日期／時段、顯示衝突錯誤），實際呼叫
  // rescheduleAppointment 與更新畫面資料的責任留在這裡，寫法比照 handleMarkCompleted／
  // handleConfirmCancel，讓所有資料層呼叫集中在同一個元件。
  async function handleReschedule(newStartAt: string, newEndAt: string): Promise<RescheduleResult> {
    if (!selectedAppointment) {
      return { ok: false, error: { code: "INTERNAL_ERROR", message: "發生未預期的錯誤，請稍後再試。" } };
    }
    const res = await rescheduleAppointment(
      supabase,
      selectedAppointment.id,
      selectedAppointment.start_at,
      newStartAt,
      newEndAt,
    );
    if (res.ok) {
      setRefetchToken((token) => token + 1);
    }
    return res;
  }

  return (
    <>
      <Box sx={{ flex: 1, minHeight: 0, p: 3, display: "flex", flexDirection: "column" }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button
              size="small"
              aria-label="上一週"
              onClick={() => changeWeek(getPreviousWeek(weekRange.weekStart).weekStart)}
            >
              ‹
            </Button>
            <Typography variant="h6" component="h2">
              {formatWeekRangeLabel(weekRange.weekStart, weekRange.weekEnd)}
            </Typography>
            <Button
              size="small"
              aria-label="下一週"
              onClick={() => changeWeek(getNextWeek(weekRange.weekStart).weekStart)}
            >
              ›
            </Button>
            <Button size="small" variant="text" onClick={() => changeWeek(getWeekRange(todayDate).weekStart)}>
              本週
            </Button>
          </Stack>

          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_event, value: ViewMode | null) => value && setViewMode(value)}
          >
            <ToggleButton value="calendar">週曆</ToggleButton>
            <ToggleButton value="list">列表</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {viewMode === "calendar" ? (
          <WeekCalendar
            weekDays={weekDays}
            todayDate={todayDate}
            status={status}
            appointments={appointments}
            closedWeekdays={closedWeekdays}
            closedDates={closedDates}
            onEventClick={handleEventClick}
          />
        ) : (
          <AppointmentListView status={status} appointments={appointments} onRowClick={handleEventClick} />
        )}
      </Box>

      <AppointmentDetailDialog
        open={detailOpen}
        appointment={selectedAppointment}
        markCompletedLoading={markCompletedLoading}
        onClose={() => setDetailOpen(false)}
        onMarkCompleted={handleMarkCompleted}
        onCancelRequest={handleCancelRequest}
        onReschedule={handleReschedule}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="確認取消預約？"
        description={
          selectedAppointment
            ? `${selectedAppointment.customer_name} · ${formatAppointmentDateLabel(selectedAppointment.start_at)} ${formatTimeRange(selectedAppointment.start_at, selectedAppointment.end_at)}`
            : undefined
        }
        confirmLabel="取消預約"
        cancelLabel="再想想"
        confirmColor="error"
        loading={cancelLoading}
        onConfirm={handleConfirmCancel}
        onClose={() => {
          if (!cancelLoading) setCancelConfirmOpen(false);
        }}
      />
    </>
  );
}
