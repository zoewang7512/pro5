"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import {
  DEMO_BANNER_TEXT,
  DEMO_BANNER_TEXT_SHORT,
  DEMO_CAN_TRY_ITEMS,
  DEMO_CAN_TRY_TITLE,
  DEMO_LEARN_MORE_LABEL,
  DEMO_NOT_ALLOWED_ITEMS,
  DEMO_NOT_ALLOWED_TITLE,
  DEMO_NOTICE_CONFIRM_LABEL,
  DEMO_NOTICE_TITLE,
  DEMO_RESET_LABEL,
} from "@/lib/demo/notice-copy";
import { useAdminProfile } from "./AdminProfileContext";

// 體驗帳號橫幅與說明視窗（TASK-105）。僅 Demo 登入時渲染；一般管理員回傳 null，版面與現況一致。
//
// 兩個 sessionStorage 旗標（架構筆記 D6）：
// - `demo-welcome-pending`：登入頁一鍵進入成功時設（TASK-104），這裡掛載時讀到就彈出視窗並清除，
//   所以重新整理不會再彈。
// - `demo-banner-dismissed`：✕ 關閉橫幅時設，同一分頁不再顯示；新分頁或重新一鍵進入（登入頁會移除它）會再出現。
// sessionStorage 在隱私模式等情況可能拋例外：讀取失敗時當成「沒關閉過」，並把「進後台」視為
// 第一次而彈出視窗（每次都顯示，寧可多提示也不讓面試官漏看）；寫入失敗只影響本次畫面之外的記憶。
const WELCOME_PENDING_KEY = "demo-welcome-pending";
const BANNER_DISMISSED_KEY = "demo-banner-dismissed";

function consumeWelcomePending(): boolean {
  try {
    if (sessionStorage.getItem(WELCOME_PENDING_KEY) === null) return false;
    sessionStorage.removeItem(WELCOME_PENDING_KEY);
    return true;
  } catch {
    return true;
  }
}

function readBannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(BANNER_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function writeBannerDismissed() {
  try {
    sessionStorage.setItem(BANNER_DISMISSED_KEY, "1");
  } catch {
    // 儲存不可用：只在目前畫面隱藏，重新整理後會再出現。
  }
}

export function DemoNotice() {
  const { isDemo } = useAdminProfile();
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // 掛載後才讀 sessionStorage：伺服器端渲染讀不到，初始 render 必須與 SSR 一致以免 hydration 不符。
  // 橫幅在 SSR 就渲染（避免多數面試官看到內容被往下推一格），已關閉過的才會在掛載後隱藏。
  //
  // 讀取與 setState 放進 microtask：react-hooks/set-state-in-effect 禁止在 effect 主體同步 setState
  // （與 AccountSettingsView 的 MFA 讀取同一個理由）。cancelled 讓 React Strict Mode 的 effect 重跑
  // 只有最後一次生效，旗標不會被前一次白白消耗掉。
  React.useEffect(() => {
    if (!isDemo) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (readBannerDismissed()) setBannerDismissed(true);
      if (consumeWelcomePending()) setDialogOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  if (!isDemo) return null;

  // 缺少還原時間時降級成不含時間的簡短版（畫面規格「錯誤」狀態），不顯示任何錯誤訊息。
  const hasResetTime = DEMO_RESET_LABEL.trim().length > 0;
  const bannerText = hasResetTime ? DEMO_BANNER_TEXT : DEMO_BANNER_TEXT_SHORT;
  const lead = `${DEMO_NOTICE_TITLE}。`;
  const rest = bannerText.startsWith(lead) ? bannerText.slice(lead.length) : "";

  function dismissBanner() {
    writeBannerDismissed();
    setBannerDismissed(true);
  }

  return (
    <>
      {!bannerDismissed && (
        <Alert
          severity="info"
          icon={false}
          // 預設 role="alert" 會在每次進後台都立即朗讀；這是常駐資訊而非錯誤，改用 status。
          role="status"
          action={
            <IconButton aria-label="關閉提示" onClick={dismissBanner} sx={{ width: 40, height: 40, my: -0.75 }}>
              <Box component="span" aria-hidden sx={{ fontSize: 16, lineHeight: 1 }}>
                ✕
              </Box>
            </IconButton>
          }
          sx={{
            borderRadius: 0,
            flexShrink: 0,
            bgcolor: "info.light",
            color: "text.primary",
            fontSize: 12,
            lineHeight: 1.5,
            px: { xs: 2, sm: 3.5 },
            py: 1,
          }}
        >
          <Box component="b" sx={{ fontWeight: 600 }}>
            {lead}
          </Box>
          {rest}{" "}
          <Link
            component="button"
            type="button"
            onClick={() => setDialogOpen(true)}
            sx={{ fontSize: "inherit", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "baseline" }}
          >
            {DEMO_LEARN_MORE_LABEL}
          </Link>
        </Alert>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        aria-labelledby="demo-notice-title"
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id="demo-notice-title" sx={{ fontSize: 16, fontWeight: 700, pb: 1 }}>
          {DEMO_NOTICE_TITLE}
        </DialogTitle>
        <DialogContent>
          <NoticeList title={DEMO_CAN_TRY_TITLE} items={DEMO_CAN_TRY_ITEMS} marker="✓" markerColor="success.main" />
          <NoticeList title={DEMO_NOT_ALLOWED_TITLE} items={DEMO_NOT_ALLOWED_ITEMS} marker="🔒" />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="contained" autoFocus onClick={() => setDialogOpen(false)} sx={{ width: { xs: "100%", sm: "auto" } }}>
            {DEMO_NOTICE_CONFIRM_LABEL}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function NoticeList({
  title,
  items,
  marker,
  markerColor,
}: {
  title: string;
  items: readonly string[];
  marker: string;
  markerColor?: string;
}) {
  return (
    <Box sx={{ "&:not(:last-of-type)": { mb: 2 } }}>
      <Typography component="h3" sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary", mb: 0.5 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
        {items.map((item) => (
          <Box
            component="li"
            key={item}
            sx={{ display: "flex", gap: 1, fontSize: 13, lineHeight: 1.7 }}
          >
            <Box component="span" aria-hidden sx={{ color: markerColor, fontWeight: 700, flexShrink: 0 }}>
              {marker}
            </Box>
            <span>{item}</span>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
