"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { createClient } from "@/lib/supabase/client";
import {
  getBookingPolicy,
  updateBookingPolicy,
  validateCancelWindowHours,
  validateMinLeadTimeHours,
  type BookingPolicy,
  type BookingPolicyInput,
} from "@/lib/booking-policy";
import { useToast } from "@/components/ui/ToastProvider";

// TASK-046：頁面骨架＋唯讀顯示（比照 StoreSettingsForm.tsx／BusinessHoursForm.tsx 的
// 既有「fetch 結果存 state＋cancelled guard」模式）。TASK-047：接上編輯／驗證／儲存
// （比照 StoreSettingsForm.tsx 的 BasicInfoCard 既有寫法：獨立管理自己的編輯狀態，
// 只在掛載當下用 lazy initializer 從 props 播種一次，之後編輯狀態完全由使用者輸入主導）。

// 顧客前台（BookingFlow.tsx）只提供未來 14 天的可選日期（DATE_RANGE_DAYS），若
// min_lead_time_hours 設得超過這個範圍，顧客端會完全看不到任何可預約時段，且沒有任何
// 錯誤提示或稽核記錄——與公休日、額滿完全無法區分，錯植或帳號被盜用都會靜默關掉整個
// 預約功能（security-reviewer 於 TASK-050 Epic 總覽性審查發現）。這裡只做非阻斷性警示
// （仍可儲存，畢竟這是管理員的合法設定選擇，不是要擋下），沒有從 lib/booking/ 匯入
// DATE_RANGE_DAYS 共用常數——那個常數屬顧客前台模組，比照既有「後台不 import 顧客前台
// 內部模組」的分層方向，改用同樣數值（14 天＝336 小時）搭配這則註解手動保持同步。
const CUSTOMER_VISIBLE_DATE_RANGE_HOURS = 14 * 24;

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; policy: BookingPolicy };

function toInput(policy: BookingPolicy): BookingPolicyInput {
  return {
    min_lead_time_hours: String(policy.min_lead_time_hours),
    cancel_window_hours: policy.cancel_window_hours == null ? "" : String(policy.cancel_window_hours),
  };
}

function PolicyCard({ initial, supabase }: { initial: BookingPolicy; supabase: ReturnType<typeof createClient> }) {
  const { showToast } = useToast();
  const [fields, setFields] = React.useState<BookingPolicyInput>(() => toInput(initial));
  const [savedFields, setSavedFields] = React.useState<BookingPolicyInput>(fields);
  const [submitting, setSubmitting] = React.useState(false);
  const [touched, setTouched] = React.useState<Set<keyof BookingPolicyInput>>(new Set());
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const minLeadTimeRef = React.useRef<HTMLInputElement | null>(null);

  const errors = React.useMemo(
    () => ({
      min_lead_time_hours: validateMinLeadTimeHours(fields.min_lead_time_hours),
      cancel_window_hours: validateCancelWindowHours(fields.cancel_window_hours),
    }),
    [fields],
  );

  const hasChanges =
    fields.min_lead_time_hours !== savedFields.min_lead_time_hours ||
    fields.cancel_window_hours !== savedFields.cancel_window_hours;

  const minLeadTimeHoursValue = Number(fields.min_lead_time_hours);
  const exceedsCustomerVisibleRange =
    !errors.min_lead_time_hours && minLeadTimeHoursValue > CUSTOMER_VISIBLE_DATE_RANGE_HOURS;

  function markTouched(field: keyof BookingPolicyInput) {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  function helperText(field: "min_lead_time_hours" | "cancel_window_hours", description: string): string {
    const showError = touched.has(field) || submitAttempted;
    return (showError ? errors[field] : null) ?? description;
  }

  async function handleSubmit() {
    setSubmitAttempted(true);
    if (errors.min_lead_time_hours || errors.cancel_window_hours) {
      minLeadTimeRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await updateBookingPolicy(supabase, fields);
      if (res.ok) {
        setSavedFields(fields);
        showToast("預約規則已更新", "success");
      } else {
        showToast("操作失敗，請稍後再試", "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5, maxWidth: 480 }}>
      <Stack spacing={2}>
        <TextField
          label="最短提前預約時間（小時）"
          size="small"
          fullWidth
          type="number"
          disabled={submitting}
          value={fields.min_lead_time_hours}
          onChange={(event) => setFields((prev) => ({ ...prev, min_lead_time_hours: event.target.value }))}
          onBlur={() => markTouched("min_lead_time_hours")}
          error={Boolean((touched.has("min_lead_time_hours") || submitAttempted) && errors.min_lead_time_hours)}
          helperText={helperText("min_lead_time_hours", "顧客需在預約時段開始前至少這麼多小時完成預約")}
          inputRef={minLeadTimeRef}
        />
        {exceedsCustomerVisibleRange && (
          <Alert severity="warning">
            顧客前台只顯示未來 14 天（{CUSTOMER_VISIBLE_DATE_RANGE_HOURS} 小時）內的可預約
            日期，設定超過這個範圍會讓顧客完全看不到任何可預約時段。仍可儲存，請確認這是
            您要的設定。
          </Alert>
        )}
        <TextField
          label="可取消／改期時限（小時）"
          size="small"
          fullWidth
          type="number"
          disabled={submitting}
          value={fields.cancel_window_hours}
          onChange={(event) => setFields((prev) => ({ ...prev, cancel_window_hours: event.target.value }))}
          onBlur={() => markTouched("cancel_window_hours")}
          error={Boolean((touched.has("cancel_window_hours") || submitAttempted) && errors.cancel_window_hours)}
          helperText={helperText(
            "cancel_window_hours",
            "留空代表不限制；顧客需在預約時段開始前至少這麼多小時完成取消或改期",
          )}
        />

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="contained" onClick={handleSubmit} loading={submitting} disabled={!hasChanges}>
            儲存
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

export function BookingPolicyForm() {
  const supabase = React.useMemo(() => createClient(), []);
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    getBookingPolicy(supabase).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { status: "loaded", policy: res.data } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Typography variant="h6" component="h2">
        預約規則
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
        設定最短提前預約時間與可取消／改期時限，會影響顧客端可預約時段計算與政策說明文字
      </Typography>

      {state.status === "error" && (
        <Alert severity="error">無法載入預約規則設定，請重新整理再試一次。</Alert>
      )}

      {state.status === "loading" && (
        <Paper variant="outlined" sx={{ p: 2.5, maxWidth: 480 }}>
          <Stack spacing={2.5}>
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
          </Stack>
        </Paper>
      )}

      {state.status === "loaded" && <PolicyCard initial={state.policy} supabase={supabase} />}
    </Box>
  );
}
