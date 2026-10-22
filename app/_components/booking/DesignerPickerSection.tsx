"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DesignerAvatarRail } from "@/components/ui/DesignerAvatarRail";
import { ANY_DESIGNER } from "@/lib/booking/booking-flow-state";
import type { DesignerSelection, PublicDesigner, PublicPortfolioImage } from "@/lib/booking/types";
import { SectionHeader, SummaryLine } from "./SectionChrome";

export type DesignerPickerSectionProps = {
  status: "loading" | "loaded" | "error";
  // 完整名單，含每位設計師的全部作品（預覽卡只畫前 4 張）。TASK-074 的個人頁直接用同一份，不再查詢。
  designers: PublicDesigner[];
  selection: DesignerSelection;
  collapsed: boolean;
  onSelect: (selection: DesignerSelection) => void;
  onEdit: () => void;
};

const ANY_KEY = "any";
const PREVIEW_THUMB_COUNT = 4;

// 區塊最外層固定 id：TASK-074 關閉個人頁後要捲回這裡。
export const DESIGNER_STEP_ID = "designer-step";

export function DesignerPickerSection({
  status,
  designers,
  selection,
  collapsed,
  onSelect,
  onEdit,
}: DesignerPickerSectionProps) {
  // 「看完整作品集 ›」的開啟處理函式留在元件內部：個人頁開不開是這個區塊的局部狀態，由 TASK-074 在這裡加
  // state 與 Dialog，BookingFlow 不需要為它改動。收合摘要與展開畫面由同一個元件 render，Dialog 才不會在
  // history.back() 之前因為區塊收合而被卸載。
  function handleOpenProfile() {}

  function handleSelectKey(key: string) {
    if (key === ANY_KEY) {
      onSelect(ANY_DESIGNER);
      return;
    }
    const designer = designers.find((item) => item.id === key);
    if (designer) onSelect({ kind: "designer", designer });
  }

  if (collapsed) {
    return (
      <Box component="section" id={DESIGNER_STEP_ID} sx={{ mb: 3 }}>
        <SectionHeader done label="設計師" onEdit={onEdit} />
        <SummaryLine primary={selection.kind === "designer" ? selection.designer.name : "不指定設計師"} />
      </Box>
    );
  }

  return (
    <Box component="section" id={DESIGNER_STEP_ID} sx={{ mb: 3 }}>
      <SectionHeader step={2} label="選擇設計師" />

      {status === "loading" && (
        <Box aria-label="設計師載入中">
          <Stack direction="row" spacing={2} sx={{ pt: 0.5, pb: 1.5 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="circular" width={72} height={72} sx={{ flex: "0 0 auto" }} />
            ))}
          </Stack>
          <Skeleton variant="rounded" height={120} sx={{ borderRadius: 1.5 }} />
        </Box>
      )}

      {status === "error" && <Alert severity="error">無法載入設計師名單，請重新整理頁面再試一次。</Alert>}

      {status === "loaded" && designers.length === 0 && (
        <Alert severity="info">目前沒有設計師提供這項服務，請選擇其他服務。</Alert>
      )}

      {status === "loaded" && designers.length > 0 && (
        <>
          <DesignerAvatarRail
            ariaLabel="選擇設計師"
            items={[
              { key: ANY_KEY, label: "不指定", variant: "any" },
              ...designers.map((designer) => ({
                key: designer.id,
                label: designer.name,
                avatarUrl: designer.avatar_url,
                variant: "person" as const,
              })),
            ]}
            selectedKey={selection.kind === "designer" ? selection.designer.id : ANY_KEY}
            onSelect={handleSelectKey}
            // 讓頭像列延伸到容器邊緣：超出畫面的頭像會露出一半，暗示可以橫向捲動。
            sx={{ mx: { xs: -2.5, sm: -3 }, px: { xs: 2.5, sm: 3 } }}
          />
          <PreviewCard selection={selection} onOpenProfile={handleOpenProfile} />
        </>
      )}
    </Box>
  );
}

function PreviewCard({ selection, onOpenProfile }: { selection: DesignerSelection; onOpenProfile: () => void }) {
  if (selection.kind === "any") {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          不指定設計師
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          會顯示所有設計師的空檔，送出預約後由系統安排一位有空的設計師。
        </Typography>
      </Paper>
    );
  }

  const { designer } = selection;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline", gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
          {designer.name}
        </Typography>
        <Link
          component="button"
          type="button"
          variant="body2"
          onClick={onOpenProfile}
          sx={{ fontWeight: 600, flex: "0 0 auto" }}
        >
          看完整作品集 ›
        </Link>
      </Stack>

      {designer.bio && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
          {designer.bio}
        </Typography>
      )}

      {designer.specialties.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 1 }}>
          {designer.specialties.map((tag) => (
            <Chip key={tag} label={tag} size="small" variant="outlined" />
          ))}
        </Stack>
      )}

      {designer.portfolio.length > 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${PREVIEW_THUMB_COUNT}, 1fr)`, gap: 0.5, mt: 1.5 }}>
          {designer.portfolio.slice(0, PREVIEW_THUMB_COUNT).map((image) => (
            <PortfolioThumb key={image.id} image={image} designerName={designer.name} />
          ))}
        </Box>
      )}
    </Paper>
  );
}

// 圖片載入前顯示 grey.200 底色；載入失敗（例如檔案已被刪除）保留底色、不顯示破圖。
function PortfolioThumb({ image, designerName }: { image: PublicPortfolioImage; designerName: string }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <Box sx={{ aspectRatio: "1", bgcolor: "grey.200", borderRadius: 0.5, overflow: "hidden" }}>
      {!failed && (
        <Box
          component="img"
          src={image.image_url}
          alt={`${designerName}的作品`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </Box>
  );
}
