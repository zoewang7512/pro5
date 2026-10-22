"use client";

import * as React from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import { createClient } from "@/lib/supabase/client";
import { getDesigner } from "@/lib/admin/designers";
import { isDesignerId, type Designer } from "@/lib/designers";
import { DesignerBasicInfoForm } from "./DesignerBasicInfoForm";
import { DesignerServicesTab } from "./DesignerServicesTab";

// 設計師編輯頁（TASK-069）：麵包屑＋四頁籤「基本資料／提供服務／作品集／請假」。TASK-069 完成「基本資料」，
// TASK-070 接上「提供服務」，其餘頁籤放占位內容，由 TASK-071／072 依序接上（那兩張卡會修改這個檔案，不並行）。
// designerId 為 null 代表新增模式：其他頁籤停用，建立成功後 router.replace 到 /admin/designers/<id>。

type TabValue = "basic" | "services" | "portfolio" | "leaves";

const TABS: Array<{ value: TabValue; label: string; placeholder: string }> = [
  { value: "basic", label: "基本資料", placeholder: "" },
  { value: "services", label: "提供服務", placeholder: "" },
  { value: "portfolio", label: "作品集", placeholder: "作品集管理即將開放。" },
  { value: "leaves", label: "請假", placeholder: "請假日設定即將開放。" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not-found" }
  | { status: "loaded"; designer: Designer };

export function DesignerEditView({ designerId }: { designerId: string | null }) {
  const supabase = React.useMemo(() => createClient(), []);
  const router = useRouter();
  const [tab, setTab] = React.useState<TabValue>("basic");
  // 「提供服務」頁籤標籤上的開啟數，由 DesignerServicesTab 載入完成後回報；null 代表還不知道，不顯示數字。
  const [serviceCount, setServiceCount] = React.useState<number | null>(null);
  const [state, setState] = React.useState<LoadState>(
    designerId === null ? { status: "loading" } : isDesignerId(designerId) ? { status: "loading" } : { status: "not-found" },
  );

  // 掛載時的初次載入：setState 放在 promise .then() 回呼裡（比照 ServicesTable.tsx 既有寫法）。
  React.useEffect(() => {
    if (designerId === null || !isDesignerId(designerId)) return;
    let cancelled = false;
    getDesigner(supabase, designerId).then((res) => {
      if (cancelled) return;
      if (!res.ok) setState({ status: "error" });
      else if (res.data === null) setState({ status: "not-found" });
      else setState({ status: "loaded", designer: res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, designerId]);

  const isCreate = designerId === null;
  const designer = state.status === "loaded" ? state.designer : null;
  // 載入完成前沒有名稱可顯示，麵包屑只顯示「設計師」，避免短暫出現「設計師 / 設計師」。
  const title = isCreate ? "新增設計師" : (designer?.name ?? "");

  function updateDesigner(patch: Partial<Designer>) {
    setState((prev) => (prev.status === "loaded" ? { status: "loaded", designer: { ...prev.designer, ...patch } } : prev));
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Breadcrumbs aria-label="麵包屑" sx={{ mb: 1 }}>
        <Link component={NextLink} href="/admin/designers" underline="hover" color="inherit">
          設計師
        </Link>
        {title !== "" && <Typography color="text.primary">{title}</Typography>}
      </Breadcrumbs>

      {state.status === "not-found" && (
        <Alert
          severity="warning"
          action={
            <Link component={NextLink} href="/admin/designers" underline="hover">
              回設計師列表
            </Link>
          }
        >
          找不到這位設計師。
        </Alert>
      )}

      {state.status === "error" && <Alert severity="error">無法載入設計師資料，請重新整理頁面再試一次。</Alert>}

      {state.status === "loading" && !isCreate && (
        <Stack spacing={1.5}>
          <Skeleton variant="rounded" height={32} width={200} />
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={240} />
        </Stack>
      )}

      {(isCreate || state.status === "loaded") && (
        <>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2 }}>
            <Typography variant="h6" component="h2">
              {title}
            </Typography>
            {designer && (
              <Chip
                size="small"
                label={designer.is_active ? "啟用中" : "已停用"}
                color={designer.is_active ? "success" : "default"}
              />
            )}
          </Stack>

          <Tabs
            value={tab}
            onChange={(_event, value: TabValue) => setTab(value)}
            aria-label="設計師設定"
            sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
          >
            {TABS.map((item) => (
              <Tab
                key={item.value}
                value={item.value}
                label={
                  item.value === "services" && serviceCount !== null ? (
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                      <span>{item.label}</span>
                      <Chip size="small" label={serviceCount} aria-label={`已開啟 ${serviceCount} 項`} />
                    </Stack>
                  ) : (
                    item.label
                  )
                }
                disabled={isCreate && item.value !== "basic"}
                id={`designer-tab-${item.value}`}
                aria-controls={`designer-tabpanel-${item.value}`}
              />
            ))}
          </Tabs>

          {/* 「基本資料」面板切頁籤時保持掛載（只是隱藏），否則未儲存的輸入會不見。 */}
          <Box
            role="tabpanel"
            id="designer-tabpanel-basic"
            aria-labelledby="designer-tab-basic"
            hidden={tab !== "basic"}
          >
            <DesignerBasicInfoForm
              designer={designer}
              onCreated={(id) => router.replace(`/admin/designers/${id}`)}
              onSaved={(patch) => updateDesigner(patch)}
              onAvatarChange={(avatarUrl) => updateDesigner({ avatar_url: avatarUrl })}
            />
          </Box>

          {/* 「提供服務」面板同樣常駐掛載：頁籤標籤的開啟數要在點進來之前就有，寫入途中切走也不會丟掉進行中的狀態。 */}
          <Box
            role="tabpanel"
            id="designer-tabpanel-services"
            aria-labelledby="designer-tab-services"
            hidden={tab !== "services"}
          >
            {designer && <DesignerServicesTab designerId={designer.id} onCountChange={setServiceCount} />}
          </Box>

          {TABS.filter((item) => item.value !== "basic" && item.value !== "services").map((item) => (
            <Box
              key={item.value}
              role="tabpanel"
              id={`designer-tabpanel-${item.value}`}
              aria-labelledby={`designer-tab-${item.value}`}
              hidden={tab !== item.value}
            >
              {tab === item.value && <Alert severity="info">{item.placeholder}</Alert>}
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
