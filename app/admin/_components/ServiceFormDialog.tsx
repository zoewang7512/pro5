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
  validateServiceBuffer,
  validateServiceDuration,
  validateServiceName,
  validateServicePrice,
} from "@/lib/admin/services";
import type { AdminService } from "@/lib/booking/types";
import { useToast } from "@/components/ui/ToastProvider";
import { useUnsavedChangesActions, useUnsavedChangesGuard } from "./UnsavedChangesProvider";

// 新增/編輯共用的 Modal 表單，比照 mockup 變體 A：名稱單獨一列，價格/時長/緩衝時間
// 並排（TASK-078 新增緩衝時間），描述獨立一列，底部「取消」「新增／儲存」。mode 決定
// 標題文案與呼叫哪支寫入函式，不重複兩份幾乎相同的表單 JSX。

type FormState = {
  name: string;
  price: string;
  durationMinutes: string;
  bufferMinutes: string;
  description: string;
};

function toFormState(service: AdminService | null): FormState {
  if (!service) return { name: "", price: "", durationMinutes: "", bufferMinutes: "0", description: "" };
  return {
    name: service.name,
    price: String(service.price),
    durationMinutes: String(service.duration_minutes),
    bufferMinutes: String(service.buffer_minutes),
    description: service.description ?? "",
  };
}

function sameForm(a: FormState, b: FormState): boolean {
  return (
    a.name === b.name &&
    a.price === b.price &&
    a.durationMinutes === b.durationMinutes &&
    a.bufferMinutes === b.bufferMinutes &&
    a.description === b.description
  );
}

export function ServiceFormDialog({
  mode,
  service,
  onClose,
  onSuccess,
}: {
  mode: "create" | "edit";
  service: AdminService | null;
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
  // 未儲存變更提示（TASK-083，key service-form）：與開啟當下的初始值（新增：空白預設；編輯：該服務目前值）比對。
  // 同樣用 lazy initializer 只存一份，之後不隨外層 render 變動。
  const [initialForm] = React.useState<FormState>(() => toFormState(service));
  const dirty = !sameForm(form, initialForm);
  useUnsavedChangesGuard("service-form", dirty);
  const { confirmIfDirty } = useUnsavedChangesActions();
  // 背景、Esc、「取消」都走這裡：有變更時先提示（疊在本對話框之上），選「放棄變更」才真的關閉。
  // 只看 service-form 這個 key，不被頁面上別的表單誤觸發。儲存中維持現況（不可關閉、不提示）。
  // 觸發按鈕（「新增服務項目」或列上的「編輯」）：本元件只在開啟時才掛載，第一次 render 時焦點還在它身上。
  // 選「放棄變更」時提示與本對話框在同一個 commit 一起卸載，提示層要還原焦點的目標（本對話框內的輸入框）
  // 已不在 DOM，焦點會掉到 body（瀏覽器實測發現；jsdom 看不出來），所以關閉後明確把焦點還給觸發按鈕。
  const [returnFocusTo] = React.useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  function closeAndRestoreFocus() {
    onClose();
    setTimeout(() => {
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    }, 0);
  }
  function requestClose() {
    confirmIfDirty(closeAndRestoreFocus, { key: "service-form" });
  }
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const priceNumber = Number(form.price);
  const durationNumber = Number(form.durationMinutes);

  const nameError = validateServiceName(form.name);
  const priceError = validateServicePrice(priceNumber);
  const durationError = validateServiceDuration(durationNumber);
  const bufferError = validateServiceBuffer(form.bufferMinutes);

  async function handleSubmit() {
    setSubmitAttempted(true);
    if (nameError || priceError || durationError || bufferError) return;

    setSubmitting(true);
    const input = {
      name: form.name,
      price: priceNumber,
      durationMinutes: durationNumber,
      bufferMinutes: Number(form.bufferMinutes),
      description: form.description,
    };
    const result =
      mode === "create"
        ? await createService(supabase, input)
        : await updateService(supabase, service!.id, input);
    setSubmitting(false);

    if (result.ok) {
      // 新增的服務不會寫 designer_services（見 TASK-070），提示店長到設計師頁開啟，否則前台沒有時段可選。
      showToast(
        mode === "create" ? "已新增服務。新服務預設不開給任何設計師，請到「設計師」頁開啟。" : "服務項目已更新",
        "success",
      );
      onSuccess();
    } else {
      showToast("操作失敗，請稍後再試", "error");
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : requestClose} fullWidth maxWidth="sm">
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
            <TextField
              label="緩衝時間（分鐘）"
              type="number"
              value={form.bufferMinutes}
              onChange={(event) => setForm((prev) => ({ ...prev, bufferMinutes: event.target.value }))}
              error={submitAttempted && Boolean(bufferError)}
              helperText={submitAttempted ? bufferError : undefined}
              disabled={submitting}
              fullWidth
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            緩衝時間：服務結束後保留的整理時間，這段時間不開放下一筆預約。修改後只影響之後的預約。
          </Typography>
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
        <Button onClick={requestClose} disabled={submitting}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSubmit} loading={submitting}>
          {mode === "create" ? "新增" : "儲存"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
