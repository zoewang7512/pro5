import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// **僅限伺服器端使用**：包裝 0022 的 RPC `demo_entry_check`，供一鍵進入端點（TASK-103）限流。
// 以 service_role 呼叫（anon／authenticated 沒有執行權限）。
//
// 設計重點（架構筆記 D4）：
// - **出錯一律不允許**：網路、權限、逾時、回傳型別不對、缺金鑰，全部回 `allowed: false`，絕不放行。
// - IP 只以 HMAC-SHA256（金鑰 `DEMO_RATE_LIMIT_SECRET`）進資料庫，不存明文。單純 `sha256(ip + 日期)`
//   的鹽不是祕密、IPv4 空間很小，可被暴力還原；HMAC 的金鑰不外洩就還原不了。
// - IPv6 以 /64 為單位（單一使用者通常拿到整個 /64，逐位址計數形同沒有限流）。
// - 取不到（或不合法的）IP 時只檢查全站上限。
// - 先檢查每 IP，不通過就**不累加全站**：單一 IP 狂打最多只用掉全站額度的一部分
//   （每 IP 10 分鐘 10 次，約等於每 5 分鐘 5 次，全站每 5 分鐘 14 次）。

// 每 IP 每 10 分鐘 10 次。
export const DEMO_ENTRY_IP_LIMIT = 10;
export const DEMO_ENTRY_IP_WINDOW_SECONDS = 600;

// 全站上限。**必須低於 Supabase 實際的登入限額，而且用同一個時間單位比較**（Dashboard → Authentication →
// Rate Limits → sign-ups and sign-ins；使用者於 2026-10-30 確認目前為每 IP 每 5 分鐘 30 次，而呼叫端是 Vercel，
// 所有訪客與還原的健康檢查共用同一個 IP），否則額度耗盡時連健康檢查也會失敗。所以全站窗長取 300 秒，與 Supabase 相同；
// 固定時間窗在窗界交界處最多可連續放行 2 倍上限，因此上限取 Supabase 限額的一半以下（14 × 2 = 28 < 30）。
// 若 Dashboard 的限額被調整，這兩個常數要一起重算。
// 上限本身是阻斷服務的槓桿，使用者已確認接受（架構筆記第 8 節第 6 項）。
export const DEMO_ENTRY_GLOBAL_LIMIT = 14;
export const DEMO_ENTRY_GLOBAL_WINDOW_SECONDS = 300;

// HMAC 金鑰至少 32 字元；太短時搭配 IPv4 的小空間可被暴力還原。
export const MIN_SECRET_LENGTH = 32;

// 限流 RPC 的逾時：超過就視為出錯（不允許）。
const RPC_TIMEOUT_MS = 3000;

export const GLOBAL_BUCKET = "global";

export type DemoEntryLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "ip_limit" | "global_limit" | "error" };

// 展開成 8 個 16 位元組；不是合法 IPv6 回 null。內嵌 IPv4（::ffff:1.2.3.4）會轉成最後兩組。
function expandIpv6(ip: string): number[] | null {
  let addr = ip;
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const [a, b, c, d] = tail.split(".").map(Number);
    addr = `${addr.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

// 把來源 IP 正規化成限流的計數單位：IPv4 原樣；IPv6 取前 64 位元（/64）；
// IPv4-mapped IPv6（::ffff:a.b.c.d）視為該 IPv4；不合法或空值回 null（呼叫端只檢查全站）。
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let ip = raw.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;

  const groups = expandIpv6(ip);
  if (!groups) return null;

  const isMappedV4 = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMappedV4) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

// 每 IP 的 bucket 名稱：`ip:` + HMAC-SHA256(secret, 正規化後的 IP) 十六進位。資料庫看不到明文 IP。
export function ipBucket(normalizedIp: string, secret: string): string {
  return `ip:${createHmac("sha256", secret).update(normalizedIp).digest("hex")}`;
}

// Vercel 會覆寫（不是附加）`x-real-ip`，用戶端無法偽造；與 `@vercel/functions` 的 `ipAddress()` 讀的是同一個標頭，
// 所以不額外加依賴。**只在 Vercel（`VERCEL === "1"`）上採用**：其他環境此標頭可被偽造，會讓攻擊者輪替 bucket，
// 所以回 null、只檢查全站上限（安全方向：較嚴格，不是較寬鬆）。
export function getClientIp(headers: { get(name: string): string | null }): string | null {
  if (process.env.VERCEL !== "1") return null;
  return headers.get("x-real-ip");
}

async function consume(
  supabase: ReturnType<typeof createServiceRoleClient>,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .rpc("demo_entry_check", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
  if (error) {
    // 只記錯誤代碼，不記 bucket（含 IP 的雜湊）與訊息。
    console.error("[demo-rate-limit] RPC 失敗", error.code ?? "unknown");
    return null;
  }
  return typeof data === "boolean" ? data : null;
}

// 檢查一次進入嘗試是否允許，**同時累加計數**（每次呼叫都算一次）。出錯一律回不允許。
export async function checkDemoEntryLimit(ip: string | null | undefined): Promise<DemoEntryLimitResult> {
  try {
    const normalized = normalizeIp(ip);
    const secret = process.env.DEMO_RATE_LIMIT_SECRET?.trim();
    // 有 IP 卻沒有（或太短的）金鑰：無法安全雜湊，也不能退回明文，視為設定錯誤而拒絕。
    if (normalized && (!secret || secret.length < MIN_SECRET_LENGTH)) {
      console.error("[demo-rate-limit] DEMO_RATE_LIMIT_SECRET 缺少或長度不足");
      return { allowed: false, reason: "error" };
    }

    const supabase = createServiceRoleClient();

    if (normalized && secret) {
      const ok = await consume(
        supabase,
        ipBucket(normalized, secret),
        DEMO_ENTRY_IP_LIMIT,
        DEMO_ENTRY_IP_WINDOW_SECONDS,
      );
      if (ok === null) return { allowed: false, reason: "error" };
      if (!ok) return { allowed: false, reason: "ip_limit" };
    }

    const globalOk = await consume(
      supabase,
      GLOBAL_BUCKET,
      DEMO_ENTRY_GLOBAL_LIMIT,
      DEMO_ENTRY_GLOBAL_WINDOW_SECONDS,
    );
    if (globalOk === null) return { allowed: false, reason: "error" };
    if (!globalOk) return { allowed: false, reason: "global_limit" };

    return { allowed: true };
  } catch (err) {
    console.error("[demo-rate-limit] 例外", err instanceof Error ? err.name : "unknown");
    return { allowed: false, reason: "error" };
  }
}
