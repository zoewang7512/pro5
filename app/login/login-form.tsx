"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import { createClient } from "@/lib/supabase/client";
import { OtpInput, OTP_LENGTH } from "@/components/ui/OtpInput";

type Mode = "login" | "forgot-password" | "mfa";

// MFA 挑戰步驟（TASK-044）：帳密驗證成功只代表 aal1，需另外呼叫
// getAuthenticatorAssuranceLevel() 判斷帳號是否啟用 MFA（nextLevel 是否為 "aal2"）；
// 啟用時才要求驗證碼、通過後 Supabase 才會把 session 升級到 aal2。錯誤文案與清空輸入的
// 處理比照 AccountSettingsView.tsx 既有的 MFA 驗證碼確認流程（TASK-043）。
//
// challenge() 失敗（拿不到 challengeId）跟 verify() 因驗證碼錯誤而失敗是不同狀況——前者
// 使用者輸入的碼根本還沒被伺服器判斷過，套用「驗證碼錯誤」文案會誤導使用者以為是自己
// 輸入錯（architect 審查發現），因此拆成兩支各自的錯誤文案函式。
function mfaChallengeErrorMessage(code: string | undefined): string {
  if (code === "over_request_rate_limit") return "驗證嘗試次數過多，請稍後再試。";
  return "發生未預期的錯誤，請稍後再試。";
}

function mfaVerifyErrorMessage(code: string | undefined): string {
  if (code === "mfa_verification_failed") return "驗證碼錯誤，請重新輸入。";
  if (code === "over_request_rate_limit") return "驗證嘗試次數過多，請稍後再試。";
  return "發生未預期的錯誤，請稍後再試。";
}

// 體驗帳號說明視窗與橫幅的前端旗標（架構筆記 D6）：一鍵進入成功後設前者、移除後者，後台的
// DemoNotice 掛載時讀取。sessionStorage 在隱私模式等情況可能不可用或拋例外，不能讓入口壞掉——
// 讀寫失敗時後台每次都會顯示說明，只是少了「本次工作階段只彈一次」的便利。
function setDemoNoticeFlags() {
  try {
    sessionStorage.setItem("demo-welcome-pending", "1");
    sessionStorage.removeItem("demo-banner-dismissed");
  } catch {
    // 忽略
  }
}

