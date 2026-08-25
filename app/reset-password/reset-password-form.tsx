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

// TASK-058：重設密碼連結改用伺服器端 app/auth/confirm/route.ts 呼叫 verifyOtp 建立
// session（透過 cookie 傳遞，解決 TASK-040 發現的 PKCE 跨裝置開信失效問題），不再依賴
// 瀏覽器端 SDK 解析 URL 觸發的 PASSWORD_RECOVERY 事件——伺服器端建立、透過 cookie 傳遞
// 的 session，瀏覽器端 SDK 初始化時不保證會重新觸發這個事件。
//
// **改用可驗證的 JWT claim，不用瞬時客戶端事件**（比照 lib/auth/aal.ts 判斷 MFA aal
// 等級的既有方法論）：呼叫 getAuthenticatorAssuranceLevel()，其 currentAuthenticationMethods
// 是從目前 session 的 access_token（JWT）本地解碼 amr claim 而來。只信任這個回傳值本身，
// 不能用「有沒有任何既有 session」判斷連結是否有效——這個安全性要求與 TASK-040 建立時
// 完全相同：已登入的管理者（或偷到 session cookie 的人）造訪這個頁面都會有 session，若把
// 「有 session」當成「連結有效」，等於讓已登入者不需要提供舊密碼就能直接改密碼，形同
// 認證繞過。
//
// **必須先呼叫 getUser() 才能信任本地解碼的 amr claim**（security-reviewer 於本卡總覽
// 審查發現的 MUST FIX）：`getAuthenticatorAssuranceLevel()` 本身只是本地 base64 解碼
// session 的 access_token，**不驗簽**——單獨呼叫等於信任一個未經伺服器驗證的值，而
// `@supabase/ssr` 的 auth cookie 預設不是 httpOnly，任何能在這個頁面執行 JS 的攻擊者
// （例如 XSS）理論上能覆寫本地 session 為偽造的 JWT，讓解碼出來的 amr 顯示假的
// `method:"otp"` 騙過下面的檢查。比照 lib/auth/aal.ts 的既有安全前提「呼叫端必須先以
// 同一個 client 成功呼叫 getUser()（真的會打 Supabase Auth API 驗證 token）」：先確認
// 目前的 access_token 是伺服器簽發的合法 token，之後才信任從**同一個** token 本地解碼出
// 的 amr claim。這裡先前的版本漏了 getUser() 這一步，只抄了 aal.ts 方法論的一半。
//
// **`method === "otp"` 而不是 `"recovery"`**（2026-08-25 用真實 Supabase 專案實測確認，
// 見 TASK-058 任務卡「假設」段落）：Supabase 依「驗證機制」分類 amr method，不是依呼叫
// verifyOtp 時傳入的 `type` 參數分類——`verifyOtp({type:'recovery'})` 建立的 session，
// amr 記錄的 method 是 `"otp"`；一般 `signInWithPassword` 登入是 `"password"`，兩者可
// 區分。**已知耦合**：本專案目前身分驗證只有 email/password 一種方式，且
// `app/auth/confirm/route.ts` 已收斂只接受 `type=recovery` 才呼叫 `verifyOtp`（見該檔案
// 註解），`method === "otp"` 目前等同「來自忘記密碼連結」；若未來新增其他 OTP-based
// 登入方式（magic link／email OTP 登入），這個判斷式會失去唯一性，需要重新檢視（見任務卡
// 「已知耦合」說明）。
//
// 新鮮度視窗（20 分鐘）：amr 的 timestamp 是伺服器簽發時間，比對的 nowSeconds 是使用者
// 瀏覽器的本地時間——手機/電腦時鐘偏差在正常情況下通常在數分鐘內，但不保證，本卡的目的
// 正是要支援跨裝置開信（例如電腦申請、手機開信），視窗抓太緊反而會誤傷合法情境；20 分鐘
// 仍遠小於 access token 的存活時間（實測約 1 小時），足夠的防禦縱深。
const RECOVERY_METHOD = "otp";
const RECOVERY_FRESHNESS_SECONDS = 20 * 60;

type LinkState = "checking" | "valid" | "invalid";

export function ResetPasswordForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [linkState, setLinkState] = useState<LinkState>("checking");

  useEffect(() => {
    let cancelled = false;

    async function checkRecoverySession() {
      // 見上方檔頭說明：getUser() 失敗（例如根本沒有 session、或 access_token 無法通過
      // 伺服器驗證）一律 fail closed，不繼續往下解碼 amr。
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (userError || !userData.user) {
        setLinkState("invalid");
        return;
      }

      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;

      if (error || !data) {
        setLinkState("invalid");
        return;
      }

      const nowSeconds = Date.now() / 1000;
      // currentAuthenticationMethods 型別是 (AMREntry | string)[]（SDK 同時支援含時間戳
      // 的詳細物件格式與 RFC-8176 純字串格式，實測本專案目前的 Supabase 專案回傳的是前者，
      // 但型別層級兩者皆合法，需要都處理）；字串格式沒有時間戳可用，只能比對方法名稱本身。
      const hasFreshRecoveryMethod = data.currentAuthenticationMethods.some((method) => {
        if (typeof method === "string") {
          return method === RECOVERY_METHOD;
        }
        return method.method === RECOVERY_METHOD && nowSeconds - method.timestamp < RECOVERY_FRESHNESS_SECONDS;
      });

      setLinkState(hasFreshRecoveryMethod ? "valid" : "invalid");
    }

    checkRecoverySession();

    return () => {
      cancelled = true;
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
