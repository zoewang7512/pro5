"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { createClient } from "@/lib/supabase/client";
import {
  addDesignerLeave,
  findAffectedAppointmentsForDesignerLeave,
  isShopClosedDate,
  listDesignerLeaves,
  removeDesignerLeave,
  type LeaveAffectedAppointment,
} from "@/lib/admin/designers";
import { getAllBusinessHours, type BusinessHoursRow } from "@/lib/admin/business-hours";
import { getAllClosedDates } from "@/lib/admin/closed-dates";
import { buildMonthDays } from "@/lib/admin/month-range";
import { WEEKDAY_LABELS, getTaipeiToday, getWeekday } from "@/lib/admin/week-range";
import { formatTaipeiTime } from "@/lib/admin/format";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/ToastProvider";

// 設計師編輯頁的「請假」頁籤（TASK-072）：月曆點選標記／取消整天請假、即將到來的請假清單、全店公休日唯讀標示、
// 標記日已有該設計師預約時先顯示警告。流程比照 ClosedDatesSection：點日期 → 查受影響預約 → 無則直接寫入、有則
// ConfirmDialog 列清單 → 確認後寫入；取消請假不警告。
//
// 單一 busy 鎖：從點下日期（或移除鈕）到整個流程結束（含警告 Dialog 決議）全程鎖定，避免並行寫入。任何寫入（成功或
// 失敗）後一律重讀請假日，以資料庫為準；重讀失敗時保留畫面現狀並用 Toast 提醒，不換成整頁錯誤。頁籤標籤的數字
// （今天以後的請假日數）在載入完成與每次重讀後透過 onCountChange 回報，父層讓本元件常駐掛載。

type ShopData = { businessHours: BusinessHoursRow[]; closedDates: Set<string> };

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; shop: ShopData; leaves: Set<string> };

const GENERIC_ERROR_TOAST = "操作失敗，請稍後再試";

