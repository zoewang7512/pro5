"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { validateEmail, validateName, validatePhone } from "@/lib/booking/validation";
import { SectionHeader } from "./SectionChrome";

export type ContactFormValues = {
  name: string;
  phone: string;
  email: string;
};

export type ContactFormSectionProps = {
  submitting: boolean;
  onSubmit: (values: ContactFormValues) => void;
  // TASK-049：booking_policy 依目前設定值組成的政策說明文字（見
  // lib/booking/policy-text.ts），null 代表讀取中或讀取失敗，兩種情況都不顯示卡片
  // （靜默降級，不阻擋或干擾既有預約流程），不需要分開處理。
  policyText: string | null;
};

export function ContactFormSection({ submitting, onSubmit, policyText }: ContactFormSectionProps) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [errors, setErrors] = React.useState<{ name?: string; phone?: string; email?: string }>({});

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const nameResult = validateName(name);
    const phoneResult = validatePhone(phone);
    const emailResult = validateEmail(email);

    setErrors({
      name: nameResult.valid ? undefined : nameResult.message,
      phone: phoneResult.valid ? undefined : phoneResult.message,
      email: emailResult.valid ? undefined : emailResult.message,
    });

    if (!nameResult.valid || !phoneResult.valid || !emailResult.valid) {
      return;
    }

    onSubmit({ name: nameResult.value, phone: phoneResult.value, email: emailResult.value });
  }

  return (
    <Box component="section" sx={{ mb: 3 }}>
      <SectionHeader step={3} label="填寫資訊" />
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={2}>
          <TextField
            label="姓名"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={Boolean(errors.name)}
            helperText={errors.name}
            disabled={submitting}
            slotProps={{ htmlInput: { maxLength: 50 } }}
          />
          <TextField
            label="電話"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={Boolean(errors.phone)}
            helperText={errors.phone}
            disabled={submitting}
            slotProps={{ htmlInput: { inputMode: "tel" } }}
          />
          <TextField
            label="Email（選填）"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={Boolean(errors.email)}
            helperText={errors.email}
            disabled={submitting}
            slotProps={{ htmlInput: { inputMode: "email" } }}
          />
          {policyText && <Alert severity="info">{policyText}</Alert>}
          <Button type="submit" variant="contained" loading={submitting} loadingPosition="start">
            送出預約
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
