"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import { typeScale } from "@/lib/theme/tokens";

// 純 CSS 堆疊長條圖（不引入圖表套件）。儀表板頁籤用兩次（預約量圖、營收圖）。
// 純展示元件：不 import lib/admin/*、不碰 Supabase；數字的口徑、換算與文案（tooltip／aria-label）一律由呼叫端提供。
// 版面對齊 mockup reports-variant-b.html：長條區高 180px、x 軸標籤列 24px、欄距 4px、單欄最寬 32px、
// 3 條網格（頂／中／底，底線較深）、y 軸 3 個刻度。顏色全部取自 theme palette（含暗色）。
//
// 互動：hover 與鍵盤焦點顯示 tooltip；整張圖只有一個 tab stop（roving tabindex），方向鍵左右移動、
// Home／End 跳首尾、Esc 關閉提示；觸控點一下（聚焦）顯示。另附視覺上隱藏的等價資料表給螢幕閱讀器。

export type TrendBarSegment = {
  value: number;
  // solid＝已完成（實心）；striped＝待完成（斜紋）。兩者靠圖樣區分，不只靠顏色。
  kind: "solid" | "striped";
};

export type TrendBarBucket = {
  key: string;
  label: string;
  // x 軸標籤是否顯示（月視圖 31 格只標每 5 日）；省略視為顯示。隱藏時仍佔位，tooltip 仍有完整內容。
  // 元件不會替「今天」強制顯示標籤（相鄰標籤可能擠在一起），要標今天就由呼叫端把該格設為顯示。
  showLabel?: boolean;
  segments: TrendBarSegment[];
  // 多行純文字，第一行當標題（粗體）。
  tooltip: string[];
  // 這一格的無障礙名稱（日期＋預約量＋營收），同時是隱藏資料表的內容。
  ariaLabel: string;
  today?: boolean;
};

export type TrendBarChartProps = {
  buckets: TrendBarBucket[];
  // y 軸上限（對應長條區頂端），由呼叫端以 nice max 算出；超過的長條被夾在頂端。
  max: number;
  // 整張圖的名稱（role="group" 的 aria-label，也是隱藏資料表的標題）。
  ariaLabel: string;
  formatTick?: (value: number) => string;
  legend?: { solid: string; striped: string };
  // buckets 為空時顯示的文字（載入中、錯誤由呼叫端處理）。
  emptyLabel?: string;
};

const PLOT_HEIGHT = 180;
const LABEL_HEIGHT = 24;
const MIN_VISIBLE_HEIGHT = 2;
const MAX_BAR_WIDTH = 32;
const TOOLTIP_EDGE_RATIO = 0.2;
// 提示框約 3 行高；長條頂端以上放不下時，改貼長條區下緣（蓋在長條上，但不會伸出圖外）。
const TOOLTIP_ROOM = 80;

const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;

// theme.vars（CSS variables 模式）才能在 sx 函式裡跟著明暗模式切換；單元測試的簡易 theme 沒有 vars，退回 theme。
function paletteOf(theme: Theme) {
  return (theme.vars ?? theme).palette;
}

// 已完成＝實心主色；待完成＝斜紋（主色＋極淡主色底）加 1px 主色內框，色盲也分得出來。
function fillStyle(theme: Theme, kind: TrendBarSegment["kind"]) {
  const palette = paletteOf(theme);
  if (kind === "solid") return { backgroundColor: palette.primary.main };
  const tint = `color-mix(in srgb, ${palette.primary.main} 12%, ${palette.background.paper})`;
  return {
    backgroundImage: `repeating-linear-gradient(45deg, ${palette.primary.main} 0 2px, ${tint} 2px 6px)`,
    boxShadow: `inset 0 0 0 1px ${palette.primary.main}`,
  };
}

