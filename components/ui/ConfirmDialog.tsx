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
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="confirm-dialog-title">
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      {(description || children) && (
        <DialogContent>
          {description && <DialogContentText>{description}</DialogContentText>}
          {children}
        </DialogContent>
      )}
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant="contained" color={confirmColor} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
