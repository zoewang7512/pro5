"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import { createClient } from "@/lib/supabase/client";
import {
  addClosedDate,
  findAffectedAppointmentsForClosedDate,
  getAllClosedDates,
  removeClosedDate,
} from "@/lib/admin/closed-dates";
import type { AffectedAppointment } from "@/lib/admin/business-hours";
import { WEEKDAY_LABELS, getTaipeiToday, getWeekday } from "@/lib/admin/week-range";
import { formatAppointmentDateLabel, formatDateSlash, formatTaipeiTime } from "@/lib/admin/format";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/ToastProvider";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; dates: Set<string> };

export function ClosedDatesSection() {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const today = React.useMemo(() => getTaipeiToday(), []);
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [viewYear, setViewYear] = React.useState(() => Number(today.slice(0, 4)));
  const [viewMonth, setViewMonth] = React.useState(() => Number(today.slice(5, 7)));
  const [pendingDate, setPendingDate] = React.useState<string | null>(null);
  const [warningAppointments, setWarningAppointments] = React.useState<AffectedAppointment[] | null>(null);
  const [warningConfirmLoading, setWarningConfirmLoading] = React.useState(false);
  // 從點下日曆/清單的移除鈕，到操作真正完成（含警告 Modal 決議出爐）為止全程鎖定，
  // 避免快速連續點擊觸發多個並行的 loadDates() 而讓後到的過期回應蓋掉較新的狀態
  // （比照 BusinessHoursForm.tsx 的 submitting 用 finally 蓋住整段流程的既有模式）。
  const [busy, setBusy] = React.useState(false);

  const loadDates = React.useCallback(async () => {
    const res = await getAllClosedDates(supabase);
    if (res.ok) {
      setState({ status: "loaded", dates: new Set(res.data.map((row) => row.date)) });
    } else {
      setState({ status: "error" });
    }
  }, [supabase]);

  // 掛載時的初次載入比照 BusinessHoursForm.tsx：setState 放在 promise .then() 回呼裡，
  // 不在 effect 主體同步呼叫（react-hooks/set-state-in-effect），loadDates() 留給
  // 使用者操作後（新增/移除成功）的重新整理呼叫。
  React.useEffect(() => {
    let cancelled = false;
    getAllClosedDates(supabase).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setState({ status: "loaded", dates: new Set(res.data.map((row) => row.date)) });
      } else {
        setState({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const markedDates = React.useMemo(
    () => (state.status === "loaded" ? state.dates : new Set<string>()),
    [state],
  );
  const sortedDates = React.useMemo(() => Array.from(markedDates).sort(), [markedDates]);

  async function handleRemove(date: string) {
    if (busy) return;
    setBusy(true);
    const res = await removeClosedDate(supabase, date);
    if (res.ok) {
      showToast("已移除公休日", "success");
      await loadDates();
    } else {
      showToast("操作失敗，請稍後再試", "error");
    }
    setBusy(false);
  }

  async function handleDayClick(date: string) {
    if (busy) return;
    if (markedDates.has(date)) {
      await handleRemove(date);
      return;
    }
    // MonthPicker 本身已停用過去日期的點擊，這裡是最後一層防呆，直接忽略不處理。
    if (date < today) return;

    setBusy(true);
    const affectedRes = await findAffectedAppointmentsForClosedDate(supabase, date);
    if (!affectedRes.ok) {
      showToast("操作失敗，請稍後再試", "error");
      setBusy(false);
      return;
    }
    if (affectedRes.data.length > 0) {
      setPendingDate(date);
      setWarningAppointments(affectedRes.data);
      // busy 保持鎖定，直到使用者在警告 Modal 確認或取消決議完成（見
      // handleConfirmAddWithWarning／ConfirmDialog 的 onClose）；Modal 本身按鈕的
      // loading 狀態由獨立的 warningConfirmLoading 控制，不受這裡影響。
      return;
    }

    const addRes = await addClosedDate(supabase, date);
    if (addRes.ok) {
      showToast("已新增公休日", "success");
      await loadDates();
    } else {
      showToast("操作失敗，請稍後再試", "error");
    }
    setBusy(false);
  }

  async function handleConfirmAddWithWarning() {
    if (!pendingDate) return;
    setWarningConfirmLoading(true);
    const res = await addClosedDate(supabase, pendingDate);
    // 失敗保留警告 Dialog 開啟，比照 BusinessHoursForm.tsx 既有的失敗不關閉 Dialog 慣例；
    // 成功時要等 loadDates() 重新整理清單完成才解除 loading，避免畫面顯示已成功但清單
    // 還沒更新的空窗期讓使用者誤按（比照 BusinessHoursForm.tsx 的 doSave() 既有寫法）。
    if (res.ok) {
      showToast("已新增公休日", "success");
      await loadDates();
      setWarningConfirmLoading(false);
      setBusy(false);
      setWarningAppointments(null);
      setPendingDate(null);
    } else {
      showToast("操作失敗，請稍後再試", "error");
      setWarningConfirmLoading(false);
    }
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" component="h3">
        特殊公休日
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
        點選日期即可標記整天公休，優先於每週固定營業時間
      </Typography>

      {state.status === "error" && (
        <Alert severity="error">無法載入特殊公休日設定，請重新整理再試一次。</Alert>
      )}

      {state.status === "loading" && <Skeleton variant="rounded" height={280} />}

      {state.status === "loaded" && (
        <Stack
          direction="row"
          spacing={4}
          sx={{ alignItems: "flex-start", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}
        >
          <Box sx={{ width: 340, flexShrink: 0 }}>
            <MonthPicker
              year={viewYear}
              month={viewMonth}
              todayDate={today}
              markedDates={markedDates}
              onDayClick={handleDayClick}
              onMonthChange={(year, month) => {
                setViewYear(year);
                setViewMonth(month);
              }}
            />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0, borderLeft: "1px solid", borderColor: "grey.200", pl: 3 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", display: "block", mb: 1 }}>
              已設定的特殊公休日
            </Typography>

            {sortedDates.length === 0 ? (
              <Alert severity="info">尚無設定的特殊公休日</Alert>
            ) : (
              <Stack>
                {sortedDates.map((date) => (
                  <Stack
                    key={date}
                    direction="row"
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                      py: 1,
                      borderBottom: "1px solid",
                      borderColor: "grey.200",
                    }}
                  >
                    <Typography variant="body2">
                      {formatDateSlash(date)}
                      <Typography component="span" variant="body2" sx={{ color: "text.secondary", ml: 1 }}>
                        週{WEEKDAY_LABELS[getWeekday(date)]}
                      </Typography>
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label="移除公休日"
                      onClick={() => handleRemove(date)}
                      sx={{ width: 26, height: 26, border: "1px solid", borderColor: "grey.300", fontSize: 12 }}
                    >
                      ✕
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      )}

      <ConfirmDialog
        open={warningAppointments !== null}
        title="部分預約將落在新的公休日"
        description={
          warningAppointments && pendingDate
            ? `${formatDateSlash(pendingDate)}（週${WEEKDAY_LABELS[getWeekday(pendingDate)]}）目前有 ${warningAppointments.length} 筆未來預約會受影響：`
            : undefined
        }
        confirmLabel="仍要新增"
        cancelLabel="再想想"
        loading={warningConfirmLoading}
        onConfirm={handleConfirmAddWithWarning}
        onClose={() => {
          if (!warningConfirmLoading) {
            setWarningAppointments(null);
            setPendingDate(null);
            setBusy(false);
          }
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
