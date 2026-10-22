"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  removeStoreImage,
  uploadStoreImage,
  validateStoreImageFile,
  type StoreImageKind,
} from "@/lib/store-settings";

// 圖片上傳元件（Image Upload Field）：本專案首次檔案上傳 UI，依 screen-spec-商店設定.md
// 的視覺設計新做，涵蓋預設（虛線邊框拖放區）／上傳中（遮罩＋載入指示）／預覽（縮圖＋更換／
// 移除）／錯誤（邊框變色＋行內錯誤文字）四態，完成後登記回 design-system.md 的 S4
// inventory。目前只有 TASK-031（Logo／封面圖）這一個使用場景，但設計為可重用的通用元件
// （只認識檔案上傳/驗證/預覽這幾件事，不寫死 store_settings 特定邏輯以外的假設）。
//
// TASK-069 擴充（人工決定，architect／security-reviewer 動工前審查）：新增第二種用法——呼叫端傳入
// onUpload／onRemove，由呼叫端決定檔案怎麼處理（例如設計師頭像：重新編碼、傳到 designer-assets）；
// 加上選填 shape="circle"（圓形頭像預覽，「更換／移除」放在圓形下方）。沒傳 onUpload 時完全走原本的
// 商店設定路徑（kind＋supabase），行為不變。注意：自訂路徑的前置驗證仍用 validateStoreImageFile
// （規則相同：JPG／PNG／WebP、5MB），這是語意上的耦合；失敗訊息則直接顯示呼叫端回傳的 error.message，
// 所以回傳的訊息必須是已經整理過、可以給使用者看的文案（不得是原始錯誤）。

type UploadResult<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

type ImageUploadFieldBaseProps = {
  label: string;
  initialUrl: string | null;
  shape?: "rect" | "circle";
};

export type ImageUploadFieldProps = ImageUploadFieldBaseProps &
  (
    | { kind: StoreImageKind; supabase: SupabaseClient; onUpload?: undefined; onRemove?: undefined }
    | {
        kind?: undefined;
        supabase?: undefined;
        onUpload: (file: File) => Promise<UploadResult<string>>;
        onRemove: () => Promise<UploadResult<unknown>>;
      }
  );

const GENERIC_ERROR = "操作失敗，請稍後再試";
const AVATAR_SIZE = 120;

