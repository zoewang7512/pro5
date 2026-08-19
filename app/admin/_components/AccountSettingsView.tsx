"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Alert from "@mui/material/Alert";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/ToastProvider";
import { useAdminProfile } from "./AdminProfileContext";
import {
  cancelMfaEnrollment,
  enrollMfa,
  listMfaFactors,
  removeAdminAvatar,
  resolveAdminDisplayName,
  unenrollMfaWithPasswordAndCode,
  updateAdminEmail,
  updateAdminPassword,
  updateAdminProfile,
  uploadAdminAvatar,
  validateAdminDisplayName,
  validateAdminEmail,
  verifyMfaEnrollment,
} from "@/lib/admin/account";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordsMatch } from "@/lib/auth/password-strength";
import { PasswordStrengthMeter } from "@/components/ui/PasswordStrengthMeter";
import { OtpInput, OTP_LENGTH } from "@/components/ui/OtpInput";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// 架構基礎（TASK-038）：帳號設定頁骨架，比照已核准 mockup 變體 A 的卡片版型（個人資料／
// 密碼／登入 Email／雙重驗證）。TASK-041 接上「個人資料」卡片；TASK-042 接上「密碼」與
// 「登入 Email」兩張卡片；TASK-043 接上「雙重驗證（MFA）」卡片：未啟用時可啟動 TOTP
// 註冊（QR Code＋OtpInput 驗證碼確認），已啟用時可停用。停用需要同時輸入「目前密碼」與
// 「目前驗證碼」（缺一不可）——任務卡原先假設密碼驗證即可，但實作期對真實 Supabase 走查
// 發現移除已驗證 factor 需要 session 處於 aal2，純密碼重新驗證無法滿足，必須改用驗證碼
// 升級 aal2；額外保留密碼驗證則是 security-reviewer 審查建議的縱深防禦（只驗證碼等於只
// 驗證「持有物」，加回密碼補上「知識」這一層），見 lib/admin/account.ts
// unenrollMfaWithPasswordAndCode 的完整說明與偏離記錄。
//
// 讀取資料來自 AdminProfileContext（app/admin/layout.tsx 伺服器端讀取一次，見該檔案與
// AdminProfileContext.tsx 說明），不在本元件內另外呼叫 get_admin_profile()，避免
// /admin/account 重複發出同一支 RPC（architect TASK-038 審查發現）。顯示名稱欄位刻意顯示
// 「原始值」（未設定時為空字串＋placeholder），不是 Sidebar 用的「設計師」預設文案——
// 避免使用者未改欄位就按儲存，把純顯示用的回退文字寫成真實 display_name（architect
// TASK-038 審查發現）。儲存成功後呼叫 context 的 refresh()，讓 Sidebar 立即反映新值，
// 不需要整頁重新整理（同樣是 TASK-038 architect 審查要求補上的更新通道）。