// 「10/23（四）」
function formatLeaveDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}（${WEEKDAY_LABELS[getWeekday(date)]}）`;
}

export function DesignerLeavesTab({
  designerId,
  designerName,
  onCountChange,
}: {
  designerId: string;
  designerName: string;
  onCountChange: (count: number) => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const today = React.useMemo(() => getTaipeiToday(), []);
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [viewYear, setViewYear] = React.useState(() => Number(today.slice(0, 4)));
  const [viewMonth, setViewMonth] = React.useState(() => Number(today.slice(5, 7)));
  const [busy, setBusy] = React.useState(false);
  const [pendingDate, setPendingDate] = React.useState<string | null>(null);
  const [warningAppointments, setWarningAppointments] = React.useState<LeaveAffectedAppointment[] | null>(null);
  const [confirmLoading, setConfirmLoading] = React.useState(false);
  const mountedRef = React.useRef(true);
  const onCountChangeRef = React.useRef(onCountChange);
  React.useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function reportCount(dates: Iterable<string>) {
    let count = 0;
    for (const date of dates) if (date >= today) count += 1;
    onCountChangeRef.current(count);
  }

  // 掛載時的初次載入：setState 放在 promise .then() 回呼裡（比照 ClosedDatesSection、DesignerPortfolioTab）。
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([listDesignerLeaves(supabase, designerId), getAllBusinessHours(supabase), getAllClosedDates(supabase)])
      .then(([leavesRes, hoursRes, closedRes]) => {
        if (cancelled) return;
        if (!leavesRes.ok || !hoursRes.ok || !closedRes.ok) {
          setState({ status: "error" });
          return;
        }
        const leaves = new Set(leavesRes.data);
        setState({
          status: "loaded",
          shop: { businessHours: hoursRes.data, closedDates: new Set(closedRes.data.map((row) => row.date)) },
          leaves,
        });
        reportCount(leaves);
      })
      // 營業時間與公休日的讀取函式沒有自己包 try/catch：拋出例外時顯示錯誤，不要一直停在 Skeleton。
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // reportCount 只讀 today 與 ref，不需要列入相依。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, designerId]);

  async function reloadLeaves() {
    const res = await listDesignerLeaves(supabase, designerId);
    if (!mountedRef.current) return;
    if (!res.ok) {
      showToast("無法更新請假日，請重新整理頁面", "error");
      return;
    }
    const leaves = new Set(res.data);
    setState((prev) => (prev.status === "loaded" ? { ...prev, leaves } : prev));
    reportCount(leaves);
  }

  const leaves = React.useMemo(() => (state.status === "loaded" ? state.leaves : new Set<string>()), [state]);
  const upcoming = React.useMemo(() => Array.from(leaves).filter((date) => date >= today).sort(), [leaves, today]);
  const shopClosedDates = React.useMemo(() => {
    if (state.status !== "loaded") return new Set<string>();
    const { businessHours, closedDates } = state.shop;
    return new Set(
      buildMonthDays(viewYear, viewMonth)
        .map((day) => day.date)
        .filter((date) => isShopClosedDate(date, businessHours, closedDates)),
    );
  }, [state, viewYear, viewMonth]);

  async function handleRemove(date: string) {
    if (busy) return;
    setBusy(true);
    const res = await removeDesignerLeave(supabase, designerId, date);
    if (!mountedRef.current) return;
    showToast(res.ok ? "已移除請假日" : GENERIC_ERROR_TOAST, res.ok ? "success" : "error");
    await reloadLeaves();
    if (mountedRef.current) setBusy(false);
  }

  async function handleDayClick(date: string) {
    if (busy) return;
    if (leaves.has(date)) {
      await handleRemove(date);
      return;
    }
    // MonthPicker 本身已停用過去日期與全店公休日的點擊，這裡是最後一層防呆。
    if (date < today || shopClosedDates.has(date)) return;

    setBusy(true);
    const affectedRes = await findAffectedAppointmentsForDesignerLeave(supabase, designerId, date);
    if (!mountedRef.current) return;
    if (!affectedRes.ok) {
      // 查不到受影響預約就不寫入（fail closed）。
      showToast(GENERIC_ERROR_TOAST, "error");
      setBusy(false);
      return;
    }
    if (affectedRes.data.length > 0) {
      setPendingDate(date);
      setWarningAppointments(affectedRes.data);
      // busy 保持鎖定，直到使用者在警告 Dialog 確認或取消為止。
      return;
    }

    const addRes = await addDesignerLeave(supabase, designerId, date);
    if (!mountedRef.current) return;
    showToast(addRes.ok ? "已標記請假" : GENERIC_ERROR_TOAST, addRes.ok ? "success" : "error");
    await reloadLeaves();
    if (mountedRef.current) setBusy(false);
  }

  async function handleConfirmWithWarning() {
    if (!pendingDate) return;
    setConfirmLoading(true);
    const res = await addDesignerLeave(supabase, designerId, pendingDate);
    if (!mountedRef.current) return;
    showToast(res.ok ? "已標記請假" : GENERIC_ERROR_TOAST, res.ok ? "success" : "error");
    await reloadLeaves();
    if (!mountedRef.current) return;
    setConfirmLoading(false);
    // 失敗時保留警告 Dialog 開啟（比照 ClosedDatesSection），讓店長決定再試或取消。
    if (res.ok) {
      setBusy(false);
      setWarningAppointments(null);
      setPendingDate(null);
    }
  }

  if (state.status === "error") {
    return <Alert severity="error">無法載入請假日設定，請重新整理頁面再試一次。</Alert>;
  }

  if (state.status === "loading") {
    return <Skeleton variant="rounded" height={280} />;
  }

  return (
    <Box>
      <Stack
        direction="row"
        spacing={3}
        sx={{ alignItems: "flex-start", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}
      >
        <Box sx={{ width: 340, flexShrink: 0 }}>
          <MonthPicker
            year={viewYear}
            month={viewMonth}
            todayDate={today}
            markedDates={leaves}
            readOnlyDates={shopClosedDates}
            readOnlyLabel="全店公休"
            onDayClick={handleDayClick}
            onMonthChange={(year, month) => {
              setViewYear(year);
              setViewMonth(month);
            }}
          />
          <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "warning.light", border: "1px solid", borderColor: "grey.300" }} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                個人請假
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "grey.200", border: "1px solid", borderColor: "grey.300" }} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                全店公休
              </Typography>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, borderLeft: "1px solid", borderColor: "grey.200", pl: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", display: "block", mb: 1 }}>
            即將到來的請假
          </Typography>

          {upcoming.length === 0 ? (
            <Alert severity="info">目前沒有排定的請假日</Alert>
          ) : (
            <Stack>
              {upcoming.map((date) => (
                <Stack
                  key={date}
                  direction="row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    py: 0.5,
                    borderBottom: "1px solid",
                    borderColor: "grey.200",
                  }}
                >
                  <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
                    {formatLeaveDate(date)}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    sx={{ minWidth: 0, px: 1 }}
                    aria-label={`移除 ${formatLeaveDate(date)} 的請假日`}
                    onClick={() => handleRemove(date)}
                  >
                    移除
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}

          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1.5 }}>
            點月曆上的日期即可標記或取消請假。全店公休日由「營業時間」頁設定，這裡不能修改。
          </Typography>
        </Box>
      </Stack>

      <ConfirmDialog
        open={warningAppointments !== null}
        title={pendingDate ? `標記 ${formatLeaveDate(pendingDate)}為${designerName}的請假日？` : ""}
        description={
          warningAppointments
            ? `${designerName}當天已經有以下 ${warningAppointments.length} 筆預約。標記請假後，這些預約不會自動取消，也不會通知顧客，請記得另外處理。`
            : undefined
        }
        confirmLabel="仍要標記請假"
        cancelLabel="取消"
        loading={confirmLoading}
        onConfirm={handleConfirmWithWarning}
        onClose={() => {
          if (!confirmLoading) {
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
                spacing={2}
                sx={{ py: 1, borderBottom: "1px solid", borderColor: "grey.200" }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatTaipeiTime(appointment.start_at)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {appointment.customer_name}
                  {appointment.service_name !== "" && ` · ${appointment.service_name}`}
                </Typography>
              </Stack>
            ))}
          </Box>
        )}
      </ConfirmDialog>
    </Box>
  );
}
