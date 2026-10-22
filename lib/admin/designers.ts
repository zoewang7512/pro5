import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDesignerId,
  normalizeDesignerBio,
  normalizeInstagramHandle,
  normalizeSpecialties,
  resolveDesignerAssetUrl,
  type Designer,
} from "@/lib/designers";
import type { Result } from "./appointments";
import { IMAGE_MAX_BYTES, extensionForImageMime, reencodeImage } from "./image-reencode";

// 設計師管理頁的資料存取，只給後台用（前台共用的型別與驗證在 lib/designers.ts）。TASK-067 建立讀取，
// TASK-069 新增基本資料的寫入（設計師服務、作品集、請假由 TASK-070～072 接續）。與前台不同：這裡不過濾
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

  const { data, error } = await supabase
    .from("designers")
    .insert({ ...toBasicInfoPayload(input), sort_order: nextSortOrder, is_active: true })
    .select("id");
  if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };
  return { ok: true, data: { id: data[0].id as string } };
}

// RLS 擋掉 update 時 PostgREST 回傳成功但 0 筆受影響，用 .select("id") 檢查剛好 1 列
// （比照 lib/store-settings.ts updateStoreSettingsBasicInfo）。
export async function updateDesignerBasicInfo(
  supabase: SupabaseClient,
  id: string,
  input: DesignerBasicInfoInput,
): Promise<Result<void>> {
  const { data, error } = await supabase
    .from("designers")
    .update(toBasicInfoPayload(input))
    .eq("id", id)
    .select("id");
  if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };
  return { ok: true, data: undefined };
}

export async function setDesignerActive(supabase: SupabaseClient, id: string, isActive: boolean): Promise<Result<void>> {
  const { data, error } = await supabase.from("designers").update({ is_active: isActive }).eq("id", id).select("id");
  if (error || !data || data.length !== 1) return { ok: false, error: INTERNAL_ERROR };
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
async function removeAvatarObject(supabase: SupabaseClient, path: string): Promise<boolean> {
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
  return !(await removeAvatarObject(supabase, oldPath));
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
  await removeAvatarObject(supabase, path);
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
