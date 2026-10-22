"use client";

import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  // 額外內容區塊，渲染在 description 下方（例如受影響預約清單）。單純文字用
  // description 就夠，只有需要結構化內容（清單、表格）時才用這個 prop——避免每種
  // 二次確認情境都另建一個幾乎一樣的 Dialog。
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: "primary" | "error";
  loading?: boolean;
  // 讓取消鈕成為預設焦點，避免按 Enter 誤觸破壞性的確認鈕（例如「放棄變更」，TASK-081）。
  // 預設 false，既有呼叫端行為不變。
  autoFocusCancel?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "確認",
  cancelLabel = "取消",
  confirmColor = "primary",
  loading = false,
  autoFocusCancel = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="confirm-dialog-title"
      // autoFocus 在對話框掛載當下無效：淡入動畫期間內容是 visibility:hidden，不可見的元素無法取得焦點，
      // MUI 的 FocusTrap 隨後把焦點給對話框容器（瀏覽器實測發現；jsdom 沒有動畫所以單元測試看不出來）。
      // 所以動畫結束後再明確把焦點給取消鈕。
      slotProps={autoFocusCancel ? { transition: { onEntered: () => cancelButtonRef.current?.focus() } } : undefined}
    >
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      {(description || children) && (
        <DialogContent>
          {description && <DialogContentText>{description}</DialogContentText>}
          {children}
        </DialogContent>
      )}
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button ref={cancelButtonRef} variant="outlined" onClick={onClose} disabled={loading} autoFocus={autoFocusCancel}>
          {cancelLabel}
        </Button>
        <Button variant="contained" color={confirmColor} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
