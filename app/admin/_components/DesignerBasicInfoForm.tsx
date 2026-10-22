"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import InputAdornment from "@mui/material/InputAdornment";
import { createClient } from "@/lib/supabase/client";
import {
  createDesigner,
  removeDesignerAvatar,
  updateDesignerBasicInfo,
  uploadDesignerAvatar,
  type DesignerBasicInfoInput,
} from "@/lib/admin/designers";
import {
  DESIGNER_BIO_MAX_LENGTH,
  DESIGNER_NAME_MAX_LENGTH,
  DESIGNER_SPECIALTIES_MAX_COUNT,
  DESIGNER_SPECIALTY_MAX_LENGTH,
  normalizeInstagramHandle,
  normalizeSpecialties,
  resolveDesignerAssetUrl,
  validateDesignerBio,
  validateDesignerName,
  validateDesignerSpecialties,
  validateInstagramHandle,
  type Designer,
} from "@/lib/designers";
import { useToast } from "@/components/ui/ToastProvider";
import { ImageUploadField } from "@/components/ui/ImageUploadField";

// 「基本資料」頁籤（TASK-069）：名稱、Instagram、專長標籤、簡介、頭像。按底部「儲存」才寫入；頭像上傳／
// 移除是立即生效（需要設計師 id 才有儲存路徑，所以新增模式在建立前先停用，建立成功後才開放）。

type Fields = DesignerBasicInfoInput;

type Props = {
  // null＝新增模式
  designer: Designer | null;
  onCreated: (id: string) => void;
  onSaved: (fields: { name: string; bio: string | null; specialties: string[]; instagram_handle: string | null }) => void;
  onAvatarChange: (avatarUrl: string | null) => void;
};

function toFields(designer: Designer | null): Fields {
  return {
    name: designer?.name ?? "",
    instagram: designer?.instagram_handle ?? "",
    specialties: designer?.specialties ?? [],
    bio: designer?.bio ?? "",
  };
}

// 送出後把輸入欄位改成實際寫入的樣子（去 @、去前後空白等），畫面與資料庫一致。
function normalizeFields(fields: Fields): Fields {
  return {
    name: fields.name.trim(),
    instagram: normalizeInstagramHandle(fields.instagram) ?? "",
    specialties: normalizeSpecialties(fields.specialties),
    bio: fields.bio.replace(/\r\n?/g, "\n").trim(),
  };
}

function sameFields(a: Fields, b: Fields): boolean {
  return (
    a.name === b.name &&
    a.instagram === b.instagram &&
    a.bio === b.bio &&
    a.specialties.length === b.specialties.length &&
    a.specialties.every((tag, index) => tag === b.specialties[index])
  );
}

