import type { SupabaseClient } from "@supabase/supabase-js";
import type { Designer } from "@/lib/designers";
import type { Result } from "./appointments";

// 設計師管理頁的資料存取，只給後台用（前台共用的型別與驗證在 lib/designers.ts）。本卡只有讀取，
// 寫入函式由後續任務卡（TASK-069～072）新增。與前台不同：這裡不過濾 is_active，後台需要同時
// 看到啟用中與停用中的設計師（RLS 對 is_admin() 放行全部）。

const INTERNAL_ERROR = { message: "發生未預期的錯誤，請稍後再試。" };

export type AdminDesigner = Designer & {
  // 這位設計師開啟的「上架中」服務數。下架中的服務即使還留著 designer_services 列也不計入，
  // 才能和 totalServices（上架中服務總數）一起顯示成「N / M 項」。
  service_count: number;
};

export type DesignerListData = {
  designers: AdminDesigner[];
  totalServices: number;
};

type DesignerServiceRow = { designer_id: string; service_id: string };

// 純函式：把 designer_services 的列對照上架中服務的 id 集合，算出每位設計師的服務數。
export function countActiveServicesByDesigner(
  rows: DesignerServiceRow[],
  activeServiceIds: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!activeServiceIds.has(row.service_id)) continue;
    counts.set(row.designer_id, (counts.get(row.designer_id) ?? 0) + 1);
  }
  return counts;
}

export async function listDesigners(supabase: SupabaseClient): Promise<Result<DesignerListData>> {
  const [designersRes, designerServicesRes, servicesRes] = await Promise.all([
    supabase
      .from("designers")
      .select("id, name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("designer_services").select("designer_id, service_id"),
    supabase.from("services").select("id").eq("is_active", true),
  ]);

  if (designersRes.error || designerServicesRes.error || servicesRes.error) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  const activeServiceIds = new Set((servicesRes.data ?? []).map((service) => service.id as string));
  const counts = countActiveServicesByDesigner((designerServicesRes.data ?? []) as DesignerServiceRow[], activeServiceIds);

  const designers = ((designersRes.data ?? []) as Designer[]).map((designer) => ({
    ...designer,
    service_count: counts.get(designer.id) ?? 0,
  }));

  return { ok: true, data: { designers, totalServices: activeServiceIds.size } };
}
