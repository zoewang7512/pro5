"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  calculatePasswordStrength,
  PASSWORD_STRENGTH_LABEL,
  type PasswordStrength,
} from "@/lib/auth/password-strength";

const STRENGTH_COLOR: Record<PasswordStrength, string> = {
  weak: "error.main",
  medium: "warning.main",
  strong: "success.main",
};

const STRENGTH_FILLED_BARS: Record<PasswordStrength, number> = {
  weak: 1,
  medium: 2,
  strong: 3,
};

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;

  const strength = calculatePasswordStrength(password);
  const filledBars = STRENGTH_FILLED_BARS[strength];
  const color = STRENGTH_COLOR[strength];

  return (
    <Box sx={{ mt: 0.5 }}>
      <Stack direction="row" spacing={0.5}>
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              bgcolor: index < filledBars ? color : "grey.300",
            }}
          />
        ))}
      </Stack>
      <Typography variant="caption" sx={{ color, display: "block", mt: 0.5 }}>
        密碼強度：{PASSWORD_STRENGTH_LABEL[strength]}
      </Typography>
    </Box>
  );
}
