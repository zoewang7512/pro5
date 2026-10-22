"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import Switch from "@mui/material/Switch";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import { createClient } from "@/lib/supabase/client";
import { listDesignerServiceIds, setDesignerService } from "@/lib/admin/designers";
import { listServices } from "@/lib/admin/services";
import { formatPrice } from "@/lib/admin/format";
import type { AdminService } from "@/lib/booking/types";
import { useToast } from "@/components/ui/ToastProvider";

// 設計師編輯頁的「提供服務」頁籤（TASK-070）：每個上架中的服務一列，Switch 開關即時寫入
// （開啟＝insert 一列 designer_services、關閉＝delete 一列）。
//
// 開啟數的口徑是「上架中且已開啟」，和 listDesigners 的 service_count 一致；Switch 與數字都從同一份
// enabled Set 推導，改變時透過 onCountChange 回報父層（頁籤標籤在還沒點進本頁籤前就要顯示數字，所以父層
// 讓本元件常駐掛載）。onCountChange 一律在載入完成與寫入的事件處理中呼叫，不在 effect 內同步 setState。
//
// 寫入失敗（含逾時等結果不明的情況）時伺服器可能其實已經寫入，不盲目把 Switch 翻回去，而是重讀資料庫為準，
// 重讀也失敗才把這一列回復原值。同一列寫入未完成前停用該列 Switch，避免 insert／delete 交錯；不同列可並行。

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; services: AdminService[] };

const SKELETON_ROWS = 4;

function countEnabled(services: AdminService[], enabled: Set<string>): number {
  return services.filter((service) => enabled.has(service.id)).length;
}

function withToggled(set: Set<string>, id: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

export function DesignerServicesTab({
  designerId,
  onCountChange,
}: {
  designerId: string;
  onCountChange: (count: number) => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [enabled, setEnabled] = React.useState<Set<string>>(() => new Set());
  const [pending, setPending] = React.useState<Set<string>>(() => new Set());
  // 非同步的寫入流程要讀到「最新」的開啟與寫入中集合，不能用 render 當下閉包裡的舊值。
  const enabledRef = React.useRef<Set<string>>(new Set());
  const pendingRef = React.useRef<Set<string>>(new Set());
  const onCountChangeRef = React.useRef(onCountChange);
  React.useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  function applyEnabled(next: Set<string>, services: AdminService[]) {
    enabledRef.current = next;
    setEnabled(next);
    onCountChangeRef.current(countEnabled(services, next));
  }

  function setRowPending(id: string, on: boolean) {
    pendingRef.current = withToggled(pendingRef.current, id, on);
    setPending(pendingRef.current);
  }

  // 掛載時的初次載入：setState 放在 promise .then() 回呼裡（比照 ServicesTable.tsx 既有寫法）。兩份資料任一讀取
  // 失敗就不畫 Switch——只讀到服務清單而 designer_services 失敗，會讓店長以為所有服務都被關掉。
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([listServices(supabase), listDesignerServiceIds(supabase, designerId)]).then(([servicesRes, idsRes]) => {
      if (cancelled) return;
      if (!servicesRes.ok || !idsRes.ok) {
        setState({ status: "error" });
        return;
      }
      const services = servicesRes.data.filter((service) => service.is_active);
      setState({ status: "loaded", services });
      applyEnabled(new Set(idsRes.data), services);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, designerId]);

  async function handleToggle(services: AdminService[], service: AdminService, on: boolean) {
    if (pendingRef.current.has(service.id)) return;
    setRowPending(service.id, true);
    applyEnabled(withToggled(enabledRef.current, service.id, on), services);

    const result = await setDesignerService(supabase, designerId, service.id, on);
    if (!result.ok) {
      showToast("操作失敗，請稍後再試", "error");
      const fresh = await listDesignerServiceIds(supabase, designerId);
      if (fresh.ok) {
        // 以資料庫為準；其他列還在寫入中的，保留它們目前的樂觀值（資料庫可能還沒反映）。
        let next = new Set(fresh.data);
        for (const otherId of pendingRef.current) {
          if (otherId !== service.id) next = withToggled(next, otherId, enabledRef.current.has(otherId));
        }
        applyEnabled(next, services);
      } else {
        applyEnabled(withToggled(enabledRef.current, service.id, !on), services);
      }
    }
    setRowPending(service.id, false);
  }

  if (state.status === "error") {
    return <Alert severity="error">無法載入提供服務的設定，請重新整理頁面再試一次。</Alert>;
  }

  if (state.status === "loading") {
    return (
      <Stack spacing={1}>
        {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
          <Skeleton key={index} variant="rounded" height={56} />
        ))}
      </Stack>
    );
  }

  const { services } = state;

  if (services.length === 0) {
    return <Alert severity="info">目前沒有上架中的服務，請先到「服務項目」頁新增或重新上架。</Alert>;
  }

  return (
    <Box>
      <Paper variant="outlined">
        {services.map((service, index) => {
          const isOn = enabled.has(service.id);
          return (
            <React.Fragment key={service.id}>
              {index > 0 && <Divider />}
              <Stack
                direction="row"
                sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, px: 3, py: 2 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: isOn ? "text.primary" : "text.secondary" }}>
                    {service.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {service.duration_minutes} 分鐘 · {formatPrice(service.price)}
                  </Typography>
                </Box>
                <Switch
                  checked={isOn}
                  onChange={(_event, checked) => handleToggle(services, service, checked)}
                  disabled={pending.has(service.id)}
                  slotProps={{ input: { "aria-label": `開放「${service.name}」` } }}
                />
              </Stack>
            </React.Fragment>
          );
        })}
      </Paper>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1.5 }}>
        關閉服務不會影響已經成立的預約，只會影響之後的新預約。已下架的服務不會列在這裡。
      </Typography>
    </Box>
  );
}
