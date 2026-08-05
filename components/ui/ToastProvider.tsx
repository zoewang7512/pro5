"use client";

import * as React from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert, { AlertColor } from "@mui/material/Alert";

type Toast = { id: number; message: string; severity: AlertColor };

type ToastContextValue = {
  showToast: (message: string, severity?: AlertColor) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必須在 ToastProvider 內使用");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  // 一次只顯示佇列最前面一則；用 key={current.id} 讓換訊息時重新觸發 enter transition，
  // 不需要額外的 open/close 狀態機（也避免在 effect 內 setState 觸發連鎖渲染）。
  const [queue, setQueue] = React.useState<Toast[]>([]);
  const current = queue[0] ?? null;

  const showToast = React.useCallback((message: string, severity: AlertColor = "info") => {
    setQueue((prev) => [...prev, { id: Date.now() + Math.random(), message, severity }]);
  }, []);

  const handleClose = (_event: unknown, reason?: string) => {
    if (reason === "clickaway") return;
    setQueue((prev) => prev.slice(1));
  };

  const value = React.useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.id}
        open={current !== null}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {current ? (
          <Alert onClose={handleClose} severity={current.severity} variant="filled" sx={{ borderRadius: 2 }}>
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}
