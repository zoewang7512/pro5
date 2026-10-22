"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { portfolioLimitMessage } from "@/lib/designers";

// 作品集格狀管理（Portfolio Manager）：TASK-071 為設計師作品集新做的元件，依 screen-spec-後台設計師管理.md
// 畫面 5 與既有 ImageUploadField 的虛線上傳格、spinner 樣式製作，完成後登記回 design-system.md 的 S4 inventory。
//
// 純展示元件：不認識 Supabase 或 lib/admin，檔案驗證與上傳／刪除流程都由呼叫端的 onUpload／onDelete 負責
// （回傳 error.message 必須是整理過、可以直接顯示的文案，不得是原始錯誤）。items 的 src 為 null 代表網址沒有
// 通過白名單：仍畫成「圖片無法顯示」的佔位格，照樣算進張數、照樣可以刪除，否則會出現 12 張只畫 11 格、上傳停用、
// 壞圖又刪不掉的死結。
//
// 一次只做一件事：上傳中或刪除中，上傳格與所有刪除按鈕一律停用（單一 busy 鎖），清單競態因此不存在。
// 一次只傳一張：<input> 不加 multiple，拖放多檔時只取第一張並提示。

export type PortfolioItem = { id: string; src: string | null };

export type PortfolioActionResult = { ok: true } | { ok: false; error: { message: string } };

export type PortfolioManagerProps = {
  items: PortfolioItem[];
  maxImages: number;
  onUpload: (file: File) => Promise<PortfolioActionResult>;
  onDelete: (id: string) => Promise<PortfolioActionResult>;
};

const GENERIC_ERROR = "操作失敗，請稍後再試";
const MULTI_FILE_NOTICE = "一次只能上傳一張，已使用第一張";

export function PortfolioManager({ items, maxImages, onUpload, onDelete }: PortfolioManagerProps) {
  const [uploading, setUploading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // 元件卸載（例如切到別的後台頁面）後仍在途的上傳／刪除不應該再 setState，比照 ImageUploadField。
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const busy = uploading || deletingId !== null;
  const atLimit = items.length >= maxImages;
  const addDisabled = busy || atLimit;

  async function startUpload(files: File[]) {
    if (addDisabled) return;
    const file = files[0];
    if (!file) return;

    setErrorMessage(null);
    setNotice(files.length > 1 ? MULTI_FILE_NOTICE : null);
    setUploading(true);
    try {
      const result = await onUpload(file);
      if (mountedRef.current && !result.ok) setErrorMessage(result.error.message);
    } catch {
      if (mountedRef.current) setErrorMessage(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }

  async function confirmDelete() {
    const id = confirmId;
    if (id === null || busy) return;

    setErrorMessage(null);
    setNotice(null);
    setDeletingId(id);
    try {
      const result = await onDelete(id);
      if (mountedRef.current && !result.ok) setErrorMessage(result.error.message);
    } catch {
      if (mountedRef.current) setErrorMessage(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) {
        setDeletingId(null);
        setConfirmId(null);
      }
    }
  }

  function openFilePicker() {
    if (addDisabled) return;
    inputRef.current?.click();
  }

  return (
    <Paper variant="outlined">
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2, flexWrap: "wrap", px: 3, py: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {items.length} / {maxImages} 張
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          JPG／PNG／WebP，單張 5MB 以內 · 依上傳時間排序，最新的在最前面
        </Typography>
      </Box>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        data-testid="portfolio-file-input"
        style={{ display: "none" }}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          startUpload(files);
        }}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(3, 1fr)", sm: "repeat(4, 1fr)", md: "repeat(6, 1fr)" },
          gap: 1.5,
          px: 3,
          pb: 3,
          "& > *": { aspectRatio: "1", borderRadius: 1, position: "relative", minWidth: 0 },
        }}
      >
        <Box
          role="button"
          tabIndex={addDisabled ? -1 : 0}
          aria-label="上傳作品"
          aria-disabled={addDisabled}
          onClick={openFilePicker}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openFilePicker();
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            startUpload(Array.from(event.dataTransfer.files ?? []));
          }}
          sx={{
            border: "2px dashed",
            borderColor: errorMessage ? "error.main" : "grey.300",
            bgcolor: errorMessage ? "error.light" : "transparent",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
            textAlign: "center",
            px: 1,
            cursor: addDisabled ? "default" : "pointer",
            opacity: addDisabled ? 0.6 : 1,
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
          }}
        >
          {atLimit ? (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {portfolioLimitMessage(maxImages)}
            </Typography>
          ) : (
            <>
              <Typography component="span" sx={{ fontSize: 24, lineHeight: 1, color: "grey.500" }}>
                ＋
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                上傳作品
              </Typography>
            </>
          )}
        </Box>

        {uploading && (
          <Box sx={{ bgcolor: "grey.200", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CircularProgress size={24} aria-label="上傳中" />
          </Box>
        )}

        {items.map((item, index) => {
          const position = index + 1;
          const deleting = deletingId === item.id;
          return (
            <Box key={item.id} sx={{ overflow: "hidden", bgcolor: "grey.100" }}>
              {item.src ? (
                <Box
                  component="img"
                  src={item.src}
                  alt={`作品 ${position}`}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", px: 1 }}>
                  <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center" }}>
                    圖片無法顯示
                  </Typography>
                </Box>
              )}

              <Box
                component="button"
                type="button"
                aria-label={`刪除第 ${position} 張作品`}
                disabled={busy}
                onClick={() => setConfirmId(item.id)}
                sx={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "none",
                  p: 0,
                  bgcolor: "rgba(43,38,34,.7)",
                  color: "#fff",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.5 : 1,
                  "&:focus-visible": { outline: "2px solid #fff", outlineOffset: 1 },
                }}
              >
                ×
              </Box>

              {deleting && (
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    bgcolor: "rgba(43,38,34,.55)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <CircularProgress size={20} sx={{ color: "#fff" }} aria-label="刪除中" />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {items.length === 0 && !uploading && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", px: 3, pb: 3, mt: -1.5 }}>
          還沒有作品，上傳第一張吧
        </Typography>
      )}

      {(errorMessage || notice) && (
        <Box sx={{ px: 3, pb: 2 }}>
          {errorMessage && (
            <Typography variant="caption" role="alert" sx={{ color: "error.main", display: "block" }}>
              {errorMessage}
            </Typography>
          )}
          {notice && (
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {notice}
            </Typography>
          )}
        </Box>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="刪除這張作品？"
        description="刪除後無法復原，這張照片也會從預約頁移除。"
        confirmLabel="刪除"
        confirmColor="error"
        loading={deletingId !== null}
        onConfirm={confirmDelete}
        onClose={() => {
          if (deletingId === null) setConfirmId(null);
        }}
      />
    </Paper>
  );
}
