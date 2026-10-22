"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { createClient } from "@/lib/supabase/client";
import {
  deletePortfolioImage,
  listPortfolio,
  removePortfolioFile,
  uploadPortfolioImage,
  type PortfolioImage,
} from "@/lib/admin/designers";
import { DESIGNER_PORTFOLIO_MAX_IMAGES, resolvePortfolioImageUrl } from "@/lib/designers";
import { PortfolioManager, type PortfolioActionResult } from "@/components/ui/PortfolioManager";
import { useToast } from "@/components/ui/ToastProvider";

// 設計師編輯頁的「作品集」頁籤（TASK-071）：上傳、刪除、12 張上限。清單狀態由本元件持有，載入完成與增刪後
// 透過 onCountChange 回報頁籤標籤的張數（父層讓本元件常駐掛載，比照「提供服務」頁籤）。
//
// 任何失敗都重讀清單，以資料庫為準：第 13 張被 trigger 擋下、別的分頁已刪、結果不明（逾時）時，畫面都不會
// 停在樂觀的假狀態。刪除資料列成功但檔案沒刪成功（cleanupWarning）時，用頁籤內常駐、可關閉的 Alert 提醒——
// 這是隱私相關的警告（可能是有臉的顧客照片），不用 4 秒就消失的 Toast；有路徑時附「重試刪除檔案」。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; images: PortfolioImage[] };

type FileWarning = { key: number; retryPath: string | null };

const FILE_WARNING_MESSAGE = "圖片已從作品集移除，但檔案可能仍可透過原網址存取，請點「重試刪除檔案」或聯絡管理者。";
const FILE_WARNING_NO_RETRY_MESSAGE = "圖片已從作品集移除，但檔案可能仍可透過原網址存取，請聯絡管理者。";
const SKELETON_CELLS = 6;

export function DesignerPortfolioTab({
  designerId,
  onCountChange,
}: {
  designerId: string;
  onCountChange: (count: number) => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [warnings, setWarnings] = React.useState<FileWarning[]>([]);
  const [retryingKey, setRetryingKey] = React.useState<number | null>(null);
  const warningKeyRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  const onCountChangeRef = React.useRef(onCountChange);
  React.useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 非同步流程要讀到「最新」清單，不能用 render 當下閉包裡的舊值（PortfolioManager 的單一 busy 鎖保證同時只有一個寫入）。
  const imagesRef = React.useRef<PortfolioImage[]>([]);

  function applyImages(images: PortfolioImage[]) {
    imagesRef.current = images;
    setState({ status: "loaded", images });
    onCountChangeRef.current(images.length);
  }

  // 掛載時的初次載入：setState 放在 promise .then() 回呼裡（比照 DesignerServicesTab）。
  React.useEffect(() => {
    let cancelled = false;
    listPortfolio(supabase, designerId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setState({ status: "error" });
        return;
      }
      applyImages(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, designerId]);

  async function reload() {
    const res = await listPortfolio(supabase, designerId);
    if (mountedRef.current && res.ok) applyImages(res.data);
  }

  async function handleUpload(file: File): Promise<PortfolioActionResult> {
    const result = await uploadPortfolioImage(supabase, designerId, file);
    if (!mountedRef.current) return { ok: true };
    if (result.ok) {
      const added = result.data;
      applyImages([added, ...imagesRef.current.filter((image) => image.id !== added.id)]);
      return { ok: true };
    }
    await reload();
    return { ok: false, error: result.error };
  }

  async function handleDelete(id: string): Promise<PortfolioActionResult> {
    const result = await deletePortfolioImage(supabase, designerId, id);
    if (!mountedRef.current) return { ok: true };
    if (!result.ok) {
      await reload();
      return { ok: false, error: result.error };
    }
    applyImages(imagesRef.current.filter((image) => image.id !== id));
    if (result.data.cleanupWarning) {
      warningKeyRef.current += 1;
      const warning = { key: warningKeyRef.current, retryPath: result.data.retryPath };
      setWarnings((prev) => [...prev, warning]);
    }
    return { ok: true };
  }

  async function handleRetry(warning: FileWarning) {
    if (warning.retryPath === null || retryingKey !== null) return;
    setRetryingKey(warning.key);
    const result = await removePortfolioFile(supabase, designerId, warning.retryPath);
    if (!mountedRef.current) return;
    setRetryingKey(null);
    if (result.ok) {
      setWarnings((prev) => prev.filter((item) => item.key !== warning.key));
      showToast("已刪除檔案", "success");
    } else {
      showToast("仍無法刪除檔案，請稍後再試或聯絡管理者", "error");
    }
  }

  if (state.status === "error") {
    return <Alert severity="error">無法載入作品集，請重新整理頁面再試一次。</Alert>;
  }

  if (state.status === "loading") {
    return (
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(3, 1fr)", md: "repeat(6, 1fr)" }, gap: 1.5 }}>
        {Array.from({ length: SKELETON_CELLS }).map((_, index) => (
          <Skeleton key={index} variant="rounded" sx={{ aspectRatio: "1", height: "auto" }} />
        ))}
      </Box>
    );
  }

  const items = state.images.map((image) => ({
    id: image.id,
    src: resolvePortfolioImageUrl(image.image_url, designerId),
  }));

  return (
    <Stack spacing={1.5}>
      {warnings.map((warning) => (
        <Alert
          key={warning.key}
          severity="warning"
          // MUI 的 Alert 只要給了 action 就不會渲染內建的關閉鈕，所以「關閉」也放在 action 裡。
          action={
            <Stack direction="row" spacing={0.5}>
              {warning.retryPath !== null && (
                <Button color="inherit" size="small" onClick={() => handleRetry(warning)} disabled={retryingKey !== null}>
                  重試刪除檔案
                </Button>
              )}
              <Button
                color="inherit"
                size="small"
                onClick={() => setWarnings((prev) => prev.filter((item) => item.key !== warning.key))}
              >
                關閉
              </Button>
            </Stack>
          }
        >
          {warning.retryPath === null ? FILE_WARNING_NO_RETRY_MESSAGE : FILE_WARNING_MESSAGE}
        </Alert>
      ))}

      <PortfolioManager
        items={items}
        maxImages={DESIGNER_PORTFOLIO_MAX_IMAGES}
        onUpload={handleUpload}
        onDelete={handleDelete}
      />

      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
        刪除後，照片最多約 5 分鐘內仍可能被看到。顧客要求移除照片時請直接刪除——停用設計師不會刪除檔案。
      </Typography>
    </Stack>
  );
}
