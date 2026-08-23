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
import { getBookingPolicy, type BookingPolicy } from "@/lib/booking-policy";

// TASK-046：頁面骨架＋唯讀顯示（比照 StoreSettingsForm.tsx／BusinessHoursForm.tsx 的
// 既有「fetch 結果存 state＋cancelled guard」模式）。TASK-047 接上編輯／驗證／儲存。
// 「儲存」按鈕先渲染但停用：欄位本身尚未可編輯，可點擊卻無行為的按鈕只會造成困惑。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; policy: BookingPolicy };

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

      {state.status !== "error" && (
        <Paper variant="outlined" sx={{ p: 2.5, maxWidth: 480 }}>
          {state.status === "loading" ? (
            <Stack spacing={2.5}>
              <Skeleton variant="rounded" height={56} />
              <Skeleton variant="rounded" height={56} />
            </Stack>
          ) : (
            <Stack spacing={2}>
              <TextField
                label="最短提前預約時間（小時）"
                size="small"
                fullWidth
                disabled
                value={state.policy.min_lead_time_hours}
                helperText="顧客需在預約時段開始前至少這麼多小時完成預約"
              />
              <TextField
                label="可取消／改期時限（小時）"
                size="small"
                fullWidth
                disabled
                value={state.policy.cancel_window_hours ?? ""}
                helperText="留空代表不限制；顧客需在預約時段開始前至少這麼多小時完成取消或改期"
              />

              <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="contained" disabled>
                  儲存
                </Button>
              </Box>
            </Stack>
          )}
        </Paper>
      )}
    </Box>
  );
}