export function ImageUploadField(props: ImageUploadFieldProps) {
  const { label, initialUrl, shape = "rect" } = props;
  const circle = shape === "circle";
  const [currentUrl, setCurrentUrl] = React.useState<string | null>(initialUrl);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // 元件卸載後（例如切到別的後台頁面）仍在途的上傳/移除不應該再 setState——
  // 比照 StoreSettingsForm.tsx 既有的 cancelled guard 模式（security-reviewer
  // TASK-031 審查建議）。
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const displayUrl = previewUrl ?? currentUrl;

  async function handleFile(file: File) {
    setErrorMessage(null);

    const validationError = validateStoreImageFile(file);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setBusy(true);

    // try/finally：確保無論 uploadStoreImage 是否意外拋出例外，objectURL 一定會被
    // 釋放、busy 一定會解除，不會卡在「處理中…」且更換／移除按鈕永遠不出現（busy 時
    // 兩顆按鈕本來就不渲染）（security-reviewer TASK-031 審查建議）。
    try {
      const res = props.onUpload ? await props.onUpload(file) : await uploadStoreImage(props.supabase, props.kind, file);
      if (!mountedRef.current) return;
      if (res.ok) {
        setCurrentUrl(res.data);
      } else {
        setErrorMessage(props.onUpload ? res.error.message : GENERIC_ERROR);
      }
    } catch {
      if (mountedRef.current) setErrorMessage(GENERIC_ERROR);
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (mountedRef.current) {
        setPreviewUrl(null);
        setBusy(false);
      }
    }
  }

  async function handleRemove() {
    setErrorMessage(null);
    setBusy(true);
    try {
      const res = props.onRemove ? await props.onRemove() : await removeStoreImage(props.supabase, props.kind);
      if (!mountedRef.current) return;
      if (res.ok) {
        setCurrentUrl(null);
      } else {
        setErrorMessage(props.onRemove ? res.error.message : GENERIC_ERROR);
      }
    } catch {
      if (mountedRef.current) setErrorMessage(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function openFilePicker() {
    if (busy) return;
    inputRef.current?.click();
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, display: "block", mb: 0.5 }}>
        {label}
      </Typography>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) handleFile(file);
        }}
      />

      {circle ? (
        <Box>
          {displayUrl ? (
            <Box
              sx={{ position: "relative", width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: "50%", overflow: "hidden" }}
            >
              <Box
                component="img"
                src={displayUrl}
                alt={label}
                sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              {busy && (
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
                  <CircularProgress size={20} sx={{ color: "#fff" }} aria-label="處理中" />
                </Box>
              )}
            </Box>
          ) : (
            <Box
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-label={`上傳${label}`}
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
                const file = event.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              sx={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: "50%",
                border: "1.5px dashed",
                borderColor: errorMessage ? "error.main" : "grey.300",
                bgcolor: errorMessage ? "error.light" : "grey.100",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                px: 2,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? (
                <CircularProgress size={20} />
              ) : (
                <Typography variant="caption" sx={{ color: errorMessage ? "error.main" : "text.secondary" }}>
                  點擊或拖曳上傳
                </Typography>
              )}
            </Box>
          )}

          {displayUrl && !busy && (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" variant="outlined" onClick={openFilePicker}>
                更換
              </Button>
              <Button size="small" color="error" onClick={handleRemove}>
                移除
              </Button>
            </Stack>
          )}
          <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 0.5 }}>
            JPG／PNG／WebP，5MB 內
          </Typography>
        </Box>
      ) : displayUrl ? (
        <Box sx={{ position: "relative", height: 120, borderRadius: 1, overflow: "hidden" }}>
          <Box
            component="img"
            src={displayUrl}
            alt={label}
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "flex-start",
              gap: 0.75,
              p: 1,
            }}
          >
            {!busy && (
              <>
                <Box
                  component="button"
                  type="button"
                  onClick={openFilePicker}
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    px: 1.25,
                    py: 0.5,
                    borderRadius: 999,
                    bgcolor: "rgba(255,255,255,.92)",
                    color: "text.primary",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  更換
                </Box>
                <Box
                  component="button"
                  type="button"
                  onClick={handleRemove}
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    px: 1.25,
                    py: 0.5,
                    borderRadius: 999,
                    bgcolor: "rgba(255,255,255,.92)",
                    color: "error.main",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  移除
                </Box>
              </>
            )}
          </Box>
          {busy && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                bgcolor: "rgba(43,38,34,.55)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                color: "#fff",
              }}
            >
              <CircularProgress size={20} sx={{ color: "#fff" }} />
              <Typography variant="caption" sx={{ color: "#fff" }}>
                處理中…
              </Typography>
            </Box>
          )}
        </Box>
      ) : (
        <Box
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-label={`上傳${label}`}
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
            const file = event.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          sx={{
            height: 120,
            borderRadius: 1,
            border: "1.5px dashed",
            borderColor: errorMessage ? "error.main" : "grey.300",
            bgcolor: errorMessage ? "error.light" : "grey.100",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.5,
            color: "text.disabled",
            fontSize: 12,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            textAlign: "center",
            px: 2,
          }}
        >
          {busy ? (
            <CircularProgress size={20} />
          ) : (
            <>
              <Typography variant="body2" sx={{ color: errorMessage ? "error.main" : "text.secondary" }}>
                點擊或拖曳圖片上傳
              </Typography>
              <Typography variant="caption" sx={{ color: "text.disabled" }}>
                JPG／PNG／WebP，5MB 內
              </Typography>
            </>
          )}
        </Box>
      )}

      {errorMessage && (
        <Typography variant="caption" sx={{ color: "error.main", display: "block", mt: 0.5 }}>
          {errorMessage}
        </Typography>
      )}
    </Box>
  );
}