export function AccountSettingsView() {
  const { displayName, avatarUrl, email, pendingEmail, refresh } = useAdminProfile();
  const { showToast } = useToast();
  const supabase = React.useMemo(() => createClient(), []);

  const avatarLabel = resolveAdminDisplayName(displayName);
  const avatarInitial = [...avatarLabel][0];

  const [nameInput, setNameInput] = React.useState(displayName ?? "");
  const [nameTouched, setNameTouched] = React.useState(false);
  const [nameSubmitAttempted, setNameSubmitAttempted] = React.useState(false);
  const [savingName, setSavingName] = React.useState(false);
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);

  const nameValidationError = validateAdminDisplayName(nameInput);
  const showNameError = nameTouched || nameSubmitAttempted ? nameValidationError : null;
  const hasNameChanges = nameInput !== (displayName ?? "");

  const [avatarBusy, setAvatarBusy] = React.useState(false);
  const [avatarError, setAvatarError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  async function handleSaveName() {
    setNameSubmitAttempted(true);
    if (nameValidationError) {
      nameInputRef.current?.focus();
      return;
    }

    setSavingName(true);
    try {
      const result = await updateAdminProfile(supabase, nameInput.trim(), avatarUrl);
      if (result.ok) {
        await refresh();
        showToast("已儲存", "success");
      } else {
        showToast("操作失敗，請稍後再試", "error");
      }
    } finally {
      setSavingName(false);
    }
  }

  function openAvatarFilePicker() {
    if (avatarBusy) return;
    fileInputRef.current?.click();
  }

  async function handleAvatarFile(file: File) {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const result = await uploadAdminAvatar(supabase, displayName, file);
      if (result.ok) {
        await refresh();
      } else {
        setAvatarError(result.error.message);
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const result = await removeAdminAvatar(supabase, displayName);
      if (result.ok) {
        await refresh();
      } else {
        setAvatarError("操作失敗，請稍後再試");
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [confirmPasswordTouched, setConfirmPasswordTouched] = React.useState(false);
  const [passwordSubmitAttempted, setPasswordSubmitAttempted] = React.useState(false);
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [currentPasswordError, setCurrentPasswordError] = React.useState<string | null>(null);
  const [passwordFormError, setPasswordFormError] = React.useState<string | null>(null);
  const currentPasswordRef = React.useRef<HTMLInputElement | null>(null);

  // newPassword.length > 0 這個條件避免「兩個欄位都還沒填」時就搶先顯示「兩次輸入的密碼
  // 不一致」——那種情況下真正該顯示的是送出時另外擋下的「新密碼為必填」（見
  // handleUpdatePassword），不然文案語意會不對（test-engineer／security-reviewer
  // TASK-042 審查發現）。
  const showConfirmPasswordError =
    (confirmPasswordTouched || passwordSubmitAttempted) &&
    newPassword.length > 0 &&
    !passwordsMatch(newPassword, confirmPassword)
      ? "兩次輸入的密碼不一致"
      : null;

  async function handleUpdatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordSubmitAttempted(true);
    setCurrentPasswordError(null);
    setPasswordFormError(null);

    if (!currentPassword) {
      // 不只 focus，也給看得到的錯誤文案——螢幕閱讀器使用者送出後才會被通知到底發生
      // 什麼事（architect TASK-042 審查建議：純 focus 沒有任何視覺／無障礙回饋）。
      setCurrentPasswordError("請輸入目前密碼。");
      currentPasswordRef.current?.focus();
      return;
    }
    if (newPassword.length === 0) {
      setPasswordFormError("新密碼為必填。");
      return;
    }
    if (!passwordsMatch(newPassword, confirmPassword)) {
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordFormError(`新密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。`);
      return;
    }
    // GoTrue（bcrypt）的長度上限是 72 bytes，不是字元數——中文等多位元組字元一個字就可能
    // 佔 3 bytes，用 TextEncoder 量實際位元組數才會跟伺服器端判斷一致（architect
    // TASK-042 審查發現：原本用 .length 量 UTF-16 code unit 數，一段 30 字的中文複雜密碼
    // 前端會放行、伺服器卻拒絕，且該錯誤沒有專屬錯誤碼，會落到通用失敗訊息）。
    if (new TextEncoder().encode(newPassword).length > MAX_PASSWORD_LENGTH) {
      setPasswordFormError(`新密碼長度不能超過 ${MAX_PASSWORD_LENGTH} bytes（中文等多位元組字元會占用較多 bytes）。`);
      return;
    }

    setSavingPassword(true);
    try {
      const result = await updateAdminPassword(supabase, currentPassword, newPassword);
      if (result.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setConfirmPasswordTouched(false);
        setPasswordSubmitAttempted(false);
        // Supabase 在密碼變更成功時會登出除了目前這個 session 以外的其他 session
        // （既定行為，不是本卡引入的副作用），提前告知使用者，避免手機或其他瀏覽器
        // 突然被登出時摸不著頭緒（security-reviewer TASK-042 審查發現）。
        showToast("密碼已更新，其他裝置的登入已登出，請重新登入", "success");
      } else if (result.reason === "wrong_password") {
        setCurrentPasswordError("目前密碼錯誤，請再試一次。");
        currentPasswordRef.current?.focus();
      } else if (result.reason === "weak_password") {
        setPasswordFormError("新密碼強度不足，請換一個更複雜的密碼。");
      } else if (result.reason === "same_password") {
        setPasswordFormError("新密碼不能與目前密碼相同。");
      } else {
        showToast("操作失敗，請稍後再試", "error");
      }
    } finally {
      setSavingPassword(false);
    }
  }

  const [emailCurrentPassword, setEmailCurrentPassword] = React.useState("");
  const [emailCurrentPasswordError, setEmailCurrentPasswordError] = React.useState<string | null>(null);
  const [emailFormError, setEmailFormError] = React.useState<string | null>(null);
  const [emailInput, setEmailInput] = React.useState(email);
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [emailSubmitAttempted, setEmailSubmitAttempted] = React.useState(false);
  const [savingEmail, setSavingEmail] = React.useState(false);
  const emailInputRef = React.useRef<HTMLInputElement | null>(null);
  const emailCurrentPasswordRef = React.useRef<HTMLInputElement | null>(null);

  // email 現在是 context 的 state（見 AdminProfileContext.tsx），refresh() 之後可能變成
  // 別的分頁／裝置完成確認後的新值；只在使用者目前欄位內容還等於「上一次已知的 email」時
  // 才跟著同步，若使用者已經打了別的草稿（正在編輯中）就不覆蓋，避免打字打到一半被打斷
  // （architect TASK-042 審查發現：email 改成可變之後，emailInput 這個只在掛載時取值一次
  // 的 state 需要一併處理，否則會卡在舊值）。
  const previousEmailRef = React.useRef(email);
  React.useEffect(() => {
    if (emailInput === previousEmailRef.current) {
      setEmailInput(email);
    }
    previousEmailRef.current = email;
  }, [email, emailInput]);

  const emailValidationError = validateAdminEmail(emailInput);
  const showEmailError = emailTouched || emailSubmitAttempted ? emailValidationError : null;
  // 忽略大小寫比較：Supabase 會把 email 正規化為小寫，只是大小寫不同不算「真的改了」，
  // 避免送出一次沒有實質效果、卻仍會消耗寄信配額的變更請求（security-reviewer TASK-042
  // 審查發現）。
  const hasEmailChanges = emailInput.trim().toLowerCase() !== email.toLowerCase();

  async function handleUpdateEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailSubmitAttempted(true);
    setEmailCurrentPasswordError(null);
    setEmailFormError(null);

    if (emailValidationError) {
      emailInputRef.current?.focus();
      return;
    }
    // Email 是忘記密碼流程的救援管道，跟密碼變更比照辦理、一樣要求先驗證目前密碼，
    // 避免已登入裝置被他人趁隙把登入 email 換成攻擊者信箱（security-reviewer TASK-042
    // 審查發現：原本密碼變更需要驗證、email 變更卻不用，防護等級與威脅嚴重度相反）。
    if (!emailCurrentPassword) {
      setEmailCurrentPasswordError("請輸入目前密碼。");
      emailCurrentPasswordRef.current?.focus();
      return;
    }

    setSavingEmail(true);
    try {
      const result = await updateAdminEmail(supabase, emailCurrentPassword, emailInput.trim());
      if (result.ok) {
        setEmailCurrentPassword("");
        setEmailInput(email);
        setEmailSubmitAttempted(false);
        setEmailTouched(false);
        // pendingEmail 來自 AdminProfileContext（伺服器實際狀態），refresh() 讓待確認
        // banner 立即反映最新的 user.new_email，重新整理頁面也不會消失。
        await refresh();
      } else if (result.reason === "wrong_password") {
        setEmailCurrentPasswordError("目前密碼錯誤，請再試一次。");
        emailCurrentPasswordRef.current?.focus();
      } else if (result.reason === "email_exists") {
        setEmailFormError("這個 email 已被其他帳號使用。");
      } else if (result.reason === "email_address_invalid") {
        setEmailFormError("這個 email 位址無法使用，請換一個。");
      } else if (result.reason === "rate_limited") {
        setEmailFormError("寄信次數已達上限，請稍後再試。");
      } else {
        showToast("操作失敗，請稍後再試", "error");
      }
    } finally {
      setSavingEmail(false);
    }
  }

  // MFA 卡片：mfaFactorId 有值代表已有一個 verified 的 totp factor（「已啟用」）。
  // mfaEnrollment 是註冊流程進行中的暫存狀態（QR Code／密鑰／使用者輸入的驗證碼），與
  // 「已啟用」狀態互斥——同一時間只會顯示其中一種卡片內容。
  const [mfaLoading, setMfaLoading] = React.useState(true);
  const [mfaLoadError, setMfaLoadError] = React.useState(false);
  const [mfaFactorId, setMfaFactorId] = React.useState<string | null>(null);
  const [mfaEnrollStarting, setMfaEnrollStarting] = React.useState(false);
  const [mfaEnrollment, setMfaEnrollment] = React.useState<{
    factorId: string;
    qrCode: string;
    secret: string;
    code: string;
    error: string | null;
    verifying: boolean;
    canceling: boolean;
  } | null>(null);
  const [mfaUnenrollDialogOpen, setMfaUnenrollDialogOpen] = React.useState(false);
  const [mfaUnenrollPassword, setMfaUnenrollPassword] = React.useState("");
  const [mfaUnenrollCode, setMfaUnenrollCode] = React.useState("");
  const [mfaUnenrollError, setMfaUnenrollError] = React.useState<string | null>(null);
  const [mfaUnenrolling, setMfaUnenrolling] = React.useState(false);

  // 讀取失敗時（網路抖動、Supabase 暫時性錯誤）不能靜默當成「未啟用」——若使用者其實
  // 已啟用 MFA，畫面卻顯示未啟用且「啟用雙重驗證」按鈕可點，會讓使用者誤判目前的帳號
  // 保護狀態、甚至觸發不必要的重複註冊（architect／test-engineer TASK-043 審查發現）。
  // 失敗時改顯示錯誤訊息＋「重試」按鈕，不渲染任何可操作的啟用/停用按鈕。
  //
  // fetchMfaFactors 只負責讀取結果、不設定「開始讀取」狀態（mfaLoading=true）——重試按鈕
  // 的 onClick（見 handleRetryLoadMfa）負責設定；掛載時的初始值本來就是
  // loading=true／error=false，不需要重設。掛載效果刻意不直接呼叫這支具名函式，改用內嵌
  // async IIFE 各自讀取一次：react-hooks/set-state-in-effect 規則會把「effect 呼叫一個
  // 內部會 setState 的具名函式」整條呼叫鏈都視為在 effect 內同步觸發 setState 而擋下，
  // 即使實際的 setState 都在 await 之後才執行；改成 effect 主體內就地宣告並呼叫的
  // IIFE（不透過具名函式參照）才能通過這個規則的靜態分析。
  const fetchMfaFactors = React.useCallback(
    async (signal?: { cancelled: boolean }) => {
      const result = await listMfaFactors(supabase);
      if (signal?.cancelled) return;
      if (result.ok) {
        const verified = result.data.find((factor) => factor.status === "verified");
        setMfaFactorId(verified?.id ?? null);
        setMfaLoadError(false);
      } else {
        setMfaLoadError(true);
      }
      setMfaLoading(false);
    },
    [supabase],
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listMfaFactors(supabase);
      if (cancelled) return;
      if (result.ok) {
        const verified = result.data.find((factor) => factor.status === "verified");
        setMfaFactorId(verified?.id ?? null);
      } else {
        setMfaLoadError(true);
      }
      setMfaLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function handleRetryLoadMfa() {
    setMfaLoading(true);
    setMfaLoadError(false);
    fetchMfaFactors();
  }

  async function handleStartMfaEnrollment() {
    setMfaEnrollStarting(true);
    try {
      const result = await enrollMfa(supabase);
      if (result.ok) {
        setMfaEnrollment({
          factorId: result.data.factorId,
          qrCode: result.data.qrCode,
          secret: result.data.secret,
          code: "",
          error: null,
          verifying: false,
          canceling: false,
        });
      } else {
        // 顯示 result.error.message 而非固定文案：enrollMfa 對「已達裝置數量上限」會回傳
        // 專屬訊息（見 lib/admin/account.ts），一般錯誤仍是同一句通用文案，行為不變。
        showToast(result.error.message, "error");
      }
    } finally {
      setMfaEnrollStarting(false);
    }
  }

  function mfaCodeErrorMessage(reason: "invalid_code" | "rate_limited" | "internal_error"): string {
    if (reason === "invalid_code") return "驗證碼錯誤，請再試一次。";
    if (reason === "rate_limited") return "驗證嘗試次數過多，請稍後再試。";
    return "操作失敗，請稍後再試。";
  }

  async function handleConfirmMfaEnrollment() {
    if (!mfaEnrollment) return;
    setMfaEnrollment((state) => (state ? { ...state, verifying: true, error: null } : state));
    const result = await verifyMfaEnrollment(supabase, mfaEnrollment.factorId, mfaEnrollment.code);
    if (result.ok) {
      setMfaFactorId(mfaEnrollment.factorId);
      setMfaEnrollment(null);
      showToast("雙重驗證已啟用", "success");
    } else {
      setMfaEnrollment((state) =>
        state
          ? {
              ...state,
              // 驗證失敗後清空已輸入的驗證碼，避免使用者誤以為可以直接重送同一組已被拒絕
              // 的碼（security-reviewer TASK-043 審查建議）。
              code: "",
              verifying: false,
              error: mfaCodeErrorMessage(result.reason),
            }
          : state,
      );
    }
  }

  async function handleCancelMfaEnrollment() {
    if (!mfaEnrollment) return;
    setMfaEnrollment((state) => (state ? { ...state, canceling: true } : state));
    const result = await cancelMfaEnrollment(supabase, mfaEnrollment.factorId);
    if (result.ok) {
      setMfaEnrollment(null);
    } else {
      // 失敗時保留註冊畫面讓使用者重試，不能靜默回到「未啟用」——那樣會讓這個
      // unverified factor 殘留在 Supabase 卻沒有任何畫面線索（違背任務卡「取消不會殘留
      // 未驗證 factor」的驗收標準）。
      setMfaEnrollment((state) => (state ? { ...state, canceling: false } : state));
      showToast("取消失敗，請再試一次", "error");
    }
  }

  function openMfaUnenrollDialog() {
    setMfaUnenrollPassword("");
    setMfaUnenrollCode("");
    setMfaUnenrollError(null);
    setMfaUnenrollDialogOpen(true);
  }

  async function handleConfirmMfaUnenroll() {
    if (!mfaFactorId) return;
    if (!mfaUnenrollPassword) {
      setMfaUnenrollError("請輸入目前密碼。");
      return;
    }
    if (mfaUnenrollCode.length < OTP_LENGTH) {
      setMfaUnenrollError("請輸入 6 位數驗證碼。");
      return;
    }
    setMfaUnenrolling(true);
    try {
      const result = await unenrollMfaWithPasswordAndCode(supabase, mfaUnenrollPassword, mfaFactorId, mfaUnenrollCode);
      if (result.ok) {
        setMfaFactorId(null);
        setMfaUnenrollDialogOpen(false);
        showToast("雙重驗證已停用", "success");
      } else if (result.reason === "wrong_password") {
        setMfaUnenrollError("目前密碼錯誤，請再試一次。");
      } else if (result.reason === "invalid_code" || result.reason === "rate_limited") {
        // 驗證碼相關失敗才清空驗證碼欄位；密碼錯誤時保留使用者已輸入的驗證碼，不需要
        // 重打（那一步驗證根本還沒執行到）。
        setMfaUnenrollCode("");
        setMfaUnenrollError(mfaCodeErrorMessage(result.reason));
      } else {
        showToast("操作失敗，請稍後再試", "error");
        // mfaFactorId 可能已過期（例如已在別的裝置停用），重新整理一次真實狀態，避免畫面
        // 卡在錯誤的「已啟用」徽章（security-reviewer TASK-043 審查建議）。背景靜默重新
        // 整理，不切換 mfaLoading（避免整個卡片閃一次 loading 狀態）。
        fetchMfaFactors();
      }
    } finally {
      setMfaUnenrolling(false);
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Typography variant="h6" component="h2">
        帳號設定
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
        管理登入密碼、email、個人資料與雙重驗證
      </Typography>

      <Stack spacing={2} sx={{ maxWidth: 480, alignItems: "flex-start" }}>
        <Paper variant="outlined" sx={{ p: 3, width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            個人資料
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Avatar src={avatarUrl ?? undefined} sx={{ width: 56, height: 56, fontSize: 20 }}>
              {avatarInitial}
            </Avatar>
            <TextField
              label="顯示名稱"
              inputRef={nameInputRef}
              value={nameInput}
              placeholder="尚未設定"
              onChange={(event) => setNameInput(event.target.value)}
              onBlur={() => setNameTouched(true)}
              error={Boolean(showNameError)}
              helperText={showNameError ?? " "}
              disabled={savingName}
              fullWidth
              size="small"
            />
          </Stack>
          {avatarError && (
            <Typography variant="caption" sx={{ color: "error.main", display: "block", mt: 1 }}>
              {avatarError}
            </Typography>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) handleAvatarFile(file);
            }}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button size="small" onClick={openAvatarFilePicker} disabled={avatarBusy}>
              更換頭像
            </Button>
            <Button size="small" color="error" onClick={handleRemoveAvatar} disabled={avatarBusy || !avatarUrl}>
              移除
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleSaveName}
              loading={savingName}
              disabled={!hasNameChanges}
              sx={{ ml: "auto" }}
            >
              儲存
            </Button>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3, width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            密碼
          </Typography>
          {passwordFormError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {passwordFormError}
            </Alert>
          )}
          <Box component="form" onSubmit={handleUpdatePassword}>
            <Stack spacing={2}>
              <TextField
                label="目前密碼"
                type="password"
                inputRef={currentPasswordRef}
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  setCurrentPasswordError(null);
                }}
                error={Boolean(currentPasswordError)}
                helperText={currentPasswordError ?? " "}
                slotProps={{ formHelperText: { role: "alert", "aria-live": "polite" } }}
                disabled={savingPassword}
                autoComplete="current-password"
                fullWidth
                size="small"
              />
              <Box>
                <TextField
                  label="新密碼"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={savingPassword}
                  autoComplete="new-password"
                  fullWidth
                  size="small"
                />
                <PasswordStrengthMeter password={newPassword} />
              </Box>
              <TextField
                label="確認新密碼"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                onBlur={() => setConfirmPasswordTouched(true)}
                error={Boolean(showConfirmPasswordError)}
                helperText={showConfirmPasswordError ?? " "}
                slotProps={{ formHelperText: { role: "alert", "aria-live": "polite" } }}
                disabled={savingPassword}
                autoComplete="new-password"
                fullWidth
                size="small"
              />
            </Stack>
            <Stack direction="row" sx={{ justifyContent: "flex-end", mt: 2 }}>
              <Button type="submit" size="small" variant="contained" loading={savingPassword}>
                更新密碼
              </Button>
            </Stack>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3, width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            登入 Email
          </Typography>
          {pendingEmail && (
            <Alert severity="success" sx={{ mb: 2 }}>
              已寄出確認信至 {pendingEmail}，請點擊信中連結完成變更；完成前登入 email 維持原值。
            </Alert>
          )}
          {emailFormError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {emailFormError}
            </Alert>
          )}
          <Box component="form" onSubmit={handleUpdateEmail}>
            <Stack spacing={2}>
              <TextField
                label="目前 Email"
                inputRef={emailInputRef}
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                onBlur={() => setEmailTouched(true)}
                error={Boolean(showEmailError)}
                helperText={showEmailError ?? " "}
                slotProps={{ formHelperText: { role: "alert", "aria-live": "polite" } }}
                disabled={savingEmail}
                fullWidth
                size="small"
              />
              <TextField
                label="目前密碼"
                type="password"
                inputRef={emailCurrentPasswordRef}
                value={emailCurrentPassword}
                onChange={(event) => {
                  setEmailCurrentPassword(event.target.value);
                  setEmailCurrentPasswordError(null);
                }}
                error={Boolean(emailCurrentPasswordError)}
                helperText={emailCurrentPasswordError ?? " "}
                slotProps={{ formHelperText: { role: "alert", "aria-live": "polite" } }}
                disabled={savingEmail}
                autoComplete="current-password"
                fullWidth
                size="small"
              />
            </Stack>
            <Stack direction="row" sx={{ justifyContent: "flex-end", mt: 2 }}>
              <Button type="submit" size="small" variant="contained" loading={savingEmail} disabled={!hasEmailChanges}>
                更新 Email
              </Button>
            </Stack>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 3, width: "100%" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              雙重驗證（MFA）
            </Typography>
            <Chip size="small" label={mfaFactorId ? "已啟用" : "未啟用"} color={mfaFactorId ? "primary" : "default"} />
          </Stack>

          {mfaEnrollment ? (
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
                使用 Authenticator App 掃描下方 QR Code，輸入產生的驗證碼完成啟用
              </Typography>
              <Stack direction="row" spacing={3} sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                <Box
                  component="img"
                  src={mfaEnrollment.qrCode}
                  alt="MFA 驗證 QR Code"
                  sx={{ width: 140, height: 140, flexShrink: 0, border: "1px solid", borderColor: "divider", borderRadius: 1 }}
                />
                <Box sx={{ flex: 1, minWidth: 220 }}>
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
                    或手動輸入密鑰：
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {mfaEnrollment.secret}
                    </Box>
                  </Typography>
                  <OtpInput
                    value={mfaEnrollment.code}
                    onChange={(code) => setMfaEnrollment((state) => (state ? { ...state, code, error: null } : state))}
                    error={Boolean(mfaEnrollment.error)}
                    disabled={mfaEnrollment.verifying || mfaEnrollment.canceling}
                    autoFocus
                  />
                  {mfaEnrollment.error && (
                    <Typography variant="caption" role="alert" aria-live="polite" sx={{ color: "error.main", display: "block", mt: 1 }}>
                      {mfaEnrollment.error}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleCancelMfaEnrollment}
                      loading={mfaEnrollment.canceling}
                      disabled={mfaEnrollment.verifying}
                    >
                      取消
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleConfirmMfaEnrollment}
                      loading={mfaEnrollment.verifying}
                      disabled={mfaEnrollment.canceling || mfaEnrollment.code.length < OTP_LENGTH}
                    >
                      確認啟用
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Box>
          ) : mfaLoadError ? (
            <Box>
              <Typography variant="caption" role="alert" sx={{ color: "error.main", display: "block", mb: 1 }}>
                無法讀取雙重驗證狀態，請重試。
              </Typography>
              <Button size="small" variant="outlined" onClick={handleRetryLoadMfa}>
                重試
              </Button>
            </Box>
          ) : (
            <>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
                啟用後登入時將額外要求輸入 Authenticator App 的驗證碼
              </Typography>
              {mfaFactorId ? (
                <Button size="small" variant="outlined" color="error" onClick={openMfaUnenrollDialog}>
                  停用雙重驗證
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleStartMfaEnrollment}
                  loading={mfaEnrollStarting}
                  disabled={mfaLoading}
                >
                  啟用雙重驗證
                </Button>
              )}
            </>
          )}
        </Paper>
      </Stack>

      <ConfirmDialog
        open={mfaUnenrollDialogOpen}
        title="確定要停用雙重驗證？"
        description="停用後登入將只需要帳號密碼，帳號保護程度會降低。請輸入目前密碼與 Authenticator App 目前顯示的驗證碼確認身分："
        confirmLabel="確認停用"
        confirmColor="error"
        loading={mfaUnenrolling}
        onConfirm={handleConfirmMfaUnenroll}
        onClose={() => {
          // 停用進行中不允許透過背景點擊／Esc 關閉——請求仍會在背景完成，提前關閉會讓
          // 畫面狀態（對話框已關閉但操作其實還沒結束）與實際結果不一致
          // （security-reviewer TASK-043 審查發現）。
          if (mfaUnenrolling) return;
          setMfaUnenrollDialogOpen(false);
        }}
      >
        <Box sx={{ mt: 1 }}>
          <TextField
            label="目前密碼"
            type="password"
            value={mfaUnenrollPassword}
            onChange={(event) => {
              setMfaUnenrollPassword(event.target.value);
              setMfaUnenrollError(null);
            }}
            disabled={mfaUnenrolling}
            autoComplete="current-password"
            autoFocus
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />
          <OtpInput
            value={mfaUnenrollCode}
            onChange={(code) => {
              setMfaUnenrollCode(code);
              setMfaUnenrollError(null);
            }}
            error={Boolean(mfaUnenrollError)}
            disabled={mfaUnenrolling}
          />
          {mfaUnenrollError && (
            <Typography variant="caption" role="alert" aria-live="polite" sx={{ color: "error.main", display: "block", mt: 1 }}>
              {mfaUnenrollError}
            </Typography>
          )}
        </Box>
      </ConfirmDialog>
    </Box>
  );
}
