import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDesignerId,
  normalizeDesignerBio,
  normalizeInstagramHandle,
  normalizeSpecialties,
  portfolioLimitMessage,
  resolveDesignerAssetUrl,
  type Designer,
} from "@/lib/designers";
import type { Result } from "./appointments";
import {
  buildDesignerActiveEvent,
  buildDesignerCreatedEvent,
  buildDesignerLeaveEvent,
  buildDesignerServiceEvent,
  buildDesignerUpdatedEvent,
  lookupName,
  readAuditValue,
  recordAdminAction,
} from "./audit-log";
import type { BusinessHoursRow } from "./business-hours";
import { addDays, getTaipeiToday, getWeekday } from "./week-range";
import { IMAGE_MAX_BYTES, PORTFOLIO_OUTPUT_MAX_DIMENSION, extensionForImageMime, reencodeImage } from "./image-reencode";

// 設計師管理頁的資料存取，只給後台用（前台共用的型別與驗證在 lib/designers.ts）。TASK-067 建立讀取，
// TASK-069 新增基本資料的寫入，TASK-070 新增設計師服務的開關，TASK-071 新增作品集，TASK-072 新增請假日。與前台不同：這裡不過濾
// is_active，後台需要同時看到啟用中與停用中的設計師（RLS 對 is_admin() 放行全部）。
//
// 寫入一律走 supabase-js 直接操作資料表：RLS 的 is_admin()（要求 aal2）加欄位層級 GRANT 是權限邊界
// （0017），送出的欄位必須是被授權欄位的子集——不展開 Designer、不帶 id／created_at／updated_at、
// 不用 upsert，否則整筆寫入會 42501。錯誤訊息一律通用，不顯示也不 log error.message／details
// （23514 的 details 會帶出整列內容與 constraint 名稱，Storage 錯誤會帶出路徑）。

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

// 這位設計師開啟的服務 id（含下架中的服務，designer_services 的列在服務下架時保留）。畫面要和上架中的服務
// 取交集再顯示或計數，口徑與 listDesigners 的 service_count 一致。
export async function listDesignerServiceIds(supabase: SupabaseClient, designerId: string): Promise<Result<string[]>> {
  if (!isDesignerId(designerId)) return { ok: false, error: INTERNAL_ERROR };
  try {
    const { data, error } = await supabase.from("designer_services").select("service_id").eq("designer_id", designerId);
    if (error || !data) return { ok: false, error: INTERNAL_ERROR };
    return { ok: true, data: (data as Array<{ service_id: string }>).map((row) => row.service_id) };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 開關一項服務：enabled＝insert 一列、否則 delete 一列。authenticated 對這張表沒有 update 權限，所以不能用
// upsert。冪等只限 insert：重複開啟時主鍵衝突（23505）視為成功——RLS 的 WITH CHECK 先於唯一性檢查，
// 看得到 23505 的一定是通過 is_admin() 的人，只比對 code，不看 message／details。
// delete 一定要同時帶兩個 eq（欄位名稱寫死）：少一個條件會刪掉整批服務對照，前台立刻沒有時段。被 RLS 擋下的
// delete 不會報錯、只回 0 列，所以用 .select 確認剛好刪掉 1 列；0 列（別的分頁已關閉，或權限不足）一律回失敗，
// 由呼叫端重讀資料庫為準。
export async function setDesignerService(
  supabase: SupabaseClient,
  designerId: string,
  serviceId: string,
  enabled: boolean,
): Promise<Result<void>> {
  if (!isDesignerId(designerId) || !isDesignerId(serviceId)) return { ok: false, error: INTERNAL_ERROR };

  try {
    if (enabled) {
      const { error } = await supabase.from("designer_services").insert({ designer_id: designerId, service_id: serviceId });
      if (error && error.code !== "23505") return { ok: false, error: INTERNAL_ERROR };
      // 23505＝本來就已開啟（冪等），沒有實際變動，不記錄。
      if (!error) await recordDesignerServiceChange(supabase, designerId, serviceId, true);
      return { ok: true, data: undefined };
    }

    const { data, error } = await supabase
      .from("designer_services")
      .delete()
      .eq("designer_id", designerId)
      .eq("service_id", serviceId)
      .select("service_id");
    if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };
    await recordDesignerServiceChange(supabase, designerId, serviceId, false);
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 稽核紀錄：寫入成功後才查設計師與服務名稱（查不到就只記編號，不阻擋原操作）。
async function recordDesignerServiceChange(
  supabase: SupabaseClient,
  designerId: string,
  serviceId: string,
  enabled: boolean,
): Promise<void> {
  const [designerName, serviceName] = await Promise.all([
    lookupName(supabase, "designers", designerId),
    lookupName(supabase, "services", serviceId),
  ]);
  await recordAdminAction(supabase, buildDesignerServiceEvent({ designerId, serviceId, designerName, serviceName, enabled }));
}

const DESIGNER_COLUMNS = "id, name, bio, specialties, instagram_handle, avatar_url, is_active, sort_order";

// 回傳 ok(null) 代表查不到（id 格式錯誤、不存在），和讀取失敗分開，讓畫面顯示「找不到這位設計師」。
export async function getDesigner(supabase: SupabaseClient, id: string): Promise<Result<Designer | null>> {
  if (!isDesignerId(id)) return { ok: true, data: null };

  const { data, error } = await supabase.from("designers").select(DESIGNER_COLUMNS).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: INTERNAL_ERROR };
  return { ok: true, data: (data as Designer | null) ?? null };
}

// 表單原始輸入（字串／陣列），送出前由 toBasicInfoPayload 清理。
export type DesignerBasicInfoInput = {
  name: string;
  instagram: string;
  specialties: string[];
  bio: string;
};

export type DesignerBasicInfoPayload = {
  name: string;
  bio: string | null;
  specialties: string[];
  instagram_handle: string | null;
};

// 唯一允許寫進 designers 的基本資料欄位（對齊 0017 的欄位層級 GRANT）。頭像不在這裡：頭像上傳是立即生效、
// 走自己的函式，避免儲存表單時把剛上傳的頭像覆蓋回舊值。名稱／專長送出前 trim＋NFC（資料庫 btrim 只去空白，
// JS trim 還會去 Tab 與換行）。
export function toBasicInfoPayload(input: DesignerBasicInfoInput): DesignerBasicInfoPayload {
  return {
    name: input.name.trim().normalize("NFC"),
    bio: normalizeDesignerBio(input.bio),
    specialties: normalizeSpecialties(input.specialties).map((tag) => tag.normalize("NFC")),
    instagram_handle: normalizeInstagramHandle(input.instagram),
  };
}

// 新增設計師：sort_order 取目前最大值＋1（排在最後），預設啟用、不提供任何服務。
export async function createDesigner(
  supabase: SupabaseClient,
  input: DesignerBasicInfoInput,
): Promise<Result<{ id: string }>> {
  const { data: last, error: lastError } = await supabase
    .from("designers")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) return { ok: false, error: INTERNAL_ERROR };
  const nextSortOrder = last && last.length > 0 ? (last[0].sort_order as number) + 1 : 0;

  const payload = toBasicInfoPayload(input);
  const { data, error } = await supabase
    .from("designers")
    .insert({ ...payload, sort_order: nextSortOrder, is_active: true })
    .select("id");
  if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };

  await recordAdminAction(supabase, buildDesignerCreatedEvent(data[0].id as string, payload.name));
  return { ok: true, data: { id: data[0].id as string } };
}

