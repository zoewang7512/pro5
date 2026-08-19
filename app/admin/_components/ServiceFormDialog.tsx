"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { createClient } from "@/lib/supabase/client";
import {
  createService,
  updateService,
  validateServiceDuration,
  validateServiceName,
  validateServicePrice,
} from "@/lib/admin/services";
import type { Service } from "@/lib/booking/types";
import { useToast } from "@/components/ui/ToastProvider";

// 新增/編輯共用的 Modal 表單，比照 mockup 變體 A：名稱單獨一列，價格/時長並排，
// 描述獨立一列，底部「取消」「新增／儲存」。mode 決定標題文案與呼叫哪支寫入函式，
// 不重複兩份幾乎相同的表單 JSX。

type FormState = {
  name: string;
  price: string;
  durationMinutes: string;
  description: string;
};

function toFormState(service: Service | null): FormState {
  if (!service) return { name: "", price: "", durationMinutes: "", description: "" };
  return {
    name: service.name,
    price: String(service.price),
    durationMinutes: String(service.duration_minutes),
    description: service.description ?? "",
  };
}

export function ServiceFormDialog({
  mode,
  service,
  onClose,
  onSuccess,
}: {
  mode: "create" | "edit";
  service: Service | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  // lazy initializer 只在本元件第一次 render（也就是每次被父層掛載）播種一次，之後
  // 編輯狀態完全由使用者輸入主導，不會被外層重新 render 覆蓋；比照
  // StoreSettingsForm.tsx BasicInfoCard 的既有慣例。父層（ServicesTable.tsx）只在
  // Dialog 該開啟時才掛載本元件（不是常駐掛載靠 open prop 切換），所以每次開啟
  // 都會是全新的元件實例，不需要額外用 effect 監聽「開啟」或「編輯目標切換」重新播種
  // （那樣會在 effect 內同步呼叫 setState，觸發 react-hooks/set-state-in-effect）。
  const [form, setForm] = React.useState<FormState>(() => toFormState(service));
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const priceNumber = Number(form.price);
  const durationNumber = Number(form.durationMinutes);

  const nameError = validateServiceName(form.name);
  const priceError = validateServicePrice(priceNumber);
  const durationError = validateServiceDuration(durationNumber);

  async function handleSubmit() {
    setSubmitAttempted(true);
    if (nameError || priceError || durationError) return;

    setSubmitting(true);
    const input = {
      name: form.name,
      price: priceNumber,
      durationMinutes: durationNumber,
      description: form.description,
    };
    const result =
      mode === "create"
        ? await createService(supabase, input)
        : await updateService(supabase, service!.id, input);
    setSubmitting(false);

    if (result.ok) {
      showToast(mode === "create" ? "服務項目已新增" : "服務項目已更新", "success");
      onSuccess();
    } else {
      showToast("操作失敗，請稍後再試", "error");
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{mode === "create" ? "新增服務項目" : "編輯服務項目"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="名稱"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            error={submitAttempted && Boolean(nameError)}
            helperText={submitAttempted ? nameError : undefined}
            disabled={submitting}
            autoFocus
            fullWidth
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="價格（NT$）"
              type="number"
              value={form.price}
              onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
              error={submitAttempted && Boolean(priceError)}
              helperText={submitAttempted ? priceError : undefined}
              disabled={submitting}
              fullWidth
            />
            <TextField
              label="時長（分鐘）"
              type="number"
              value={form.durationMinutes}
              onChange={(event) => setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
              error={submitAttempted && Boolean(durationError)}
              helperText={submitAttempted ? durationError : undefined}
              disabled={submitting}
              fullWidth
            />
          </Stack>
          <TextField
            label="描述"
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            disabled={submitting}
            multiline
            minRows={2}
            fullWidth
          />
          {mode === "create" && (
            <Typography variant="caption" color="text.secondary">
              新增後預設為上架狀態。
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSubmit} loading={submitting}>
          {mode === "create" ? "新增" : "儲存"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
