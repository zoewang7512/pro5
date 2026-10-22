"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";

// 顧客端的作品集：三欄正方形九宮格（2px 間距，滿版）加上放大檢視。點任一格開啟放大檢視（MUI `Dialog fullScreen`），
// 可用上一張／下一張按鈕、左右方向鍵或觸控滑動切換，Esc 或 × 關閉；放大檢視只管自己的 state、不碰 history，
// 所以關掉它不會關掉外層的個人頁。純展示元件：src 必須是呼叫端已過 `resolvePortfolioImageUrl` 白名單的網址
// （元件本身不驗證、不碰資料），圖片一律帶 `referrerPolicy="no-referrer"`。

export type PortfolioGridImage = { id: string; src: string };

export type PortfolioGridProps = {
  images: PortfolioGridImage[];
  // 組出縮圖／放大檢視的 alt 與標題，例如「林小美的作品 第 3 張，共 9 張」。
  ownerName: string;
};

const SWIPE_THRESHOLD_PX = 50;

export function PortfolioGrid({ images, ownerName }: PortfolioGridProps) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  // 圖片載入失敗（例如檔案已被刪除）時保留 grey.200 底色、不顯示破圖；縮圖與放大檢視共用同一份紀錄。
  const [failedIds, setFailedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const touchStartX = React.useRef<number | null>(null);

  const total = images.length;
  const index = openIndex === null || total === 0 ? null : Math.min(openIndex, total - 1);

  function markFailed(id: string) {
    setFailedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function goTo(next: number) {
    if (next < 0 || next >= total) return;
    setOpenIndex(next);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (index === null) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    // Alt+← 是瀏覽器的「上一頁」，帶修飾鍵的組合一律不處理；只在真的切換時才 preventDefault。
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === "ArrowRight" && index < total - 1) {
      event.preventDefault();
      goTo(index + 1);
    }
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches.length === 1 ? event.touches[0].clientX : null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    if (startX === null || index === null) return;
    const delta = event.changedTouches[0].clientX - startX;
    if (delta <= -SWIPE_THRESHOLD_PX) goTo(index + 1);
    else if (delta >= SWIPE_THRESHOLD_PX) goTo(index - 1);
  }

  if (total === 0) {
    return (
      <Box sx={{ textAlign: "center", px: 2.5, py: 6 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          尚無作品
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          這位設計師還沒有上傳作品
        </Typography>
      </Box>
    );
  }

  const current = index === null ? null : images[index];

  return (
    <>
      <Box role="group" aria-label={`${ownerName}的作品`} sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px" }}>
        {images.map((image, i) => (
          <ButtonBase
            key={image.id}
            aria-label={`查看第 ${i + 1} 張作品`}
            onClick={() => setOpenIndex(i)}
            sx={{ display: "block", aspectRatio: "1", bgcolor: "grey.200", overflow: "hidden" }}
          >
            {!failedIds.has(image.id) && (
              <Box
                component="img"
                src={image.src}
                alt={`${ownerName}的作品 第 ${i + 1} 張，共 ${total} 張`}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => markFailed(image.id)}
                sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </ButtonBase>
        ))}
      </Box>

      <Dialog
        fullScreen
        open={current !== null}
        onClose={() => setOpenIndex(null)}
        onKeyDown={handleKeyDown}
        aria-label={`${ownerName}的作品放大檢視`}
        slotProps={{
          paper: {
            // 黑底固定用 common.black：暗色模式下 grey 色階是反轉的，不能拿 grey.900 當黑底。
            sx: (theme) => ({
              bgcolor: alpha(theme.palette.common.black, 0.94),
              color: "common.white",
              backgroundImage: "none",
            }),
          },
        }}
      >
        {current && index !== null && (
          <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, px: 2.5, py: 1 }}>
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                <bdi>{ownerName}</bdi> · 作品
              </Typography>
              <IconButton aria-label="關閉放大檢視" onClick={() => setOpenIndex(null)} sx={{ color: "common.white", fontSize: 24 }}>
                ×
              </IconButton>
            </Box>

            <Box
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "pan-y" }}
            >
              {!failedIds.has(current.id) && (
                <Box
                  key={current.id}
                  component="img"
                  src={current.src}
                  alt={`${ownerName}的作品 第 ${index + 1} 張，共 ${total} 張`}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => markFailed(current.id)}
                  sx={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              )}
              <StepButton side="left" label="上一張" disabled={index === 0} onClick={() => goTo(index - 1)} />
              <StepButton side="right" label="下一張" disabled={index === total - 1} onClick={() => goTo(index + 1)} />
            </Box>

            <Box sx={{ pt: 1.5, pb: "calc(24px + env(safe-area-inset-bottom, 0px))", textAlign: "center" }}>
              <Typography variant="caption" aria-live="polite" sx={{ display: "block", color: "common.white" }}>
                {index + 1} / {total}
              </Typography>
              <Box aria-hidden sx={{ display: "flex", gap: 0.75, justifyContent: "center", mt: 1 }}>
                {images.map((image, i) => (
                  <Box
                    key={image.id}
                    sx={(theme) => ({
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bgcolor: i === index ? "common.white" : alpha(theme.palette.common.white, 0.35),
                    })}
                  />
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Dialog>
    </>
  );
}

function StepButton({
  side,
  label,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      sx={(theme) => ({
        position: "absolute",
        top: "50%",
        [side]: 8,
        transform: "translateY(-50%)",
        width: 40,
        height: 40,
        fontSize: 28,
        lineHeight: 1,
        color: "common.white",
        bgcolor: alpha(theme.palette.common.black, 0.45),
        "&:hover": { bgcolor: alpha(theme.palette.common.black, 0.65) },
        "&.Mui-disabled": { color: alpha(theme.palette.common.white, 0.3), bgcolor: "transparent" },
      })}
    >
      {side === "left" ? "‹" : "›"}
    </IconButton>
  );
}