// RLS 擋掉 update 時 PostgREST 回傳成功但 0 筆受影響，用 .select("id") 檢查剛好 1 列
// （比照 lib/store-settings.ts updateStoreSettingsBasicInfo）。
export async function updateDesignerBasicInfo(
  supabase: SupabaseClient,
  id: string,
  input: DesignerBasicInfoInput,
): Promise<Result<void>> {
  // 稽核紀錄：只記名稱變動；寫入前先讀舊名稱（讀不到就只記新名稱，不阻擋原操作）。
  const beforeName = await lookupName(supabase, "designers", id);

  const payload = toBasicInfoPayload(input);
  const { data, error } = await supabase.from("designers").update(payload).eq("id", id).select("id");
  if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };

  await recordAdminAction(supabase, buildDesignerUpdatedEvent(id, beforeName, payload.name));
  return { ok: true, data: undefined };
}

export async function setDesignerActive(supabase: SupabaseClient, id: string, isActive: boolean): Promise<Result<void>> {
  // 稽核紀錄：寫入前讀名稱與目前狀態；狀態本來就相同（沒有實際變動）時不記錄。
  const before = await readAuditValue<{ name?: unknown; is_active?: unknown }>(() =>
    supabase.from("designers").select("name, is_active").eq("id", id).maybeSingle(),
  );

  const { data, error } = await supabase.from("designers").update({ is_active: isActive }).eq("id", id).select("id");
  if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };

  if (before?.is_active !== isActive) {
    await recordAdminAction(
      supabase,
      buildDesignerActiveEvent(id, typeof before?.name === "string" ? before.name : null, isActive),
    );
  }
  return { ok: true, data: undefined };
}