// demoEnabled 由伺服器元件（page.tsx）依環境設定決定；為假時完全不渲染入口。
export function LoginForm({ demoEnabled = false }: { demoEnabled?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(searchParams.get("mode") === "forgot-password" ? "forgot-password" : "login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [demoEntering, setDemoEntering] = useState(false);
  const [demoError, setDemoError] = useState(false);

  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError("帳號或密碼錯誤，請再試一次。");
        return;
      }

      // signInWithPassword 成功只建立 aal1 session，不代表帳號沒有啟用 MFA——需要另外呼叫
      // getAuthenticatorAssuranceLevel() 判斷是否要進入 MFA 挑戰步驟，不能只憑登入是否報錯
      // 判斷（見任務卡「假設」段落）。
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      // currentLevel／nextLevel 理論上簽入成功後一定會是 "aal1" 或 "aal2"，但
      // getAuthenticatorAssuranceLevel() 只讀本地 session、不一定即時反映剛建立的
      // session，異常時可能兩者皆為 null 且不報錯——這種狀態不能當成「未啟用 MFA」而
      // 放行，必須 fail closed：登出剛建立的 aal1 session 並顯示錯誤，不能讓後面的判斷
      // 式意外通過（security-reviewer 審查發現）。
      if (aalError || !aal || !aal.currentLevel || !aal.nextLevel) {
        await supabase.auth.signOut({ scope: "local" });
        setError("發生未預期的錯誤，請稍後再試。");
        return;
      }

      if (aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel) {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        const verifiedTotp = factors?.all.find((factor) => factor.factor_type === "totp" && factor.status === "verified");
        if (factorsError || !verifiedTotp) {
          // 判斷「需要 MFA」卻找不到已驗證的 factor 是不該發生的異常狀態：不能放行（等於
          // 繞過 MFA），也不能把使用者晾在一個懸空的 aal1 session——重新整理頁面時
          // /login 的 is_admin() 檢查只看是否為管理員、不看 aal，會直接把這個未完成
          // MFA 挑戰的 session 導向 /admin（security-reviewer 審查發現），因此顯示錯誤
          // 前先登出。
          await supabase.auth.signOut({ scope: "local" });
          setError("發生未預期的錯誤，請稍後再試。");
          return;
        }
        setMfaFactorId(verifiedTotp.id);
        setMode("mfa");
        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch {
      // 任何未預期的例外（例如網路中斷）都要讓表單恢復可操作，不能讓 submitting 卡在
      // true、按鈕永久停用且使用者看不到任何錯誤訊息（architect 審查發現）。
      setError("發生未預期的錯誤，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  // 一鍵進入體驗帳號：不送任何帳密，也不讀表單欄位——被登入的帳號只由伺服器環境變數決定
  // （TASK-103）。成功時伺服器已經把 session cookie 寫進回應。失敗（含限流、網路錯誤）一律顯示
  // 同一句通用文案，不區分原因。成功後刻意不把 demoEntering 設回 false：頁面即將離開，保持停用
  // 才能防止導覽期間重複點擊。
  async function handleDemoEnter() {
    if (demoEntering) return;
    setDemoError(false);
    setDemoEntering(true);
    try {
      const response = await fetch("/api/demo/enter", { method: "POST", cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      const ok = response.ok && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
      if (!ok) {
        setDemoError(true);
        setDemoEntering(false);
        return;
      }
      setDemoNoticeFlags();
      router.replace("/admin");
      router.refresh();
    } catch {
      setDemoError(true);
      setDemoEntering(false);
    }
  }

  async function handleMfaSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaFactorId) return;
    if (mfaCode.length < OTP_LENGTH) {
      setMfaError("請輸入 6 位數驗證碼。");
      return;
    }

    setMfaError(null);
    setMfaSubmitting(true);

    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (challengeError || !challenge) {
        setMfaCode("");
        setMfaError(mfaChallengeErrorMessage(challengeError?.code));
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaCode,
      });

      if (verifyError) {
        // 驗證失敗後清空已輸入的驗證碼，避免使用者誤以為可以直接重送同一組已被拒絕的碼
        // （比照 AccountSettingsView.tsx 既有的 MFA 驗證碼確認流程）。
        setMfaCode("");
        setMfaError(mfaVerifyErrorMessage(verifyError.code));
        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch {
      setMfaCode("");
      setMfaError("發生未預期的錯誤，請稍後再試。");
    } finally {
      setMfaSubmitting(false);
    }
  }

  // 「改用其他方式登入」：放棄目前的 MFA 挑戰，登出剛建立的 aal1 session 並回到帳密登入
  // 畫面重新開始（本專案目前只支援 TOTP 單一驗證方式，這裡是唯一的「取消」出口，登出可
  // 避免殘留一個懸空的 aal1 session）。scope 用 "local"（只清目前這個瀏覽器的
  // session），不能用預設的 "global"——那會把這個帳號在其他裝置上原本正常的 session
  // 也一併登出，讓「放棄這次的 MFA 挑戰」變成能撤銷其他裝置 session 的手段（security-
  // reviewer 審查發現）。登出失敗時不能假裝已取消：session 可能仍然存活，貿然切回登入
  // 畫面會讓使用者誤以為已安全離開。
  async function handleCancelMfa() {
    setMfaSubmitting(true);
    try {
      const supabase = createClient();
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) {
        setMfaError("發生未預期的錯誤，請稍後再試。");
        return;
      }
      setMode("login");
      setMfaFactorId(null);
      setMfaCode("");
      setMfaError(null);
      setError(null);
      setPassword("");
    } catch {
      setMfaError("發生未預期的錯誤，請稍後再試。");
    } finally {
      setMfaSubmitting(false);
    }
  }

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotResult, setForgotResult] = useState<"success" | "error" | null>(null);

  async function handleForgotSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setForgotSubmitting(true);
    setForgotResult(null);

    const supabase = createClient();
    // NEXT_PUBLIC_SITE_URL 理論上一定會設定，但若因設定疏漏而缺漏，退回
    // window.location.origin 而不是讓 redirectTo 變成字面字串
    // "undefined/reset-password"（那會被 Supabase 專案的允許清單拒絕，靜默退回專案
    // 預設 Site URL，使用者會被導到不一定是這個環境的網址）。
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${siteUrl}/reset-password`,
    });

    setForgotSubmitting(false);
    // resetPasswordForEmail 對不存在的 email 在 Supabase 預設設定下不會回傳可區分的錯誤
    // （避免帳號列舉），所以這裡收到的 error 一定是網路／服務層級問題，一律顯示通用失敗
    // 文案；沒有 error 則顯示固定的成功文案，不透露該 email 是否真的對應既有帳號。
    setForgotResult(resetError ? "error" : "success");
  }

  function backToLogin() {
    setMode("login");
    setForgotResult(null);
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
          {mode === "forgot-password" && (
            <Link
              component="button"
              type="button"
              variant="caption"
              onClick={backToLogin}
              sx={{ fontWeight: 500, mb: 2, display: "inline-block" }}
            >
              ← 返回登入
            </Link>
          )}

          <Box sx={{ textAlign: mode === "forgot-password" ? "left" : "center", mb: 3 }}>
            <Typography variant="h6" component="h1" sx={{ fontWeight: 700 }}>
              {mode === "forgot-password" ? "重設密碼" : mode === "mfa" ? "輸入驗證碼" : "設計師登入"}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
              {mode === "forgot-password"
                ? "輸入登入信箱，我們會寄送重設密碼連結"
                : mode === "mfa"
                  ? "開啟 Authenticator App，輸入 6 位數驗證碼"
                  : "王牌理髮廳後台管理系統"}
            </Typography>
          </Box>

          {mode === "login" && (
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <TextField
                  label="Email"
                  type="email"
                  name="email"
                  required
                  fullWidth
                  size="small"
                  autoComplete="username"
                  value={email}
                  disabled={submitting || demoEntering}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <TextField
                  label="密碼"
                  type="password"
                  name="password"
                  required
                  fullWidth
                  size="small"
                  autoComplete="current-password"
                  value={password}
                  disabled={submitting || demoEntering}
                  onChange={(event) => setPassword(event.target.value)}
                  error={Boolean(error)}
                  helperText={error ?? " "}
                  slotProps={{ formHelperText: { role: "alert", "aria-live": "polite" } }}
                />
                <Button type="submit" variant="contained" fullWidth loading={submitting} disabled={demoEntering}>
                  登入
                </Button>
              </Stack>
            </Box>
          )}

          {mode === "forgot-password" && (
            <Box component="form" onSubmit={handleForgotSubmit}>
              <Stack spacing={2}>
                {forgotResult === "success" && (
                  <Alert severity="success">若此 email 對應既有帳號，重設密碼信已寄出，請至信箱查收。</Alert>
                )}
                {forgotResult === "error" && <Alert severity="error">發生未預期的錯誤，請稍後再試。</Alert>}
                {/* TASK-119：輸入體驗帳號信箱時資料庫觸發器（TASK-100）會擋下重設，前端只會收到
                    通用錯誤，且無法也不該比對 Demo Email（不得出現在前端）。所以不辨識原因：Demo 入口
                    開啟時，任何失敗都多給一行引導，畫面不隨輸入的信箱而不同。 */}
                {forgotResult === "error" && demoEnabled && (
                  <Box>
                    <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.5, mb: 1 }}>
                      若您是要體驗，請回登入頁使用「進入體驗帳號」。
                    </Typography>
                    <Button type="button" variant="outlined" size="small" onClick={backToLogin}>
                      回登入頁
                    </Button>
                  </Box>
                )}
                <TextField
                  label="Email"
                  type="email"
                  name="email"
                  required
                  fullWidth
                  size="small"
                  autoComplete="username"
                  value={forgotEmail}
                  disabled={forgotSubmitting}
                  onChange={(event) => setForgotEmail(event.target.value)}
                />
                <Button type="submit" variant="contained" fullWidth loading={forgotSubmitting}>
                  寄送重設信
                </Button>
              </Stack>
            </Box>
          )}

          {mode === "mfa" && (
            <Box component="form" onSubmit={handleMfaSubmit}>
              <Stack spacing={2}>
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <OtpInput
                    value={mfaCode}
                    onChange={(value) => {
                      setMfaCode(value);
                      setMfaError(null);
                    }}
                    error={Boolean(mfaError)}
                    disabled={mfaSubmitting}
                    autoFocus
                  />
                </Box>
                <Typography
                  variant="caption"
                  role="alert"
                  aria-live="polite"
                  sx={{ color: "error.main", textAlign: "center", minHeight: "1.25em" }}
                >
                  {mfaError ?? " "}
                </Typography>
                <Button type="submit" variant="contained" fullWidth loading={mfaSubmitting}>
                  驗證並登入
                </Button>
              </Stack>
            </Box>
          )}

          {mode === "login" && (
            <Box sx={{ textAlign: "center", mt: 2 }}>
              <Link
                component="button"
                type="button"
                variant="caption"
                disabled={demoEntering}
                onClick={() => setMode("forgot-password")}
                sx={{ fontWeight: 600 }}
              >
                忘記密碼？
              </Link>
            </Box>
          )}

          {mode === "login" && demoEnabled && (
            <>
              <Divider sx={{ mt: 3, mb: 2, fontSize: 11, color: "grey.500" }}>或</Divider>
              <Box sx={{ bgcolor: "grey.100", borderRadius: 1, p: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>面試官／訪客？</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.5, mb: 1.5 }}>
                  一鍵進入體驗帳號，不需要輸入密碼，後台功能全開。
                </Typography>
                <Button
                  type="button"
                  variant="outlined"
                  fullWidth
                  loading={demoEntering}
                  loadingPosition="start"
                  onClick={handleDemoEnter}
                  sx={{ minHeight: 40 }}
                >
                  {demoEntering ? "正在進入體驗帳號…" : demoError ? "重新嘗試進入體驗帳號" : "進入體驗帳號"}
                </Button>
                {demoError && (
                  <Alert severity="error" sx={{ mt: 1.5, fontSize: 12 }}>
                    目前無法進入體驗帳號，請稍後再試。
                  </Alert>
                )}
              </Box>
            </>
          )}

          {mode === "mfa" && (
            <Box sx={{ textAlign: "center", mt: 2 }}>
              <Link
                component="button"
                type="button"
                variant="caption"
                disabled={mfaSubmitting}
                onClick={handleCancelMfa}
                sx={{ fontWeight: 600 }}
              >
                改用其他方式登入
              </Link>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