// 由下而上堆疊：solid 在下、striped 在上（stable sort，同類保留傳入順序）。高度依 value/max 換算並夾住：
// 總高不超過長條區；value > 0 的段至少 2px 才看得到；value <= 0 不渲染。
function layoutSegments(segments: TrendBarSegment[], max: number): { kind: TrendBarSegment["kind"]; height: number }[] {
  if (!(max > 0)) return [];
  const ordered = [...segments].sort((a, b) => Number(a.kind === "striped") - Number(b.kind === "striped"));
  const layout: { kind: TrendBarSegment["kind"]; height: number }[] = [];
  let used = 0;
  for (const segment of ordered) {
    if (!(segment.value > 0)) continue;
    const room = PLOT_HEIGHT - used;
    if (room <= 0) break;
    const raw = (segment.value / max) * PLOT_HEIGHT;
    const height = Math.round(Math.min(room, Math.max(MIN_VISIBLE_HEIGHT, raw)) * 100) / 100;
    used += height;
    layout.push({ kind: segment.kind, height });
  }
  return layout;
}

export function TrendBarChart({ buckets, max, ariaLabel, formatTick, legend, emptyLabel = "沒有資料" }: TrendBarChartProps) {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
  // Esc 關閉提示：直到下一次 hover／focus 變化才再顯示。
  const [dismissed, setDismissed] = React.useState(false);
  const columnRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const tooltipId = React.useId();

  if (buckets.length === 0) {
    return (
      <Box
        role="group"
        aria-label={ariaLabel}
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: PLOT_HEIGHT + LABEL_HEIGHT }}
      >
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      </Box>
    );
  }

  const tick = formatTick ?? ((value: number) => String(value));
  // buckets 變少時 roving 位置要落在範圍內（派生值，不用 effect 回寫 state）。
  const tabStop = Math.min(activeIndex, buckets.length - 1);
  const shownIndex = dismissed ? null : (hoverIndex ?? focusIndex);
  const shown = shownIndex !== null ? buckets[shownIndex] : undefined;

  const moveTo = (index: number) => {
    const target = Math.max(0, Math.min(buckets.length - 1, index));
    setActiveIndex(target);
    columnRefs.current[target]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        moveTo(index - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveTo(index + 1);
        break;
      case "Home":
        event.preventDefault();
        moveTo(0);
        break;
      case "End":
        event.preventDefault();
        moveTo(buckets.length - 1);
        break;
      case "Escape":
        // 只在提示顯示時攔下 Esc，讓外層（例如 Dialog）在沒有提示時仍能被 Esc 關閉。
        if (shown) {
          event.stopPropagation();
          setDismissed(true);
        }
        break;
    }
  };

  // 長條頂端以上放得下提示框時，浮在頂端上方；否則貼長條區下緣。
  const tooltipLift = (bucket: TrendBarBucket) => {
    const barHeight = layoutSegments(bucket.segments, max).reduce((sum, segment) => sum + segment.height, 0);
    return barHeight <= PLOT_HEIGHT - TOOLTIP_ROOM ? barHeight : 0;
  };

  // 提示框以該格中心定位；左側 20% 靠左、右側 20% 靠右對齊，避免第一格／最後一格的提示被切掉。
  const tooltipPlacement = (index: number): Record<string, string | number> => {
    const ratio = buckets.length > 1 ? index / (buckets.length - 1) : 0.5;
    if (ratio < TOOLTIP_EDGE_RATIO) return { left: 0 };
    if (ratio > 1 - TOOLTIP_EDGE_RATIO) return { right: 0 };
    return { left: `${((index + 0.5) / buckets.length) * 100}%`, transform: "translateX(-50%)" };
  };

  return (
    <Box role="group" aria-label={ariaLabel}>
      {legend && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 4, mb: 2 }}>
          {(["solid", "striped"] as const).map((kind) => (
            <Box
              key={kind}
              component="span"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                fontSize: typeScale.fontSize.sm,
                color: "text.secondary",
              }}
            >
              <Box
                component="i"
                aria-hidden="true"
                data-legend={kind}
                sx={(theme) => ({ width: 12, height: 12, display: "inline-block", ...fillStyle(theme, kind) })}
              />
              {legend[kind]}
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: "flex", gap: 2 }}>
        <Box
          aria-hidden="true"
          sx={{
            width: 40,
            height: PLOT_HEIGHT,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: typeScale.fontSize.xs,
            lineHeight: 1,
            color: "text.secondary",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{tick(max)}</span>
          <span>{tick(max / 2)}</span>
          <span>{tick(0)}</span>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, position: "relative", height: PLOT_HEIGHT + LABEL_HEIGHT }}>
          {[0, PLOT_HEIGHT / 2, PLOT_HEIGHT].map((top) => (
            <Box
              key={top}
              aria-hidden="true"
              sx={(theme) => ({
                position: "absolute",
                left: 0,
                right: 0,
                top,
                height: "1px",
                // 亮色：弱灰網格、較深底線（對齊 mockup）。暗色的 grey 色階反向，grey.200 與底色幾乎同色，各往上一階。
                bgcolor: top === PLOT_HEIGHT ? "grey.300" : "grey.200",
                ...theme.applyStyles("dark", {
                  backgroundColor: paletteOf(theme).grey[top === PLOT_HEIGHT ? 400 : 300],
                }),
              })}
            />
          ))}

          <Box sx={{ position: "absolute", inset: 0, display: "flex", gap: 1 }}>
            {buckets.map((bucket, index) => {
              const layout = layoutSegments(bucket.segments, max);
              return (
                <Box
                  key={bucket.key}
                  ref={(element: HTMLDivElement | null) => {
                    columnRefs.current[index] = element;
                  }}
                  role="img"
                  aria-label={bucket.ariaLabel}
                  aria-current={bucket.today ? "date" : undefined}
                  tabIndex={index === tabStop ? 0 : -1}
                  onMouseEnter={() => {
                    setHoverIndex(index);
                    setDismissed(false);
                  }}
                  onMouseLeave={() => setHoverIndex(null)}
                  onFocus={() => {
                    setActiveIndex(index);
                    setFocusIndex(index);
                    setDismissed(false);
                  }}
                  onBlur={() => setFocusIndex(null)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    outline: "none",
                    borderRadius: 0.5,
                    "&:focus-visible": {
                      boxShadow: (theme) => `inset 0 0 0 2px ${paletteOf(theme).primary.main}`,
                    },
                  }}
                >
                  <Box
                    sx={{
                      height: PLOT_HEIGHT,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      alignItems: "center",
                    }}
                  >
                    <Box
                      sx={{
                        width: "100%",
                        maxWidth: MAX_BAR_WIDTH,
                        display: "flex",
                        flexDirection: "column-reverse",
                      }}
                    >
                      {layout.map((segment, segmentIndex) => (
                        <Box
                          key={segmentIndex}
                          data-kind={segment.kind}
                          style={{ height: segment.height }}
                          sx={(theme) => fillStyle(theme, segment.kind)}
                        />
                      ))}
                    </Box>
                  </Box>
                  <Box
                    aria-hidden="true"
                    sx={(theme) => ({
                      height: LABEL_HEIGHT,
                      lineHeight: `${LABEL_HEIGHT}px`,
                      textAlign: "center",
                      fontSize: typeScale.fontSize.xs,
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      visibility: bucket.showLabel === false ? "hidden" : "visible",
                      color: bucket.today ? paletteOf(theme).primary.dark : "text.secondary",
                      fontWeight: bucket.today ? typeScale.fontWeight.bold : typeScale.fontWeight.regular,
                      ...theme.applyStyles("dark", {
                        color: bucket.today ? paletteOf(theme).primary.main : undefined,
                      }),
                    })}
                  >
                    {bucket.label}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {shown && shownIndex !== null && (
            <Box
              id={tooltipId}
              role="tooltip"
              aria-hidden="true"
              sx={[
                {
                  position: "absolute",
                  bottom: LABEL_HEIGHT + 8 + tooltipLift(shown),
                  zIndex: 2,
                  bgcolor: "grey.900",
                  color: "background.paper",
                  px: 3,
                  py: 2,
                  borderRadius: 1,
                  fontSize: typeScale.fontSize.sm,
                  lineHeight: 1.5,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  fontVariantNumeric: "tabular-nums",
                },
                tooltipPlacement(shownIndex),
              ]}
            >
              {shown.tooltip.map((line, lineIndex) => (
                <Box
                  key={lineIndex}
                  sx={{ fontWeight: lineIndex === 0 ? typeScale.fontWeight.bold : typeScale.fontWeight.regular }}
                >
                  {line}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <Box component="table" sx={visuallyHidden}>
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">單位</th>
            <th scope="col">明細</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              <td>{bucket.ariaLabel}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