// 停用確認對話框顯示用：這位設計師「未來的有效預約」筆數（pending／confirmed）。只 select id 加 count，
// 不可用 `*`（appointments 是欄位層級授權，access_token 不在內，`*` 會 42501）。
export async function countFutureAppointmentsForDesigner(
  supabase: SupabaseClient,
  designerId: string,
): Promise<Result<number>> {
  const { count, error } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("designer_id", designerId)
    .in("status", ["pending", "confirmed"])
    .gt("start_at", new Date().toISOString());
  if (error || count === null) return { ok: false, error: INTERNAL_ERROR };
  return { ok: true, data: count };
}

export type DesignerOrderEntry = { id: string; sort_order: number };

// 純函式：把「第 index 位往上／下移一格」轉成要寫入的 sort_order 更新清單。
//   - 整份列表沒有重複的 sort_order：只交換相鄰兩列的值（兩次 update）。
//   - 有重複值（例如測試或舊資料都是 0）：單純交換值可能無效或排錯，改成依新順序整份重新編號 0..n-1，
//     只列出值有變的列。
//   - 超出範圍（第一列上移、最後一列下移）：回傳空陣列。
export function planDesignerOrderSwap(
  list: DesignerOrderEntry[],
  index: number,
  direction: "up" | "down",
): DesignerOrderEntry[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [];

  const hasDuplicates = new Set(list.map((entry) => entry.sort_order)).size !== list.length;
  if (!hasDuplicates) {
    return [
      { id: list[index].id, sort_order: list[target].sort_order },
      { id: list[target].id, sort_order: list[index].sort_order },
    ];
  }

  const reordered = [...list];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const updates: DesignerOrderEntry[] = [];
  reordered.forEach((entry, position) => {
    if (entry.sort_order !== position) updates.push({ id: entry.id, sort_order: position });
  });
  return updates;
}

// 依序寫入 planDesignerOrderSwap 的結果，不做樂觀更新：任一次失敗就回傳失敗，呼叫端重新讀取列表。
// 兩次 update 的交換分支，第二次失敗時盡力把第一列改回原值；整份重新編號的分支寫入超過兩次，不做補償
// （最壞情況是幾列同值，排序退回依 created_at，不會壞資料）。
export async function swapDesignerOrder(
  supabase: SupabaseClient,
  list: DesignerOrderEntry[],
  index: number,
  direction: "up" | "down",
): Promise<Result<void>> {
  const updates = planDesignerOrderSwap(list, index, direction);
  if (updates.length === 0) return { ok: true, data: undefined };

  const originals = new Map(list.map((entry) => [entry.id, entry.sort_order]));
  const applied: DesignerOrderEntry[] = [];

  for (const update of updates) {
    const { data, error } = await supabase
      .from("designers")
      .update({ sort_order: update.sort_order })
      .eq("id", update.id)
      .select("id");
    if (error || !data || data.length !== 1) {
      if (updates.length === 2) {
        for (const done of applied) {
          await supabase
            .from("designers")
            .update({ sort_order: originals.get(done.id) })
            .eq("id", done.id)
            .select("id");
        }
      }
      return { ok: false, error: INTERNAL_ERROR };
    }
    applied.push(update);
  }
  return { ok: true, data: undefined };
}

// 頭像檔案前置驗證（體驗優化）：對齊 designer-assets bucket 的 5MB 與 jpg／png／webp。真正上傳的是
// reencodeImage 重新編碼後的 blob，bucket 與 Storage policy 是伺服器端最終防線。
export function validateDesignerImageFile(file: File): string | null {
  if (extensionForImageMime(file.type) === null) return "檔案格式需為 JPG／PNG／WebP";
  if (file.size > IMAGE_MAX_BYTES) return "檔案大小需小於 5MB";
  return null;
}

const STORAGE_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LOWERCASE_ID_PATTERN = new RegExp(`^${STORAGE_UUID}$`);

// 由頭像網址解析出 designer-assets 內的物件路徑，只有確定是「這位設計師自己的頭像」才回傳，否則回傳 null
// 呼叫端就不刪檔。avatar_url 可被 admin 直接 PATCH 成任意字串，所以：先過白名單（origin＋pathname 前綴、
// 擋帳密與編碼斜線），要求沒有 query／hash，再對未解碼的 pathname 用完整錨定的正規式比對，並用擷取群組重新
// 組出路徑。designerId 必須是資料庫回傳的小寫 uuid（Storage policy 也只接受小寫）。
export function parseDesignerAvatarPath(url: string | null, designerId: string): string | null {
  if (!LOWERCASE_ID_PATTERN.test(designerId)) return null;
  const resolved = resolveDesignerAssetUrl(url);
  if (!resolved) return null;

  const parsed = new URL(resolved);
  if (parsed.search !== "" || parsed.hash !== "") return null;

  const pattern = new RegExp(
    `^/storage/v1/object/public/designer-assets/avatar/${designerId}/(${STORAGE_UUID})\\.(jpg|png|webp)$`,
  );
  const match = pattern.exec(parsed.pathname);
  if (!match) return null;
  return `avatar/${designerId}/${match[1]}.${match[2]}`;
}

