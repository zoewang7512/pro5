// 整合測試共用的設計師 fixture（TASK-068）。
//
// 為什麼需要：0018 讓 `appointments.designer_id` 變成 not null，也讓 `get_available_slots`／
// `create_appointment` 依設計師計算——新建立的 `__TEST__` 服務如果沒有任何設計師開啟，時段會變成空陣列、
// 建立預約會回 SLOT_CONFLICT，直接 insert `appointments` 則缺 `designer_id` 而被拒絕。所以每個測試套件
// 在建立 `__TEST__` 服務之後，各自建立一位專屬的 `__TEST__` 設計師並對這些服務開啟。
//
// 單一資料庫資料隔離規則（見 TASK-067 任務卡架構筆記 A）：
//   1. 測試設計師只能對 `__TEST__` 服務開啟——linkTestDesigner 會先查服務名稱，不是 `__TEST__` 開頭
//      就直接 throw，不可能不小心把真實服務開給測試設計師（那會讓真實顧客的預約被指派到測試設計師）。
//   2. 不碰「預設設計師」（唯一的真實設計師）的服務開關、請假與停用狀態。
//   3. cleanupTestDesigners 用 service_role 先刪該設計師的預約再刪設計師（appointments.designer_id 沒有
//      cascade，設計師只會停用不會刪；只有測試清理用 service_role 才能刪）。清除失敗要 throw。
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TestDesigner = { id: string; name: string };

// 設計師名稱上限 30 字：`__TEST__fx-` 11 字＋tag（建議 ≤ 8 字）＋`-`＋8 字亂數。
// 前綴刻意與 tests/designers.integration.test.ts 的 `__TEST__dz-` 不同，兩邊的殘留掃除互不誤刪。
export const TEST_DESIGNER_NAME_PREFIX = "__TEST__fx-";

// 前次被中斷（例如 beforeAll 逾時、行程被強制結束）而殘留的同 tag 測試設計師：超過 1 小時的一律清掉。
// 殘留的測試設計師是啟用中的，會出現在後台列表與前台的公開讀取；沒開任何真實服務所以不會被指派到真實預約，
// 但仍然是髒資料。只清名稱以 `__TEST__fx-<tag>-` 開頭、且建立超過 1 小時的，不會動到其他套件正在跑的 fixture。
async function sweepStaleTestDesigners(serviceRoleClient: SupabaseClient, tag: string): Promise<void> {
  const prefix = `${TEST_DESIGNER_NAME_PREFIX}${tag}-`;
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await serviceRoleClient
    .from("designers")
    .select("id, name")
    .like("name", `${prefix}%`)
    .lt("created_at", cutoff);
  if (error) throw error;
  // like 的 _ 是萬用字元，這裡再用 startsWith 精確過濾一次。
  const stale = (data ?? []).filter((d) => (d.name as string).startsWith(prefix)).map((d) => d.id as string);
  await cleanupTestDesigners(serviceRoleClient, stale);
}

export async function createTestDesigner(
  serviceRoleClient: SupabaseClient,
  options: { tag: string; serviceIds?: string[]; sortOrder?: number; isActive?: boolean },
): Promise<TestDesigner> {
  await sweepStaleTestDesigners(serviceRoleClient, options.tag);

  const name = `${TEST_DESIGNER_NAME_PREFIX}${options.tag}-${randomUUID().slice(0, 8)}`;
  if (name.length > 30) {
    throw new Error(`[designer-fixture] 設計師名稱超過 30 字：${name}，請縮短 tag`);
  }

  const { data, error } = await serviceRoleClient
    .from("designers")
    .insert({ name, sort_order: options.sortOrder ?? 0, is_active: options.isActive ?? true })
    .select("id")
    .single();
  if (error) throw error;

  const designer = { id: data.id as string, name };
  if (options.serviceIds && options.serviceIds.length > 0) {
    await linkTestDesigner(serviceRoleClient, designer.id, options.serviceIds);
  }
  return designer;
}

// 對 `__TEST__` 服務開啟。服務名稱不是 `__TEST__` 開頭就 throw（隔離規則 1）。
export async function linkTestDesigner(
  serviceRoleClient: SupabaseClient,
  designerId: string,
  serviceIds: string[],
): Promise<void> {
  const { data: services, error: servicesError } = await serviceRoleClient
    .from("services")
    .select("id, name")
    .in("id", serviceIds);
  if (servicesError) throw servicesError;

  const found = new Set((services ?? []).map((s) => s.id as string));
  const missing = serviceIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`[designer-fixture] 找不到服務：${missing.join(", ")}`);
  }
  const real = (services ?? []).filter((s) => !(s.name as string).startsWith("__TEST__"));
  if (real.length > 0) {
    throw new Error(`[designer-fixture] 拒絕把測試設計師對非 __TEST__ 服務開啟：${real.map((s) => s.name).join(", ")}`);
  }

  const { error } = await serviceRoleClient.from("designer_services").upsert(
    serviceIds.map((serviceId) => ({ designer_id: designerId, service_id: serviceId })),
    {
      onConflict: "designer_id,service_id",
      ignoreDuplicates: true,
    },
  );
  if (error) throw error;
}

// 先刪預約再刪設計師（cascade 帶走 designer_services／designer_leaves／designer_portfolio_images）。
// 呼叫端應該在刪除 services 之前或之後都可以，但要在刪除該套件自己建立的預約之後或同時呼叫。
export async function cleanupTestDesigners(serviceRoleClient: SupabaseClient, designerIds: string[]): Promise<void> {
  if (designerIds.length === 0) return;

  // 防護：這個函式會用 service_role 刪除該設計師底下的全部預約，誤傳了真實設計師（例如預設設計師）的 id 就會
  // 清掉真實預約。名稱不是 `__TEST__fx-`／`__TEST__dz-` 開頭一律拒絕。
  const { data: toDelete, error: namesError } = await serviceRoleClient
    .from("designers")
    .select("id, name")
    .in("id", designerIds);
  if (namesError) throw namesError;
  const notTest = (toDelete ?? []).filter(
    (d) => !(d.name as string).startsWith(TEST_DESIGNER_NAME_PREFIX) && !(d.name as string).startsWith("__TEST__dz-"),
  );
  if (notTest.length > 0) {
    throw new Error(`[designer-fixture] 拒絕清除非測試設計師：${notTest.map((d) => d.name).join(", ")}`);
  }

  const { error: appointmentsError } = await serviceRoleClient
    .from("appointments")
    .delete()
    .in("designer_id", designerIds);
  if (appointmentsError) throw appointmentsError;

  const { error: designersError } = await serviceRoleClient.from("designers").delete().in("id", designerIds);
  if (designersError) throw designersError;

  const { data: remaining, error: verifyError } = await serviceRoleClient
    .from("designers")
    .select("id")
    .in("id", designerIds);
  if (verifyError) throw verifyError;
  if ((remaining ?? []).length > 0) {
    throw new Error(`[designer-fixture] 仍有 ${remaining!.length} 位測試設計師沒被刪除`);
  }
}
