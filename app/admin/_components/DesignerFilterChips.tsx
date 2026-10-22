"use client";

import * as React from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { designerInitial, resolveDesignerAssetUrl } from "@/lib/designers";
import type { DesignerChip } from "@/lib/admin/designer-filter";

// 預約週曆／列表的設計師多選篩選 Chip 列（mockup Variant A，多選）。全部用既有的 MUI Chip／Avatar，不新增 token。
// 「全部」亮起與「清除篩選」顯示一律看 selectedIds（呼叫端傳入的「有效選取」），規則見 lib/admin/designer-filter.ts。

// 頭像的唯一渲染點：週曆事件卡、列表、詳情、改期表單與篩選 Chip 共用，白名單、no-referrer 與首字預設頭像
// 綁在一起，避免某一處漏掉。avatarUrl 來自資料庫可被 admin 直接寫入的欄位，一律先過 resolveDesignerAssetUrl。
// className 要轉給 Avatar：MUI Chip 的 avatar prop 靠 className 套用 Chip 內的尺寸。
export function DesignerAvatar({
  name,
  avatarUrl,
  size,
  className,
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <Avatar
      className={className}
      src={resolveDesignerAssetUrl(avatarUrl) ?? undefined}
      alt=""
      slotProps={{ img: { referrerPolicy: "no-referrer" } }}
      sx={{
        bgcolor: "grey.200",
        color: "text.secondary",
        ...(size ? { width: size, height: size, fontSize: Math.round(size * 0.5) } : {}),
      }}
    >
      {designerInitial(name)}
    </Avatar>
  );
}

// 頭像加名稱的一列。名稱用 <bdi> 隔離方向（名稱只擋方向控制字元，仍可輸入從右到左的文字），容器裁掉溢出，
// 避免超長名稱或疊字撐破版面。wrap 為 true 時（詳情）允許換行但同樣裁溢出。
export function DesignerLabel({
  name,
  avatarUrl,
  size = 20,
  wrap = false,
  variant = "caption",
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
  wrap?: boolean;
  variant?: "caption" | "body2";
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0, overflow: "hidden" }}>
      <Box sx={{ flex: "0 0 auto", display: "flex" }}>
        <DesignerAvatar name={name} avatarUrl={avatarUrl} size={size} />
      </Box>
      <Box
        component="span"
        sx={{
          minWidth: 0,
          overflow: "hidden",
          typography: variant,
          color: variant === "caption" ? "text.secondary" : "text.primary",
          ...(wrap ? { overflowWrap: "anywhere" } : { whiteSpace: "nowrap", textOverflow: "ellipsis" }),
        }}
      >
        <bdi>{name}</bdi>
      </Box>
    </Stack>
  );
}

export type DesignerFilterChipsProps = {
  loading: boolean;
  chips: DesignerChip[];
  // 有效選取（空陣列＝全部）。
  selectedIds: string[];
  totalCount: number;
  onToggle: (designerId: string) => void;
  onClear: () => void;
};

export function DesignerFilterChips({ loading, chips, selectedIds, totalCount, onToggle, onClear }: DesignerFilterChipsProps) {
  if (loading) {
    return (
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} aria-label="載入設計師篩選">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" width={112} height={32} />
        ))}
      </Stack>
    );
  }

  if (chips.length === 0) return null;

  const allSelected = selectedIds.length === 0;

  return (
    <Stack
      direction="row"
      role="group"
      aria-label="設計師篩選"
      sx={{ mb: 2, flexWrap: "wrap", gap: 1, alignItems: "center" }}
    >
      <Chip
        label={`全部 · ${totalCount}`}
        clickable
        aria-pressed={allSelected}
        color={allSelected ? "primary" : "default"}
        variant={allSelected ? "filled" : "outlined"}
        onClick={onClear}
      />
      {chips.map((chip) => {
        const selected = selectedIds.includes(chip.id);
        return (
          <Chip
            key={chip.id}
            clickable
            aria-pressed={selected}
            color={selected ? "primary" : "default"}
            variant={selected ? "filled" : "outlined"}
            avatar={<DesignerAvatar name={chip.name} avatarUrl={chip.avatarUrl} />}
            onClick={() => onToggle(chip.id)}
            sx={{ maxWidth: 220, opacity: chip.isActive ? 1 : 0.75 }}
            label={
              <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                {selected && <span aria-hidden>✓</span>}
                <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <bdi>{chip.name}</bdi>
                </Box>
                {!chip.isActive && (
                  <Box component="span" sx={{ flex: "0 0 auto", fontSize: 11 }}>
                    已停用
                  </Box>
                )}
                <Box component="span" sx={{ flex: "0 0 auto", opacity: 0.75 }}>
                  {chip.count}
                </Box>
              </Box>
            }
          />
        );
      })}
      {!allSelected && (
        <Button size="small" variant="text" onClick={onClear}>
          清除篩選
        </Button>
      )}
    </Stack>
  );
}