const MESSAGE_CONFLICT = "頭像已被其他操作變更，請重新整理頁面後再試。";

async function readAvatarUrl(supabase: SupabaseClient, designerId: string): Promise<Result<string | null>> {
  const { data, error } = await supabase
    .from("designers")
    .select("avatar_url")
    .eq("id", designerId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: INTERNAL_ERROR };
  return { ok: true, data: (data as { avatar_url: string | null }).avatar_url };
}

// compare-and-swap：只有資料庫現值等於 expected 才寫入，避免兩個分頁／過期狀態互相覆蓋後刪錯檔。
// 回傳 "applied"（1 列）、"conflict"（0 列，資料已被別處改過）、"unknown"（錯誤或例外，結果不明）。
async function swapAvatarUrl(
  supabase: SupabaseClient,
  designerId: string,
  expected: string | null,
  next: string | null,
): Promise<"applied" | "conflict" | "unknown"> {
  try {
    const base = supabase.from("designers").update({ avatar_url: next }).eq("id", designerId);
    const guarded = expected === null ? base.is("avatar_url", null) : base.eq("avatar_url", expected);
    const { data, error } = await guarded.select("id");
    if (error || !data) return "unknown";
    return data.length === 1 ? "applied" : "conflict";
  } catch {
    return "unknown";
  }
}

// 刪除 Storage 物件並確認剛好刪掉 1 個（Supabase remove() 缺 select 權限時不報錯、只回空陣列）。
async function removeDesignerAssetObject(supabase: SupabaseClient, path: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from("designer-assets").remove([path]);
    return !error && Array.isArray(data) && data.length === 1;
  } catch {
    return false;
  }
}

export type AvatarChange = {
  // 舊檔未能清除（解析不出安全路徑、或 remove() 沒刪到恰好 1 個）：資料列已更新成功，只是留下孤兒檔。
  cleanupWarning: boolean;
};

// 回傳是否需要警告：沒有舊檔不需警告；有舊檔但解析不出安全路徑，或刪除沒成功，都要警告。
async function cleanupOldAvatar(
  supabase: SupabaseClient,
  designerId: string,
  oldUrl: string | null,
): Promise<boolean> {
  if (oldUrl === null) return false;
  const oldPath = parseDesignerAvatarPath(oldUrl, designerId);
  if (oldPath === null) return true;
  return !(await removeDesignerAssetObject(supabase, oldPath));
}

// 上傳新頭像：重新編碼 → 上傳新檔 → CAS 更新資料列 → 刪舊檔。Storage 沒有 update policy，更換＝新檔＋刪舊檔。
// 多步驟邏輯放在這裡（不在元件），元件卸載也不會中斷。舊值從資料庫讀，不信任前端傳入的值。
export async function uploadDesignerAvatar(
  supabase: SupabaseClient,
  designerId: string,
  file: File,
): Promise<Result<AvatarChange & { url: string }>> {
  if (!LOWERCASE_ID_PATTERN.test(designerId)) return { ok: false, error: INTERNAL_ERROR };

  const validationError = validateDesignerImageFile(file);
  if (validationError) return { ok: false, error: { message: validationError } };

  const encoded = await reencodeImage(file);
  if (!encoded.ok) return { ok: false, error: { message: encoded.message } };

  const current = await readAvatarUrl(supabase, designerId);
  if (!current.ok) return current;
  const oldUrl = current.data;

  const path = `avatar/${designerId}/${crypto.randomUUID()}.${encoded.extension}`;
  const { error: uploadError } = await supabase.storage
    .from("designer-assets")
    .upload(path, encoded.blob, { contentType: encoded.blob.type, upsert: false });
  if (uploadError) return { ok: false, error: INTERNAL_ERROR };

  const newUrl = supabase.storage.from("designer-assets").getPublicUrl(path).data.publicUrl;
  const outcome = await swapAvatarUrl(supabase, designerId, oldUrl, newUrl);

  if (outcome === "applied") {
    return { ok: true, data: { url: newUrl, cleanupWarning: await cleanupOldAvatar(supabase, designerId, oldUrl) } };
  }

  // 結果不明（逾時等）時伺服器可能其實已寫入：先重讀，資料列指向新檔就視為成功，絕不補刪正在使用的檔案；
  // 重讀也失敗就不補刪（寧可留下孤兒檔）。
  if (outcome === "unknown") {
    const reread = await readAvatarUrl(supabase, designerId);
    if (!reread.ok) return { ok: false, error: INTERNAL_ERROR };
    if (reread.data === newUrl) {
      return { ok: true, data: { url: newUrl, cleanupWarning: await cleanupOldAvatar(supabase, designerId, oldUrl) } };
    }
  }

  // 確定沒寫入：補刪剛上傳的新檔（失敗時留下孤兒檔，列入已知限制）。
  await removeDesignerAssetObject(supabase, path);
  return { ok: false, error: outcome === "conflict" ? { message: MESSAGE_CONFLICT } : INTERNAL_ERROR };
}

