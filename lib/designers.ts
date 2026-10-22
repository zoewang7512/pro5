// 多位設計師的共用型別、公開欄位清單、圖片網址白名單與欄位驗證。前台（TASK-073／074）與後台
// （TASK-067～072）共用，比照 lib/store-settings.ts／lib/booking-policy.ts 放在 lib/ 頂層。
// 欄位驗證對齊 0017_designers.sql 的 check constraint（前端先擋、資料庫是最終防線）。

export const DESIGNER_NAME_MAX_LENGTH = 30;
export const DESIGNER_BIO_MAX_LENGTH = 200;
export const DESIGNER_SPECIALTIES_MAX_COUNT = 5;
export const DESIGNER_SPECIALTY_MAX_LENGTH = 12;
export const DESIGNER_PORTFOLIO_MAX_IMAGES = 12;

export type Designer = {
  id: string;
  name: string;
  bio: string | null;
  specialties: string[];
  instagram_handle: string | null;
  avatar_url: string | null;
  is_active: boolean;
  sort_order: number;
};

// 前台（anon）讀 designers 時的欄位清單。anon 只有欄位層級的 select 授權，`select("*")` 會被拒
// （42501），所以查詢一律列出明確欄位，不得使用 `*`（見 0017 的 GRANT 與架構筆記 C）。
// 前台查詢還必須自己過濾 is_active：管理員登入狀態下瀏覽前台時是 authenticated＋is_admin()，
// RLS 會放行停用中的設計師。
export const DESIGNER_PUBLIC_COLUMNS =
  "id, name, bio, specialties, instagram_handle, avatar_url, sort_order, is_active";

// 頭像／作品集圖片只信任 designer-assets bucket 底下的網址，比照 lib/admin/account.ts
// resolveAdminAvatarUrl 的寫法：用 URL 解析比對 origin 與 pathname 前綴（URL 解析會正規化
// `..`／`%2e%2e`），不用純字串 startsWith；同時擋下 NEXT_PUBLIC_SUPABASE_URL 未設定時前綴退化成
// 字面 "undefined/…" 而誤判通過的邊界情況。頭像（avatar_url）與作品集（image_url）、前台與後台
// 都要套用，資料庫層只存文字，白名單是顯示層的職責。
export function resolveDesignerAssetUrl(url: string | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;

  try {
    const parsed = new URL(trimmed);
    const allowedOrigin = new URL(supabaseUrl).origin;
    const allowedPathPrefix = "/storage/v1/object/public/designer-assets/";
    // 帶帳密的網址（https://user:pw@host/…）的 origin 不含帳密，必須另外擋；編碼過的斜線
    // （%2F、%5C）URL 解析不會解碼，等於繞過 `..` 正規化，一併拒絕。回傳正規化後的 href，
    // 而不是呼叫端傳入的原始字串，確保渲染的就是通過檢查的那個網址。
    if (parsed.username !== "" || parsed.password !== "") return null;
    if (/%2f|%5c/i.test(parsed.pathname)) return null;
    return parsed.origin === allowedOrigin && parsed.pathname.startsWith(allowedPathPrefix) ? parsed.href : null;
  } catch {
    return null;
  }
}

// 作品集圖片網址的白名單（比 resolveDesignerAssetUrl 更嚴，TASK-071 動工前安全審查）。資料庫的
// image_url constraint 只驗「以 storage_path 結尾」，直接寫入的 image_url 可以長成
// `…/designer-assets/avatar/<B>/x.webp?portfolio/<A>/y.webp`，讓 A 的作品集顯示 B 的頭像或別位設計師的
// 作品。所以顯示作品時必須再要求：沒有 query／hash，且 pathname 完整錨定為「這一列 designer_id」自己的
// portfolio 路徑。designerId 必須是資料庫回傳的小寫 uuid（才能安全組進正規式，Storage policy 也只接受小寫）。
// 前台（TASK-074）與後台共用；回傳 null 的列後台仍要畫成可刪除的佔位格，前台不顯示。
const PORTFOLIO_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LOWERCASE_DESIGNER_ID_PATTERN = new RegExp(`^${PORTFOLIO_UUID}$`);

export function resolvePortfolioImageUrl(url: string | null, designerId: string): string | null {
  if (!LOWERCASE_DESIGNER_ID_PATTERN.test(designerId)) return null;
  const resolved = resolveDesignerAssetUrl(url);
  if (!resolved) return null;

  const parsed = new URL(resolved);
  if (parsed.search !== "" || parsed.hash !== "") return null;

  const pattern = new RegExp(
    `^/storage/v1/object/public/designer-assets/portfolio/${designerId}/${PORTFOLIO_UUID}\\.(jpg|png|webp)$`,
  );
  return pattern.test(parsed.pathname) ? resolved : null;
}

export function portfolioLimitMessage(max: number = DESIGNER_PORTFOLIO_MAX_IMAGES): string {
  return `已達 ${max} 張上限，請先刪除舊作品`;
}

