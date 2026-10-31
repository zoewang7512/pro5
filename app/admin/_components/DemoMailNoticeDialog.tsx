"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import {
  DEMO_MAIL_NOTICE_BACK_LABEL,
  DEMO_MAIL_NOTICE_CONTINUE_LABEL,
  DEMO_MAIL_NOTICE_COPY,
  DEMO_MAIL_NOTICE_NOTE,
} from "@/lib/demo/notice-copy";

// Demo 體驗帳號在改期、取消的最終確認後出現的說明視窗（TASK-115，架構筆記 D13）：
// 以圖片示意「顧客會收到的通知信」，說明正式環境會寄、體驗帳號不會真的寄出。
// 這只是說明，不是安全邊界——真正不寄信由資料庫守門保證（TASK-114）。
//
// 元件本身不認識 Demo：呼叫端（AdminDashboard）只在 isDemo 時才開啟它，所以一般管理員
// 永遠不會載入圖片。按「我知道了，繼續」呼叫 onContinue；返回、Esc、點遮罩都呼叫 onBack，
// 由呼叫端決定「不寫入、回到原畫面」。

export type DemoMailNoticeKind = keyof typeof DEMO_MAIL_NOTICE_COPY;

export type DemoMailNoticeDialogProps = {
  open: boolean;
  kind: DemoMailNoticeKind;
  onContinue: () => void;
  onBack: () => void;
};

// 示意圖是固定的信件樣貌（淺色），暗色模式下仍以這張淺色卡片呈現，所以邊框與底色不隨主題反轉。
const MAIL_CARD_BG = "#F6F3EE";
const MAIL_CARD_BORDER = "#E4DDD1";

export function DemoMailNoticeDialog({ open, kind, onContinue, onBack }: DemoMailNoticeDialogProps) {
  const copy = DEMO_MAIL_NOTICE_COPY[kind];
  // 以圖片網址為 key 記錄載入失敗：換成另一種信件（改期↔取消）時自動回到「正常」，不必手動重置。
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const imageFailed = failedSrc === copy.imageSrc;

  return (
    <Dialog open={open} onClose={onBack} aria-labelledby="demo-mail-notice-title" fullWidth maxWidth="xs">
      <DialogTitle id="demo-mail-notice-title" sx={{ fontSize: 16, fontWeight: 700, pb: 1.5 }}>
        {copy.title}
      </DialogTitle>
      <DialogContent>
        {imageFailed ? (
          <Box
            sx={{
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 1,
              p: 2.5,
              bgcolor: MAIL_CARD_BG,
              color: "#2B2622",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            <Box component="b">主旨：{copy.fallbackSubject}</Box>
            <br />
            {copy.fallbackBody}
          </Box>
        ) : (
          // 以已知的圖片長寬比預留高度，圖片載入前視窗不會跳動。
          <Box
            sx={{
              border: `1px solid ${MAIL_CARD_BORDER}`,
              borderRadius: 1,
              bgcolor: MAIL_CARD_BG,
              overflow: "hidden",
              aspectRatio: `${copy.imageWidth} / ${copy.imageHeight}`,
            }}
          >
            <Box
              component="img"
              src={copy.imageSrc}
              alt={copy.imageAlt}
              width={copy.imageWidth}
              height={copy.imageHeight}
              onError={() => setFailedSrc(copy.imageSrc)}
              sx={{ display: "block", width: "100%", height: "auto" }}
            />
          </Box>
        )}
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: "text.secondary", mt: 1.5 }}>
          {DEMO_MAIL_NOTICE_NOTE}
        </Typography>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          pb: 3,
          // 手機：按鈕垂直堆疊、主要動作在上，高度 ≥ 44px；桌面維持右對齊的一列。
          flexDirection: { xs: "column-reverse", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          gap: 1,
          "& > :not(style) ~ :not(style)": { ml: { xs: 0, sm: 1 } },
          "& .MuiButton-root": { minHeight: { xs: 44, sm: 36 } },
        }}
      >
        <Button variant="outlined" onClick={onBack}>
          {DEMO_MAIL_NOTICE_BACK_LABEL}
        </Button>
        <Button variant="contained" onClick={onContinue}>
          {DEMO_MAIL_NOTICE_CONTINUE_LABEL}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
