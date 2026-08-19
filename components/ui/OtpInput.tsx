"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";

// 6 格 OTP 驗證碼輸入元件（TASK-043 新做），供帳號設定頁 MFA 註冊確認與 TASK-044 登入 MFA
// 挑戰步驟共用。依既有 Input（MUI TextField）邊框樣式，不另建客製邊框（樣式已由
// lib/theme/index.ts 的 MuiTextField/MuiOutlinedInput override 統一控制，見
// design-system.md S4 Input 列）。

export const OTP_LENGTH = 6;

// 貼上完整驗證碼時分配到各格的純函式：只保留數字字元，截斷到 OTP 長度——抽成純函式方便
// 單元測試，不需要透過模擬 DOM 剪貼簿事件（design-craft／test-verification 既有慣例）。
export function distributeOtpPaste(pasted: string, length: number = OTP_LENGTH): string[] {
  return pasted.replace(/\D/g, "").slice(0, length).split("");
}

export type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function OtpInput({ value, onChange, error, disabled, autoFocus }: OtpInputProps) {
  const inputRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = React.useMemo(
    () => Array.from({ length: OTP_LENGTH }, (_, index) => value[index] ?? ""),
    [value],
  );

  function commit(nextDigits: string[]) {
    onChange(nextDigits.join("").slice(0, OTP_LENGTH));
  }

  function handleChange(index: number, rawValue: string) {
    const digit = rawValue.replace(/\D/g, "").slice(-1);
    if (digit) {
      const next = digits.slice();
      next[index] = digit;
      commit(next);
      if (index < OTP_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }
      return;
    }
    // 清空一格：從這一格開始截斷（而不是把後面的格子塌陷補位）。value 是純字串，若允許
    // 中間留空、後面仍有值，join 後會產生錯位（例如 6 碼填滿後清空第 3 格，後面 3 碼會
    // 整體往前移一位，顯示與實際輸入錯開）——architect TASK-043 審查發現。清空後面的碼
    // 需要重新輸入，是多數 OTP 輸入元件的既有慣例（清空中間格代表這之後的驗證碼不再有效）。
    commit(digits.slice(0, index));
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(index: number, event: React.ClipboardEvent<HTMLDivElement>) {
    const parsed = distributeOtpPaste(event.clipboardData.getData("text"));
    if (parsed.length === 0) return;
    event.preventDefault();

    const next = digits.slice();
    parsed.forEach((digit, offset) => {
      if (index + offset < OTP_LENGTH) next[index + offset] = digit;
    });
    commit(next);

    const focusIndex = Math.min(index + parsed.length, OTP_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  }

  return (
    <Box sx={{ display: "flex", gap: 1 }}>
      {digits.map((digit, index) => (
        <TextField
          key={index}
          inputRef={(el: HTMLInputElement | null) => {
            inputRefs.current[index] = el;
          }}
          value={digit}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          error={error}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          size="small"
          slotProps={{
            htmlInput: {
              inputMode: "numeric",
              autoComplete: "one-time-code",
              maxLength: 1,
              "aria-label": `驗證碼第 ${index + 1} 碼`,
              style: { textAlign: "center", width: "1.5em" },
            },
          }}
        />
      ))}
    </Box>
  );
}