// 移除頭像：先 CAS 把資料列改成 null，成功後才刪檔，絕不先刪檔（刪檔成功但資料列沒改，前台會破圖）。
export async function removeDesignerAvatar(
  supabase: SupabaseClient,
  designerId: string,
): Promise<Result<AvatarChange>> {
  if (!LOWERCASE_ID_PATTERN.test(designerId)) return { ok: false, error: INTERNAL_ERROR };

  const current = await readAvatarUrl(supabase, designerId);
  if (!current.ok) return current;
  const oldUrl = current.data;
  if (oldUrl === null) return { ok: true, data: { cleanupWarning: false } };

  const outcome = await swapAvatarUrl(supabase, designerId, oldUrl, null);
  if (outcome === "conflict") return { ok: false, error: { message: MESSAGE_CONFLICT } };
  if (outcome === "unknown") {
    const reread = await readAvatarUrl(supabase, designerId);
    if (!reread.ok || reread.data !== null) return { ok: false, error: INTERNAL_ERROR };
  }
  return { ok: true, data: { cleanupWarning: await cleanupOldAvatar(supabase, designerId, oldUrl) } };
}

// ---------------------------------------------------------------------------------------------
// 作品集（TASK-071）。流程比照頭像：先上傳 Storage、成功後才寫資料列；刪除先刪資料列、成功後才刪檔，
// 絕不先刪檔。判定「結果不明」不能看 error 有沒有 code：中斷的請求 code 可能是 "20"（AbortError）或 ""，
// 閘道 5xx 則沒有 code——只有 PORTFOLIO_LIMIT 與 5 碼 SQLSTATE 才算確定沒寫入，其餘一律重讀資料庫，
// 重讀失敗就不動任何檔案（寧可留下孤兒檔，也不刪掉正在使用的圖）。
// ---------------------------------------------------------------------------------------------

export type PortfolioImage = { id: string; image_url: string; created_at: string };

// storage_path 刻意不選也不放進型別：刪除時一律從資料庫重讀，不給畫面層任何誘因去相信前端傳回來的路徑。
const PORTFOLIO_COLUMNS = "id, image_url, created_at";
const PORTFOLIO_CACHE_CONTROL = "300";
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const MESSAGE_PORTFOLIO_GONE = "這張作品已不存在，請重新整理頁面。";

// 只有「這位設計師自己的作品集路徑」才回傳，否則 null（呼叫端就不刪檔）。designerId 必須是小寫 uuid。
export function parsePortfolioStoragePath(path: string | null, designerId: string): string | null {
  if (path === null || !LOWERCASE_ID_PATTERN.test(designerId)) return null;
  const match = new RegExp(`^portfolio/${designerId}/(${STORAGE_UUID})\\.(jpg|png|webp)$`).exec(path);
  return match ? `portfolio/${designerId}/${match[1]}.${match[2]}` : null;
}