export function DesignerBasicInfoForm({ designer, onCreated, onSaved, onAvatarChange }: Props) {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const isCreate = designer === null;

  const [fields, setFields] = React.useState<Fields>(() => toFields(designer));
  const [savedFields, setSavedFields] = React.useState<Fields>(() => toFields(designer));
  const [submitting, setSubmitting] = React.useState(false);
  const [submitAttempted, setSubmitAttempted] = React.useState(false);
  const [touched, setTouched] = React.useState<Set<keyof Fields>>(new Set());
  const nameRef = React.useRef<HTMLInputElement | null>(null);

  const errors = React.useMemo(
    () => ({
      name: validateDesignerName(fields.name),
      instagram: validateInstagramHandle(fields.instagram),
      specialties: validateDesignerSpecialties(fields.specialties),
      bio: validateDesignerBio(fields.bio),
    }),
    [fields],
  );

  const hasChanges = isCreate || !sameFields(normalizeFields(fields), savedFields);

  function markTouched(field: keyof Fields) {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }

  function visibleError(field: keyof Fields): string | null {
    return touched.has(field) || submitAttempted ? errors[field] : null;
  }

  async function handleSubmit() {
    setSubmitAttempted(true);
    if (errors.name || errors.instagram || errors.specialties || errors.bio) {
      nameRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      if (designer === null) {
        const res = await createDesigner(supabase, fields);
        if (res.ok) {
          showToast("設計師已新增", "success");
          onCreated(res.data.id);
        } else {
          showToast("操作失敗，請稍後再試", "error");
        }
        return;
      }

      const res = await updateDesignerBasicInfo(supabase, designer.id, fields);
      if (res.ok) {
        const normalized = normalizeFields(fields);
        setFields(normalized);
        setSavedFields(normalized);
        onSaved({
          name: normalized.name,
          bio: normalized.bio === "" ? null : normalized.bio,
          specialties: normalized.specialties,
          instagram_handle: normalized.instagram === "" ? null : normalized.instagram,
        });
        showToast("已儲存", "success");
      } else {
        showToast("操作失敗，請稍後再試", "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // 頭像：多步驟邏輯在 lib 函式內，這裡只負責把結果轉成 ImageUploadField 要的格式與提示。
  async function handleAvatarUpload(file: File) {
    if (designer === null) return { ok: false as const, error: { message: "請先儲存設計師資料" } };
    const res = await uploadDesignerAvatar(supabase, designer.id, file);
    if (!res.ok) return res;
    if (res.data.cleanupWarning) showToast("頭像已更新，但舊的頭像檔案未能清除", "warning");
    onAvatarChange(res.data.url);
    return { ok: true as const, data: res.data.url };
  }

  async function handleAvatarRemove() {
    if (designer === null) return { ok: false as const, error: { message: "請先儲存設計師資料" } };
    const res = await removeDesignerAvatar(supabase, designer.id);
    if (!res.ok) return res;
    if (res.data.cleanupWarning) showToast("頭像已移除，但舊的頭像檔案未能清除", "warning");
    onAvatarChange(null);
    return res;
  }

  const specialtyError = visibleError("specialties");

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Alert severity="info" sx={{ mb: 2.5 }}>
        這些資料會公開顯示在顧客預約頁。
      </Alert>

      <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flexShrink: 0 }}>
          {designer === null ? (
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, display: "block", mb: 0.5 }}>
                頭像
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 160 }}>
                儲存設計師資料後，即可上傳頭像。
              </Typography>
            </Box>
          ) : (
            <>
              <ImageUploadField
                label="頭像"
                shape="circle"
                initialUrl={resolveDesignerAssetUrl(designer.avatar_url)}
                onUpload={handleAvatarUpload}
                onRemove={handleAvatarRemove}
              />
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", maxWidth: 160 }}>
                頭像上傳或移除後立即生效，不需要按「儲存」。
              </Typography>
            </>
          )}
        </Box>

        <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="名稱"
              required
              size="small"
              fullWidth
              value={fields.name}
              disabled={submitting}
              onChange={(event) => setFields((prev) => ({ ...prev, name: event.target.value }))}
              onBlur={() => markTouched("name")}
              error={Boolean(visibleError("name"))}
              helperText={visibleError("name") ?? `${Array.from(fields.name.trim()).length} / ${DESIGNER_NAME_MAX_LENGTH}`}
              inputRef={nameRef}
            />
            <TextField
              label="Instagram 帳號"
              size="small"
              fullWidth
              value={fields.instagram}
              disabled={submitting}
              onChange={(event) => setFields((prev) => ({ ...prev, instagram: event.target.value }))}
              onBlur={() => markTouched("instagram")}
              error={Boolean(visibleError("instagram"))}
              helperText={visibleError("instagram") ?? "選填，不必輸入 @"}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">@</InputAdornment> } }}
            />
          </Stack>

          {/* TagInput：MUI Autocomplete multiple＋freeSolo（Enter 新增、× 刪除）。autoSelect 讓輸入後直接按儲存
              或離開欄位時，打到一半的標籤也會被收進去，不會默默消失。 */}
          <Autocomplete
            multiple
            freeSolo
            autoSelect
            options={[]}
            value={fields.specialties}
            disabled={submitting}
            onChange={(_event, value) =>
              setFields((prev) => ({ ...prev, specialties: value.map((tag) => tag.trim()).filter((tag) => tag.length > 0) }))
            }
            onBlur={() => markTouched("specialties")}
            renderValue={(value, getItemProps) =>
              value.map((tag, index) => {
                const { key, ...itemProps } = getItemProps({ index });
                return <Chip key={key} size="small" label={tag} {...itemProps} />;
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label={`專長標籤（最多 ${DESIGNER_SPECIALTIES_MAX_COUNT} 個）`}
                size="small"
                placeholder={fields.specialties.length === 0 ? "輸入後按 Enter" : undefined}
                error={Boolean(specialtyError)}
                helperText={
                  specialtyError ??
                  `每個標籤 ${DESIGNER_SPECIALTY_MAX_LENGTH} 字以內　${fields.specialties.length} / ${DESIGNER_SPECIALTIES_MAX_COUNT}`
                }
              />
            )}
          />

          <TextField
            label="簡介"
            size="small"
            fullWidth
            multiline
            minRows={3}
            value={fields.bio}
            disabled={submitting}
            onChange={(event) => setFields((prev) => ({ ...prev, bio: event.target.value }))}
            onBlur={() => markTouched("bio")}
            error={Boolean(visibleError("bio"))}
            helperText={visibleError("bio") ?? `${Array.from(fields.bio).length} / ${DESIGNER_BIO_MAX_LENGTH}`}
          />
        </Stack>
      </Stack>

      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2.5 }}>
        <Button variant="contained" onClick={handleSubmit} loading={submitting} disabled={!hasChanges}>
          {isCreate ? "建立設計師" : "儲存"}
        </Button>
      </Box>
    </Paper>
  );
}
