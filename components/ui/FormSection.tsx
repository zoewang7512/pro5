import * as React from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={1} sx={{ mb: 4 }}>
      <Typography variant="h6" component="h3">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      )}
      <Stack spacing={2} sx={{ pt: 1 }}>
        {children}
      </Stack>
    </Stack>
  );
}