// 最新在前（created_at desc, id desc）；TASK-073／074 的前台用同一個排序，前後台看到的「最新」才一致。
export async function listPortfolio(supabase: SupabaseClient, designerId: string): Promise<Result<PortfolioImage[]>> {
  if (!LOWERCASE_ID_PATTERN.test(designerId)) return { ok: false, error: INTERNAL_ERROR };
  try {
    const { data, error } = await supabase
      .from("designer_portfolio_images")
      .select(PORTFOLIO_COLUMNS)
      .eq("designer_id", designerId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error || !data) return { ok: false, error: INTERNAL_ERROR };
    return { ok: true, data: data as PortfolioImage[] };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

async function readPortfolioRowByPath(
  supabase: SupabaseClient,
  designerId: string,
  path: string,
): Promise<Result<PortfolioImage | null>> {
  try {
    const { data, error } = await supabase
      .from("designer_portfolio_images")
      .select(PORTFOLIO_COLUMNS)
      .eq("designer_id", designerId)
      .eq("storage_path", path)
      .maybeSingle();
    if (error) return { ok: false, error: INTERNAL_ERROR };
    return { ok: true, data: (data as PortfolioImage | null) ?? null };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 上傳一張作品：驗證 → 重新編碼（webp、去 EXIF、長邊 1600）→ 上傳 → insert 一列。第 13 張由資料庫 trigger
// 擋下（P0001＋PORTFOLIO_LIMIT 前綴），前端的張數判斷只是體驗優化。
export async function uploadPortfolioImage(
  supabase: SupabaseClient,
  designerId: string,
  file: File,
): Promise<Result<PortfolioImage>> {
  if (!LOWERCASE_ID_PATTERN.test(designerId)) return { ok: false, error: INTERNAL_ERROR };

  const validationError = validateDesignerImageFile(file);
  if (validationError) return { ok: false, error: { message: validationError } };

  const encoded = await reencodeImage(file, { maxDimension: PORTFOLIO_OUTPUT_MAX_DIMENSION });
  if (!encoded.ok) return { ok: false, error: { message: encoded.message } };

  // 路徑由程式產生（小寫 designerId＋新的 uuid＋依實際 blob.type 決定的副檔名），不用使用者檔名；
  // 這個路徑只屬於這次呼叫，所以下面「確定沒寫入」時補刪它不會誤刪別人的檔案。
  const path = `portfolio/${designerId}/${crypto.randomUUID()}.${encoded.extension}`;
  try {
    const { error: uploadError } = await supabase.storage
      .from("designer-assets")
      .upload(path, encoded.blob, { contentType: encoded.blob.type, upsert: false, cacheControl: PORTFOLIO_CACHE_CONTROL });
    if (uploadError) {
      // 網路錯誤時物件可能其實已經寫入，順手清掉（路徑是新的，不會誤刪）。
      await removeDesignerAssetObject(supabase, path);
      return { ok: false, error: INTERNAL_ERROR };
    }
  } catch {
    await removeDesignerAssetObject(supabase, path);
    return { ok: false, error: INTERNAL_ERROR };
  }

  const imageUrl = supabase.storage.from("designer-assets").getPublicUrl(path).data.publicUrl;

  try {
    const { data, error } = await supabase
      .from("designer_portfolio_images")
      .insert({ designer_id: designerId, image_url: imageUrl, storage_path: path })
      .select(PORTFOLIO_COLUMNS);
    if (!error && data && data.length === 1) return { ok: true, data: data[0] as PortfolioImage };

    if (error && error.code === "P0001" && (error.message ?? "").startsWith("PORTFOLIO_LIMIT")) {
      await removeDesignerAssetObject(supabase, path);
      return { ok: false, error: { message: portfolioLimitMessage() } };
    }
    if (error && SQLSTATE_PATTERN.test(error.code ?? "")) {
      await removeDesignerAssetObject(supabase, path);
      return { ok: false, error: INTERNAL_ERROR };
    }
  } catch {
    // 結果不明：往下重讀。
  }

  // 結果不明（逾時、網路中斷、閘道錯誤、沒有 error 卻不是剛好 1 列）：伺服器可能其實已經寫入。
  const reread = await readPortfolioRowByPath(supabase, designerId, path);
  if (!reread.ok) return { ok: false, error: INTERNAL_ERROR };
  if (reread.data) return { ok: true, data: reread.data };
  await removeDesignerAssetObject(supabase, path);
  return { ok: false, error: INTERNAL_ERROR };
}

export type PortfolioDeleteOutcome = {
  // 資料列已刪除，但檔案沒能確認刪掉（照片可能仍可由原網址讀到）。
  cleanupWarning: boolean;
  // 可以讓店長按「重試刪除檔案」的路徑；路徑驗證不過時為 null（只能聯絡管理者）。
  retryPath: string | null;
};

// 刪除一張作品：先用 id＋designer_id 讀回 storage_path（不信任前端傳入）→ 刪資料列（要求剛好 1 列）→ 刪檔
// （要求 remove() 剛好刪 1 個）。delete 結果不明時重讀：列已不在就照樣刪檔，列還在就回失敗；0 列（別的分頁
// 已刪，或權限不足）不呼叫 remove。
export async function deletePortfolioImage(
  supabase: SupabaseClient,
  designerId: string,
  imageId: string,
): Promise<Result<PortfolioDeleteOutcome>> {
  if (!LOWERCASE_ID_PATTERN.test(designerId) || !LOWERCASE_ID_PATTERN.test(imageId)) {
    return { ok: false, error: INTERNAL_ERROR };
  }

  let storagePath: string | null;
  try {
    const { data, error } = await supabase
      .from("designer_portfolio_images")
      .select("storage_path")
      .eq("id", imageId)
      .eq("designer_id", designerId)
      .maybeSingle();
    if (error) return { ok: false, error: INTERNAL_ERROR };
    if (!data) return { ok: false, error: { message: MESSAGE_PORTFOLIO_GONE } };
    storagePath = parsePortfolioStoragePath((data as { storage_path: string }).storage_path, designerId);
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }

  let unknown = false;
  try {
    const { data, error } = await supabase
      .from("designer_portfolio_images")
      .delete()
      .eq("id", imageId)
      .eq("designer_id", designerId)
      .select("id");
    if (!error && data && data.length === 0) return { ok: false, error: INTERNAL_ERROR };
    if (error || !data || data.length !== 1) unknown = true;
  } catch {
    unknown = true;
  }

  if (unknown) {
    try {
      const { data, error } = await supabase
        .from("designer_portfolio_images")
        .select("id")
        .eq("id", imageId)
        .eq("designer_id", designerId)
        .maybeSingle();
      // 讀不到結果，或列還在（沒刪成功）：回失敗，不動檔案。
      if (error || data) return { ok: false, error: INTERNAL_ERROR };
    } catch {
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  if (storagePath === null) return { ok: true, data: { cleanupWarning: true, retryPath: null } };
  const removed = await removeDesignerAssetObject(supabase, storagePath);
  return { ok: true, data: { cleanupWarning: !removed, retryPath: removed ? null : storagePath } };
}

// 「重試刪除檔案」：路徑重新過一次白名單，只能刪這位設計師自己的作品集檔案。
export async function removePortfolioFile(
  supabase: SupabaseClient,
  designerId: string,
  path: string,
): Promise<Result<void>> {
  const safePath = parsePortfolioStoragePath(path, designerId);
  if (safePath === null) return { ok: false, error: INTERNAL_ERROR };
  return (await removeDesignerAssetObject(supabase, safePath))
    ? { ok: true, data: undefined }
    : { ok: false, error: INTERNAL_ERROR };
}

// ---------------------------------------------------------------------------------------------
// 請假日（TASK-072）。designer_leaves 的 authenticated 只有 select／insert／delete（沒有 update），所以不能
// upsert：新增＝insert（主鍵衝突 23505 視為成功）、移除＝delete。日期欄位型別是 Postgres date，會接受
// `today`、`infinity` 這類字串，所以送出前一律先過嚴格的 YYYY-MM-DD 真實日期檢查，不通過就不送請求。
// ---------------------------------------------------------------------------------------------

const LEAVE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isRealDate(date: string): boolean {
  if (!LEAVE_DATE_PATTERN.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

// 後台顯示全部（含過去）的請假日，由畫面自行篩出「今天以後」；月曆往前翻月時過去的請假日仍顯示為已標記。
export async function listDesignerLeaves(supabase: SupabaseClient, designerId: string): Promise<Result<string[]>> {
  if (!isDesignerId(designerId)) return { ok: false, error: INTERNAL_ERROR };
  try {
    const { data, error } = await supabase
      .from("designer_leaves")
      .select("date")
      .eq("designer_id", designerId)
      .order("date", { ascending: true });
    if (error || !data) return { ok: false, error: INTERNAL_ERROR };
    return { ok: true, data: (data as Array<{ date: string }>).map((row) => row.date) };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 預約週曆的設計師篩選列（TASK-075）：只讀篩選需要的最小欄位（不帶 bio、IG），不過濾 is_active——停用中但本週
// 還有預約的設計師也要能被篩選出來，是否出現由 buildDesignerChips 決定。
export type DesignerFilterOption = {
  id: string;
  name: string;
  avatar_url: string | null;
  is_active: boolean;
  sort_order: number;
};

const FILTER_OPTION_COLUMNS = "id, name, avatar_url, is_active, sort_order";

export async function getDesignerFilterOptions(supabase: SupabaseClient): Promise<Result<DesignerFilterOption[]>> {
  try {
    const { data, error } = await supabase
      .from("designers")
      .select(FILTER_OPTION_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return { ok: false, error: INTERNAL_ERROR };
    return { ok: true, data: data as DesignerFilterOption[] };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

export type DesignerLeaveEntry = { designer_id: string; date: string };

// 週曆標示用：依日期範圍讀全部設計師的請假日，由畫面依勾選的設計師過濾（不用 .in() 傳 id 清單）。
// 日期先過嚴格檢查（Postgres date 會接受 `today`、`infinity`），不通過不送請求。
export async function getDesignerLeavesInRange(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<Result<DesignerLeaveEntry[]>> {
  if (!isRealDate(startDate) || !isRealDate(endDate)) return { ok: false, error: INTERNAL_ERROR };
  try {
    const { data, error } = await supabase
      .from("designer_leaves")
      .select("designer_id, date")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });
    if (error || !data) return { ok: false, error: INTERNAL_ERROR };
    return { ok: true, data: data as DesignerLeaveEntry[] };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 只接受今天（台北）以後的日期（資料庫沒有這道 check，函式層擋）。冪等只限主鍵衝突：RLS 的 WITH CHECK 先於唯一性
// 檢查，看得到 23505 的一定是通過 is_admin() 的人；其餘錯誤碼（23503 外鍵、42501 RLS）一律失敗，只比對 code。
export async function addDesignerLeave(
  supabase: SupabaseClient,
  designerId: string,
  date: string,
): Promise<Result<void>> {
  if (!isDesignerId(designerId) || !isRealDate(date) || date < getTaipeiToday()) {
    return { ok: false, error: INTERNAL_ERROR };
  }
  try {
    const { error } = await supabase.from("designer_leaves").insert({ designer_id: designerId, date });
    if (error && error.code !== "23505") return { ok: false, error: INTERNAL_ERROR };
    // 23505＝本來就已請假（冪等），沒有實際變動，不記錄。
    if (!error) {
      const designerName = await lookupName(supabase, "designers", designerId);
      await recordAdminAction(supabase, buildDesignerLeaveEvent({ designerId, designerName, date, added: true }));
    }
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// delete 一定要同時帶兩個 eq（欄位名稱寫死）：少一個條件會刪掉這位設計師全部的請假日。被 RLS 擋下的 delete 不會
// 報錯、只回 0 列，所以用 .select 確認剛好刪掉 1 列；0 列（別的分頁已移除，或權限不足）一律回失敗，由呼叫端重讀。
export async function removeDesignerLeave(
  supabase: SupabaseClient,
  designerId: string,
  date: string,
): Promise<Result<void>> {
  if (!isDesignerId(designerId) || !isRealDate(date)) return { ok: false, error: INTERNAL_ERROR };
  try {
    const { data, error } = await supabase
      .from("designer_leaves")
      .delete()
      .eq("designer_id", designerId)
      .eq("date", date)
      .select("date");
    if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };

    const designerName = await lookupName(supabase, "designers", designerId);
    await recordAdminAction(supabase, buildDesignerLeaveEvent({ designerId, designerName, date, added: false }));
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

export type LeaveAffectedAppointment = {
  id: string;
  customer_name: string;
  start_at: string;
  service_name: string;
};

// 明確欄位，不用 `*`（appointments 是欄位層級授權，也不要把電話、email、access_token 下載到瀏覽器）。
const LEAVE_AFFECTED_COLUMNS = "id, customer_name, start_at, services(name)";
const LEAVE_AFFECTED_LIMIT = 200;

type RawLeaveAffectedRow = {
  id: string;
  customer_name: string;
  start_at: string;
  services: { name: string } | Array<{ name: string }> | null;
};

// 這位設計師在該日（台北時間）的 pending／confirmed 預約。刻意與 findAffectedAppointmentsForClosedDate 不同的兩點：
// 不加 start_at > now、不含 completed——請假擋掉整天，當天稍早仍是 pending／confirmed 的預約本身就是異常，值得提醒。
export async function findAffectedAppointmentsForDesignerLeave(
  supabase: SupabaseClient,
  designerId: string,
  date: string,
): Promise<Result<LeaveAffectedAppointment[]>> {
  if (!isDesignerId(designerId) || !isRealDate(date)) return { ok: false, error: INTERNAL_ERROR };
  try {
    const { data, error } = await supabase
      .from("appointments")
      .select(LEAVE_AFFECTED_COLUMNS)
      .eq("designer_id", designerId)
      .in("status", ["pending", "confirmed"])
      .gte("start_at", `${date}T00:00:00+08:00`)
      .lt("start_at", `${addDays(date, 1)}T00:00:00+08:00`)
      .order("start_at", { ascending: true })
      .limit(LEAVE_AFFECTED_LIMIT);
    if (error || !data) return { ok: false, error: INTERNAL_ERROR };
    return {
      ok: true,
      data: (data as unknown as RawLeaveAffectedRow[]).map((row) => {
        const service = Array.isArray(row.services) ? row.services[0] : row.services;
        return { id: row.id, customer_name: row.customer_name, start_at: row.start_at, service_name: service?.name ?? "" };
      }),
    };
  } catch {
    return { ok: false, error: INTERNAL_ERROR };
  }
}

// 全店公休（對所有設計師都生效，和個人請假疊加）：closed_dates 內的日期，或該週幾查不到營業時間列、標記公休、
// 缺開／關店時間（判斷對齊 get_available_slots 與 isAppointmentOutsideHours）。TASK-075 若也需要可搬去共用。
export function isShopClosedDate(date: string, businessHours: BusinessHoursRow[], closedDates: Set<string>): boolean {
  if (closedDates.has(date)) return true;
  const hours = businessHours.find((row) => row.weekday === getWeekday(date));
  return !hours || hours.is_closed || !hours.open_time || !hours.close_time;
}
