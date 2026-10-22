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
import { isDesignerId } from "@/lib/designers";
import { DesignerProfileDialog } from "./DesignerProfileDialog";
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

// 區塊最外層固定 id：關閉個人頁後焦點（與必要時的捲動位置）回到這裡。
export const DESIGNER_STEP_ID = "designer-step";

// 個人頁的 history entry 帶的 state：只放設計師 id 與本次載入的 session 值，不放任何個資。session 值讓重新整理
// 後殘留在 history 裡的舊 entry（內容是上一次載入的 id）不會被誤認成現在開著的個人頁。
const PROFILE_SESSION = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

type ProfileHistoryState = { designerProfile: string; designerProfileSession: string };

// 從任意 history.state 讀出「本次載入的個人頁 entry」的設計師 id；型別不對、session 不符、id 格式不對都回 null。
function readProfileId(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const { designerProfile, designerProfileSession } = state as Partial<Record<keyof ProfileHistoryState, unknown>>;
  if (designerProfileSession !== PROFILE_SESSION) return null;
  return typeof designerProfile === "string" && isDesignerId(designerProfile) ? designerProfile : null;
}

type ProfileView = { designer: PublicDesigner; open: boolean };

// 全頁個人頁的開關與瀏覽器歷史紀錄：開啟時 pushState，瀏覽器／手機返回鍵（popstate）關閉，AppBar 返回、Esc、
// 「選擇○○」關閉時呼叫 history.back() 讓歷史紀錄保持乾淨（關閉真正發生在 popstate）。state 常駐在區塊元件內，
// 收合摘要與展開畫面由同一個元件 render，Dialog 才不會在 back() 之前因為區塊收合而被卸載；BookingFlow 不需要為它改動。
function useDesignerProfileHistory(designers: PublicDesigner[]) {
  const [view, setView] = React.useState<ProfileView | null>(null);
  // back() 是非同步的：呼叫後到收到 popstate 之前 history.state 還沒變，這段期間忽略所有開啟與關閉，
  // 避免連點兩次退兩頁而離開預約頁。
  const pendingBackRef = React.useRef(false);

  React.useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      pendingBackRef.current = false;
      const id = readProfileId(event.state);
      // 只從已取得的公開名單查找（Array.find，不用物件索引表）；查不到一律當成關閉。
      const designer = id === null ? undefined : designers.find((item) => item.id === id);
      setView((prev) => (designer ? { designer, open: true } : prev && { ...prev, open: false }));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [designers]);

  // pushState／back() 只能在事件處理函式裡同步呼叫（不放進 effect 或 setState 更新函式，StrictMode 會重複執行）。
  function openProfile(designer: PublicDesigner) {
    if (pendingBackRef.current) return;
    const state: ProfileHistoryState = { designerProfile: designer.id, designerProfileSession: PROFILE_SESSION };
    try {
      // 目前 entry 已經是本次載入的個人頁（例如連點兩次）就改寫它，不再多 push 一筆。不帶 url 參數。
      if (readProfileId(window.history.state) !== null) window.history.replaceState(state, "");
      else window.history.pushState(state, "");
    } catch {
      // iOS Safari 對 pushState 有頻率上限；失敗就不寫歷史紀錄直接開啟（關閉時 session 不符，會直接關）。
    }
    setView({ designer, open: true });
  }

  // beforeClose 在確定會關閉時才執行一次（防重入之後），「選擇○○」用它呼叫 onSelect。
  function closeProfile(beforeClose?: () => void) {
    if (pendingBackRef.current || view === null) return;
    beforeClose?.();
    if (readProfileId(window.history.state) === view.designer.id) {
      pendingBackRef.current = true;
      window.history.back();
    } else {
      // 沒有對應的 history entry（例如 pushState 失敗、重新整理後 session 不符）：不呼叫 back()，直接關閉。
      setView({ ...view, open: false });
    }
  }

  function clearProfile() {
    setView(null);
  }

  // 名單換掉後找不到這位設計師（理論上個人頁開著時不會發生）：當成已關閉，不呼叫 back()。
  const visible = view !== null && designers.some((item) => item.id === view.designer.id);
  return { view, open: visible && view.open, openProfile, closeProfile, clearProfile };
}

export function DesignerPickerSection({
  status,
  designers,
  selection,
  collapsed,
  onSelect,
  onEdit,
}: DesignerPickerSectionProps) {
  const profile = useDesignerProfileHistory(designers);

  function handleSelectKey(key: string) {
    if (key === ANY_KEY) {
      onSelect(ANY_DESIGNER);
      return;
    }
    const designer = designers.find((item) => item.id === key);
    if (designer) onSelect({ kind: "designer", designer });
  }

  // 「選擇○○」等同點頭像：onSelect 收到的一律是名單裡的同一個物件，不是個人頁 state 裡的副本。
  function handleChooseFromProfile(chosen: PublicDesigner) {
    profile.closeProfile(() => {
      const designer = designers.find((item) => item.id === chosen.id);
      if (designer) onSelect({ kind: "designer", designer });
    });
  }

  // 淡出結束後清掉個人頁內容。「選擇○○」使區塊收合時，原本的「看完整作品集 ›」已被卸載、焦點會掉到 body，
  // 這時把焦點移回這個區塊。
  function handleProfileExited() {
    profile.clearProfile();
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.getElementById(DESIGNER_STEP_ID)?.focus({ preventScroll: true });
  }

  return (
    <>
      {collapsed ? (
        <Box component="section" id={DESIGNER_STEP_ID} tabIndex={-1} sx={{ mb: 3, outline: "none" }}>
          <SectionHeader done label="設計師" onEdit={onEdit} />
          <SummaryLine primary={selection.kind === "designer" ? selection.designer.name : "不指定設計師"} />
        </Box>
      ) : (
        <Box component="section" id={DESIGNER_STEP_ID} tabIndex={-1} sx={{ mb: 3, outline: "none" }}>
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
              <PreviewCard selection={selection} onOpenProfile={profile.openProfile} />
            </>
          )}
        </Box>
      )}

      <DesignerProfileDialog
        open={profile.open}
        designer={profile.view?.designer ?? null}
        onClose={() => profile.closeProfile()}
        onSelect={handleChooseFromProfile}
        onExited={handleProfileExited}
      />
    </>
  );
}

function PreviewCard({
  selection,
  onOpenProfile,
}: {
  selection: DesignerSelection;
  onOpenProfile: (designer: PublicDesigner) => void;
}) {
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
          onClick={() => onOpenProfile(designer)}
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