// 沒有頭像時，前後台都顯示名字首字的預設頭像。用 Array.from 取第一個 code point，避免把
// 代理對（例如少數漢字）從中間切開。
export function designerInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ?? "?";
}

// 控制字元與不可見的方向／零寬字元（對齊資料庫 `[[:cntrl:]​-‏‪-‮⁦-⁩]`）。
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;

// 名稱：去前後空白後 1～30 字，不含控制字元（對齊 designers_name_valid）。送出時必須送
// trim() 後的值：JS 的 trim() 會去掉 Tab 與換行，資料庫的 btrim 只去空白，兩者只在送出值
// 沒有先 trim 時才會不一致。
export function validateDesignerName(name: string): string | null {
  const trimmed = name.trim();
  const message = `請輸入 1～${DESIGNER_NAME_MAX_LENGTH} 字的名稱`;
  if (trimmed.length === 0 || Array.from(trimmed).length > DESIGNER_NAME_MAX_LENGTH) return message;
  if (FORBIDDEN_CHARS.test(trimmed)) return message;
  return null;
}

// 簡介允許換行（\n、\r），其餘控制字元與方向／零寬字元同樣禁止。資料庫只檢查簡介長度
// （designers_bio_length），這裡是唯一一道擋住在公開頁偽造文字顯示方向的防線
// （security-reviewer TASK-069 審查 L2）；資料庫 constraint 另開卡補。
const BIO_FORBIDDEN_CHARS = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;

// 簡介：選填，200 字以內（對齊 designers_bio_length）。
export function validateDesignerBio(bio: string): string | null {
  if (Array.from(bio).length > DESIGNER_BIO_MAX_LENGTH) return `${DESIGNER_BIO_MAX_LENGTH} 字以內`;
  if (BIO_FORBIDDEN_CHARS.test(bio)) return "簡介含有不允許的字元";
  return null;
}

// 送出前的簡介清理：換行統一成 \n、NFC 正規化、去前後空白；空白視為未填（null）。
export function normalizeDesignerBio(bio: string): string | null {
  const normalized = bio.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  return normalized.length === 0 ? null : normalized;
}

// 專長標籤：0～5 個，每個 1～12 字，不可重複（對齊 designer_specialties_valid）。比對重複時
// 先 trim；呼叫端送出前應以 normalizeSpecialties 清理，資料庫要求標籤前後不得有空白。
export function validateDesignerSpecialties(tags: string[]): string | null {
  if (tags.length > DESIGNER_SPECIALTIES_MAX_COUNT) {
    return `最多 ${DESIGNER_SPECIALTIES_MAX_COUNT} 個標籤`;
  }
  const trimmed = tags.map((tag) => tag.trim());
  if (trimmed.some((tag) => tag.length === 0 || Array.from(tag).length > DESIGNER_SPECIALTY_MAX_LENGTH)) {
    return `每個標籤 ${DESIGNER_SPECIALTY_MAX_LENGTH} 字以內`;
  }
  if (trimmed.some((tag) => FORBIDDEN_CHARS.test(tag))) return "標籤含有不允許的字元";
  if (new Set(trimmed).size !== trimmed.length) return "標籤不能重複";
  return null;
}

export function normalizeSpecialties(tags: string[]): string[] {
  return tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

const INSTAGRAM_HANDLE_PATTERN = /^[A-Za-z0-9._]{1,30}$/;

// Instagram 帳號：選填；可以省略開頭的 `@`，送出前用 normalizeInstagramHandle 去掉
// （資料庫只存帳號名稱，不存 @ 也不存網址，對齊 designers_instagram_handle_format）。
export function normalizeInstagramHandle(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@/, "");
  return trimmed.length === 0 ? null : trimmed;
}

export function validateInstagramHandle(raw: string): string | null {
  const handle = normalizeInstagramHandle(raw);
  if (handle === null) return null;
  return INSTAGRAM_HANDLE_PATTERN.test(handle) ? null : "只能使用英文、數字、底線和句點";
}

// 由帳號名稱組出固定網域的個人頁網址（資料庫不存網址，杜絕 javascript: 與釣魚網址）。渲染前再驗證
// 一次格式，不通過就不給連結；連結請搭配 target="_blank" rel="noopener noreferrer"。
export function instagramProfileUrl(handle: string | null): string | null {
  if (handle === null || !INSTAGRAM_HANDLE_PATTERN.test(handle)) return null;
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

const DESIGNER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 來自網址的設計師 id 先過這一關：格式錯誤的 id 送進 PostgREST 會得到 22P02，和真正的讀取失敗
// 分不出來。大小寫皆可通過（查詢用），但組 Storage 路徑時必須改用資料庫回傳的小寫 id。
export function isDesignerId(id: string): boolean {
  return DESIGNER_ID_PATTERN.test(id);
}
