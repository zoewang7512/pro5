"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import { createClient } from "@/lib/supabase/client";
import { PasswordStrengthMeter } from "@/components/ui/PasswordStrengthMeter";
import { MIN_PASSWORD_LENGTH, passwordsMatch } from "@/lib/auth/password-strength";

// 重設密碼信裡的連結帶著一次性 recovery token，Supabase client 在掛載時（detectSessionInUrl）
// 非同步解析 URL 並觸發 PASSWORD_RECOVERY 事件才會建立臨時 session；這個過程無法同步得知
// 結果，所以用「等待事件、逾時仍未觸發就判定連結無效」的方式處理，而不是直接檢查 URL 有沒有
// token 參數（token 格式與位置隨 Supabase SDK 版本可能調整，交給 SDK 自己判斷比較穩定）。
const RECOVERY_EVENT_TIMEOUT_MS = 4000;

type LinkState = "checking" | "valid" | "invalid";

export function ResetPasswordForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [linkState, setLinkState] = useState<LinkState>("checking");

  useEffect(() => {
    let settled = false;

    // 只信任 PASSWORD_RECOVERY 事件本身，不能用「有沒有任何既有 session」來判斷連結是否
    // 有效：getSession() 只代表「使用者目前是否有登入中的 session」，任何已登入的管理者
    // （或偷到 session cookie 的人）造訪這個頁面都會回傳一個 session，若把「有 session」
    // 當成「連結有效」，等於讓已登入者不需要提供舊密碼就能直接改密碼，形同認證繞過。
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setLinkState("valid");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setLinkState("invalid");
      }
    }, RECOVERY_EVENT_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase]);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  const confirmError = confirmTouched && !passwordsMatch(newPassword, confirmPassword) ? "兩次輸入的密碼不一致" : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmTouched(true);
    setSubmitError(null);

    if (!passwordsMatch(newPassword, confirmPassword)) {
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setSubmitError(`密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。`);
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);

    if (error) {
      setSubmitError("設定失敗，請重新申請忘記密碼。");
      return;
    }

    setSubmitSuccess(true);
    // 設定成功後 recovery session 會變成一般已登入 session；先登出再導回登入頁，
    // 讓使用者實際用新密碼登入一次，確認新密碼真的生效。signOut() 用 try/catch 包住：
    // 就算登出呼叫本身失敗（例如網路例外），也要繼續導回登入頁，避免使用者卡在成功畫面、
    // 本機留著剛剛已提升過的 session。
    try {
      await supabase.auth.signOut();
    } catch {
      // 忽略：下面仍會導回登入頁。
    }
    redirectTimeoutRef.current = setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 1500);
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 4,
        bgcolor: "grey.100",
      }}
    >
      <Card elevation={1} sx={{ width: "100%", maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: "center", mb: 3 }}>
            <Typography variant="h6" component="h1" sx={{ fontWeight: 700 }}>
              設定新密碼
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
              王牌理髮廳後台管理系統
            </Typography>
          </Box>

          {linkState === "checking" && (
            <Stack spacing={1.5}>
              <Skeleton variant="rounded" height={40} />
              <Skeleton variant="rounded" height={40} />
              <Skeleton variant="rounded" height={40} />
            </Stack>
          )}

          {linkState === "invalid" && (
            <Stack spacing={2}>
              <Alert severity="error">連結已逾時或已使用，請重新申請忘記密碼。</Alert>
              <Link href="/login?mode=forgot-password" variant="caption" sx={{ fontWeight: 600, textAlign: "center" }}>
                重新申請
              </Link>
            </Stack>
          )}

          {linkState === "valid" && submitSuccess && (
            <Alert severity="success">密碼已設定成功，即將導向登入頁。</Alert>
          )}

          {linkState === "valid" && !submitSuccess && (
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                {submitError && <Alert severity="error">{submitError}</Alert>}
                <TextField
                  label="新密碼"
                  type="password"
                  name="newPassword"
                  required
                  fullWidth
                  size="small"
                  autoComplete="new-password"
                  value={newPassword}
                  disabled={submitting}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <PasswordStrengthMeter password={newPassword} />
                <TextField
                  label="確認新密碼"
                  type="password"
                  name="confirmPassword"
                  required
                  fullWidth
                  size="small"
                  autoComplete="new-password"
                  value={confirmPassword}
                  disabled={submitting}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onBlur={() => setConfirmTouched(true)}
                  error={Boolean(confirmError)}
                  helperText={confirmError ?? " "}
                  slotProps={{ formHelperText: { role: "alert", "aria-live": "polite" } }}
                />
                <Button type="submit" variant="contained" fullWidth loading={submitting}>
                  設定新密碼
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
