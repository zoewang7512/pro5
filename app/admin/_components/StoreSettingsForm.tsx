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
  getStoreSettings,
  updateStoreSettingsBasicInfo,
  validateStoreDescription,
  validateStoreName,
  validateStorePhone,
  type StoreSettings,
} from "@/lib/store-settings";
import { useToast } from "@/components/ui/ToastProvider";
import { ImageUploadField } from "@/components/ui/ImageUploadField";

// TASK-029：頁面骨架＋唯讀顯示。TASK-030：「基本資訊」卡片接上編輯／驗證／儲存。
// TASK-031：「品牌圖片」卡片接上 ImageUploadField（Logo/封面圖上傳／更換／移除）——沿用
// BusinessHoursForm.tsx 的頁面骨架與「fetch 結果存 state＋cancelled guard」既有模式。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; settings: StoreSettings };

type BasicInfoFields = {
  name: string;
  address: string;
  phone: string;
  description: string;
};

// 「基本資訊」卡片獨立管理自己的編輯狀態與儲存動作（比照已核准 mockup 變體 B：分卡片、
// 各自獨立動作），與「品牌圖片」卡片（TASK-031）互不阻塞。只在掛載當下（settings 載入完成、
// 本元件第一次 render）用 lazy initializer 從 props 播種一次，之後編輯狀態完全由使用者輸入
// 主導，不會被外層重新 render 覆蓋。
function BasicInfoCard({ initial, supabase }: { initial: StoreSettings; supabase: ReturnType<typeof createClient> }) {
  const { showToast } = useToast();
  const [fields, setFields] = React.useState<BasicInfoFields>(() => ({
    name: initial.name,
    address: initial.address ?? "",
    phone: initial.phone ?? "",
    description: initial.description ?? "",
  }));
  const [savedFields, setSavedFields] = React.useState<BasicInfoFields>(fields);
  const [submitting, setSubmitting] = React.useState(false);
  const [touched, setTouched] = React.useState<Set<keyof BasicInfoFields>>(new Set());
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement | null>(null);

  const errors = React.useMemo(
    () => ({
      name: validateStoreName(fields.name),
      phone: validateStorePhone(fields.phone),
      description: validateStoreDescription(fields.description),
    }),
    [fields],
  );

  const hasChanges =
    fields.name !== savedFields.name ||
    fields.address !== savedFields.address ||
    fields.phone !== savedFields.phone ||
    fields.description !== savedFields.description;

  function markTouched(field: keyof BasicInfoFields) {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  function showError(field: "name" | "phone" | "description"): string | null {
    return touched.has(field) || submitAttempted ? errors[field] : null;
  }

  async function handleSubmit() {
    setSubmitAttempted(true);
    if (errors.name || errors.phone || errors.description) {
      nameRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const res = await updateStoreSettingsBasicInfo(supabase, fields);
      if (res.ok) {
        setSavedFields(fields);
        showToast("已儲存", "success");
      } else {
        showToast("操作失敗，請稍後再試", "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5, flex: 1.3, width: "100%" }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.75 }}>
        基本資訊
      </Typography>

      <Stack spacing={2}>
        <TextField
          label="店名"
          size="small"
          fullWidth
          value={fields.name}
          disabled={submitting}
          onChange={(event) => setFields((prev) => ({ ...prev, name: event.target.value }))}
          onBlur={() => markTouched("name")}
          error={Boolean(showError("name"))}
          helperText={showError("name") ?? " "}
          inputRef={nameRef}
        />
        <TextField
          label="電話"
          size="small"
          fullWidth
          value={fields.phone}
          disabled={submitting}
          onChange={(event) => setFields((prev) => ({ ...prev, phone: event.target.value }))}
          onBlur={() => markTouched("phone")}
          error={Boolean(showError("phone"))}
          helperText={showError("phone") ?? " "}
        />
        <TextField
          label="地址"
          size="small"
          fullWidth
          value={fields.address}
          disabled={submitting}
          onChange={(event) => setFields((prev) => ({ ...prev, address: event.target.value }))}
        />
        <TextField
          label="簡介"
          size="small"
          fullWidth
          multiline
          minRows={3}
          value={fields.description}
          disabled={submitting}
          onChange={(event) => setFields((prev) => ({ ...prev, description: event.target.value }))}
          onBlur={() => markTouched("description")}
          error={Boolean(showError("description"))}
          helperText={showError("description") ?? " "}
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

export function StoreSettingsForm() {
  const supabase = React.useMemo(() => createClient(), []);
  const [state, setState] = React.useState<LoadState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    getStoreSettings(supabase).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { status: "loaded", settings: res.data } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Typography variant="h6" component="h2">
        商店設定
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
        設定店家基本資訊與品牌圖片，顧客前台會同步顯示
      </Typography>

      {state.status === "error" && (
        <Alert severity="error">無法載入商店設定，請重新整理再試一次。</Alert>
      )}

      {state.status !== "error" && (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} sx={{ alignItems: "flex-start" }}>
          {state.status === "loading" ? (
            <Paper variant="outlined" sx={{ p: 2.5, flex: 1.3, width: "100%" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.75 }}>
                基本資訊
              </Typography>
              <Stack spacing={1.5}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="rounded" height={36} />
                ))}
              </Stack>
            </Paper>
          ) : (
            <BasicInfoCard initial={state.settings} supabase={supabase} />
          )}

          <Paper variant="outlined" sx={{ p: 2.5, flex: 1, width: "100%" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.75 }}>
              品牌圖片
            </Typography>
            {state.status === "loading" ? (
              <Stack spacing={1.5}>
                <Skeleton variant="rounded" height={120} />
                <Skeleton variant="rounded" height={120} />
              </Stack>
            ) : (
              <>
                <ImageUploadField label="Logo" kind="logo" initialUrl={state.settings.logo_url} supabase={supabase} />
                <ImageUploadField
                  label="封面圖"
                  kind="cover"
                  initialUrl={state.settings.cover_image_url}
                  supabase={supabase}
                />
              </>
            )}
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
