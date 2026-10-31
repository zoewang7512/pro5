import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import seedBaseJson from "./seed-base.json";
import { buildDemoSeed } from "./seed-data";
import type { DemoSeedBase, DemoSeedPayload } from "./seed-types";

// **僅限伺服器端使用**：Demo 還原編排（TASK-109）。依序執行：
//   [prepare]         找出 Demo 帳戶、產生 seed payload、檢查圖片引用（唯讀）
//   [sync_images]     差異同步圖片：demo-seed → 公開 bucket。只新增與覆寫，不刪；來源缺檔直接失敗，尚未動任何資料
//   [reset_database]  reset_demo_data(payload, dryRun)；真實還原前開閘門、finally 關閘門
//   [cleanup_orphans] 只在資料庫還原成功之後：刪除不再被引用的孤兒圖片（白名單 bucket，絕不碰 demo-seed）
//   [revoke_account]  刪除 Demo 帳戶的 MFA factor、撤銷 Demo 的 session
//   [health_check]    用獨立 anon client 驗證 Demo 帳戶可登入、is_demo、無 MFA（只回報，不修復）
//
// dryRun = true：只做 prepare 的唯讀檢查、sync_images 的唯讀計畫、reset_database 的 dry-run；
// 不複製、不刪除、不開閘門、不清理、不處理帳戶、不登入。
//
// 這個函式是唯一可以對正式庫真實呼叫 reset_demo_data(p_dry_run=false) 的程式（tests/lib/demo-reset-test-scan.test.ts 把關）。
// dryRun 必須由呼叫端明確傳入，沒有任何預設值或便利方法。
// 任何階段失敗都回報該階段；只記錄階段、筆數與耗時，絕不記錄密碼、金鑰、token。

export type DemoResetStage = "prepare" | "sync_images" | "reset_database" | "cleanup_orphans" | "revoke_account" | "health_check";
export type DemoResetStageStatus = "done" | "skipped" | "partial" | "failed";

export type DemoResetSummary = {
  dryRun: boolean;
  durationMs: number;
  // 真實還原且資料庫交易已提交。
  databaseRestored: boolean;
  stages: Partial<Record<DemoResetStage, { status: DemoResetStageStatus; detail?: string }>>;
  // planned = 比對後需要複製／覆寫的數量（dry-run 也會填）；copied／replaced = 實際完成的數量（dry-run 恆為 0）。
  sync?: { referenced: number; unchanged: number; planned: { copy: number; replace: number }; copied: number; replaced: number };
  database?: { counts: Record<string, number>; deleted: Record<string, number> };
  cleanup?: Record<string, { candidates: number; removed: number; skipped?: string }>;
  account?: { factorsRemoved: number; sessionsRevoked: number };
  health?: { ok: boolean; error?: string };
  warnings: string[];
};

export type DemoResetResult =
  | { ok: true; summary: DemoResetSummary }
  | { ok: false; stage: DemoResetStage; error: string; summary: DemoResetSummary };

type HealthClient = {
  auth: Pick<SupabaseClient["auth"], "signInWithPassword" | "signOut"> & {
    mfa: Pick<SupabaseClient["auth"]["mfa"], "getAuthenticatorAssuranceLevel">;
  };
};

// 正式呼叫端（TASK-110 的端點與指令）只用這四個欄位。
export type RunDemoResetOptions = {
  supabase: SupabaseClient;
  // seed 日期的基準（預約相對於它產生）。
  now: Date;
  // 必須明確傳入，且必須是 boolean。true = 只做 dry-run。
  dryRun: boolean;
  // 整個流程應該結束的絕對時間（Date.now() 毫秒）。逼近時只會在 sync_images 與 cleanup_orphans 中止；
  // 真實還原進入資料庫之前，至少要剩 DB_AND_TAIL_RESERVE_MS（15 秒）給交易、帳戶處理與健康檢查，否則中止在 sync_images。
  deadlineMs: number;
};

// 測試注入點：只給 runDemoResetWithDeps（測試匯入）。不開放在正式入口，避免呼叫端傳入錯誤的 seed、網址或略過健康檢查。
export type DemoResetDeps = {
  base?: DemoSeedBase;
  supabaseUrl?: string;
  clock?: () => number;
  createHealthClient?: () => HealthClient;
};

// ============================================================
// 常數
// ============================================================

const DEMO_SEED_BUCKET = "demo-seed";
// 圖片來源／目的與孤兒清理的 bucket 白名單，寫死。demo-seed 不在其中：清理絕不碰它。
const PUBLIC_BUCKETS = ["store-assets", "designer-assets", "admin-assets"] as const;
type PublicBucket = (typeof PUBLIC_BUCKETS)[number];

const PUBLIC_PREFIX = "/storage/v1/object/public/";
const COPY_CONCURRENCY = 5;
const REMOVE_BATCH = 1000;
// PostgREST 單次最多回傳 1000 列；剛好 1000 列視為可能被截斷，寧可中止也不拿不完整的清單做決定。
const LIST_LIMIT = 1000;
// 開門到呼叫還原之間只隔一次 RPC，期限不需要長；萬一程序被中途終止，閘門最多再開這麼久。
const GATE_MINUTES = 3;
// 進入資料庫之前至少要剩下的時間：交易（含最多 5 秒取鎖）、帳戶處理、健康檢查。
const DB_AND_TAIL_RESERVE_MS = 15_000;
// 資料庫時間（物件 created_at）與應用程式時鐘可能差幾秒：比「還原開始時間」早這麼久以上的物件才算孤兒。
const CLOCK_SKEW_MARGIN_MS = 60_000;
const MAX_ERROR_LENGTH = 200;

// ============================================================
// 圖片引用解析
// ============================================================

type StorageRef = { bucket: PublicBucket; path: string };
type ParsedUrl = { kind: "none" } | { kind: "external" } | { kind: "invalid" } | { kind: "ours"; ref: StorageRef };

// 本專案 Storage 公開網址 → { bucket, path }。
//   - 空值：不是引用。
//   - 別的網域：不是我們的 Storage（資料庫只限長度，不限來源），不算引用。
//   - 同網域但格式不符、bucket 不在白名單、路徑有 ..／空段／編碼斜線：invalid（呼叫端會因此跳過清理）。
export function parseStorageUrl(raw: string | null | undefined, origin: string): ParsedUrl {
  if (raw === null || raw === undefined || raw === "") return { kind: "none" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (parsed.origin !== origin) return { kind: "external" };
  if (!parsed.pathname.startsWith(PUBLIC_PREFIX)) return { kind: "invalid" };

  let segments: string[];
  try {
    segments = parsed.pathname.slice(PUBLIC_PREFIX.length).split("/").map(decodeURIComponent);
  } catch {
    return { kind: "invalid" };
  }
  const [bucket, ...rest] = segments;
  if (
    !(PUBLIC_BUCKETS as readonly string[]).includes(bucket) ||
    rest.length === 0 ||
    rest.some((s) => s === "" || s === "." || s === ".." || /[\\/\u0000-\u001f]/.test(s))
  ) {
    return { kind: "invalid" };
  }
  return { kind: "ours", ref: { bucket: bucket as PublicBucket, path: rest.join("/") } };
}

const refKey = (ref: StorageRef) => `${ref.bucket}/${ref.path}`;

function payloadUrls(payload: DemoSeedPayload): string[] {
  const urls: (string | null)[] = [
    payload.store_settings.logo_url,
    payload.store_settings.cover_image_url,
    payload.demo_admin_profile.avatar_url,
    ...payload.designers.map((d) => d.avatar_url),
    ...payload.portfolio_images.map((i) => i.image_url),
  ];
  return urls.filter((u): u is string => typeof u === "string" && u !== "");
}

// 收集 URL 集合所引用的本專案物件；回傳是否出現「同網域但無法解析」的網址。
export function collectReferences(urls: string[], origin: string): { refs: Map<string, StorageRef>; invalid: string[] } {
  const refs = new Map<string, StorageRef>();
  const invalid: string[] = [];
  for (const url of urls) {
    const parsed = parseStorageUrl(url, origin);
    if (parsed.kind === "ours") refs.set(refKey(parsed.ref), parsed.ref);
    else if (parsed.kind === "invalid") invalid.push(url);
  }
  return { refs, invalid };
}

// ============================================================
// Storage 物件清單（唯讀 RPC）
// ============================================================

type StorageObjectRow = { name: string; size: number | null; etag: string | null; created_at: string; owner_id: string | null };
type ListResult = { ok: true; rows: Map<string, StorageObjectRow> } | { ok: false; error: string };

async function listBucketObjects(supabase: SupabaseClient, bucket: string): Promise<ListResult> {
  const { data, error } = await supabase.rpc("demo_list_storage_objects", { p_bucket: bucket });
  if (error) return { ok: false, error: `list_${bucket}_failed` };
  const rows = (data ?? []) as StorageObjectRow[];
  if (rows.length >= LIST_LIMIT) return { ok: false, error: `list_${bucket}_truncated` };
  return { ok: true, rows: new Map(rows.map((row) => [row.name, row])) };
}

// ============================================================
// 小工具
// ============================================================

const shorten = (message: string | undefined) => (message ?? "unknown_error").slice(0, MAX_ERROR_LENGTH);

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, shouldStop: () => boolean): Promise<{ failures: string[]; stopped: boolean }> {
  const queue = [...items];
  const failures: string[] = [];
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        if (shouldStop()) {
          stopped = true;
          return;
        }
        const item = queue.shift() as T;
        try {
          await worker(item);
        } catch (error) {
          failures.push(shorten(error instanceof Error ? error.message : String(error)));
        }
      }
    }),
  );
  return { failures, stopped };
}

async function findDemoUserId(supabase: SupabaseClient): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { ok: false, error: "list_users_failed" };
    for (const user of data.users) if (user.app_metadata?.is_demo === true) ids.push(user.id);
    if (data.users.length < 200) break;
  }
  if (ids.length !== 1) return { ok: false, error: `expected_exactly_1_demo_account_found_${ids.length}` };
  return { ok: true, id: ids[0] };
}

function defaultHealthClient(): HealthClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("missing_supabase_env");
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// ============================================================
// 主流程
// ============================================================

export async function runDemoReset(options: RunDemoResetOptions): Promise<DemoResetResult> {
  return runDemoResetWithDeps(options, {});
}

// 內部入口，只給測試匯入（tests/lib/demo-reset-test-scan.test.ts 禁止其他檔案引用）。
export async function runDemoResetWithDeps(options: RunDemoResetOptions, deps: DemoResetDeps): Promise<DemoResetResult> {
  const { supabase, now, dryRun, deadlineMs } = options;
  // 執行期型別檢查：呼叫端若從 query／body 取值並用 as any 傳入字串 "false"，TS 端會當成 truthy，
  // 送到資料庫卻被轉成 boolean false。寧可丟錯，也不讓兩邊對 dryRun 的理解不一致。
  if (typeof dryRun !== "boolean") throw new Error("runDemoReset: dryRun must be a boolean");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("runDemoReset: now must be a valid Date");
  if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs)) throw new Error("runDemoReset: deadlineMs must be a finite number");

  const clock = deps.clock ?? Date.now;
  const startedAtMs = clock();
  const base = deps.base ?? (seedBaseJson as unknown as DemoSeedBase);

  const summary: DemoResetSummary = { dryRun, durationMs: 0, databaseRestored: false, stages: {}, warnings: [] };
  const finish = (): DemoResetSummary => {
    summary.durationMs = clock() - startedAtMs;
    return summary;
  };
  const fail = (stage: DemoResetStage, error: string): DemoResetResult => {
    summary.stages[stage] = { status: "failed", detail: error };
    return { ok: false, stage, error, summary: finish() };
  };
  const pastDeadline = () => clock() >= deadlineMs;

  // ---------- prepare（唯讀）----------
  // 判斷「圖片網址是不是本專案的」要靠網域。沒有預設值：拿不到就失敗，否則所有網址都會被當成外部網址，
  // 引用集合變空，孤兒清理會把公開 bucket 刪光。
  let origin: string;
  try {
    origin = new URL(deps.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return fail("prepare", "supabase_url_missing");
  }
  const demo = await findDemoUserId(supabase);
  if (!demo.ok) return fail("prepare", demo.error);
  const demoUserId = demo.id;

  let payload: DemoSeedPayload;
  try {
    payload = { ...buildDemoSeed(now, base), demo_user_id: demoUserId };
  } catch (error) {
    return fail("prepare", shorten(error instanceof Error ? error.message : "seed_build_failed"));
  }
  const payloadRefs = collectReferences(payloadUrls(payload), origin);
  if (payloadRefs.invalid.length > 0) return fail("prepare", "seed_has_unparseable_storage_url");
  // seed 是程式自己控制的資料：每個圖片網址都必須是本專案的 Storage 網址，且至少要有一張。
  // 網域對不上（環境變數不同、http／https 不同、自訂網域…）時所有網址會變成 external，這裡必須擋下。
  if (payloadRefs.refs.size === 0 || payloadUrls(payload).some((u) => parseStorageUrl(u, origin).kind !== "ours")) {
    return fail("prepare", "seed_storage_urls_not_in_this_project");
  }
  summary.stages.prepare = { status: "done" };

  // ---------- sync_images ----------
  const seedList = await listBucketObjects(supabase, DEMO_SEED_BUCKET);
  if (!seedList.ok) return fail("sync_images", seedList.error);
  const destLists = new Map<PublicBucket, Map<string, StorageObjectRow>>();
  for (const bucket of PUBLIC_BUCKETS) {
    const listed = await listBucketObjects(supabase, bucket);
    if (!listed.ok) return fail("sync_images", listed.error);
    destLists.set(bucket, listed.rows);
  }

  const toCopy: StorageRef[] = [];
  const toReplace: StorageRef[] = [];
  const missing: string[] = [];
  const foreignOwned: string[] = [];
  let unchanged = 0;
  for (const ref of payloadRefs.refs.values()) {
    const seed = seedList.rows.get(refKey(ref));
    if (!seed) {
      missing.push(refKey(ref));
      continue;
    }
    const dest = destLists.get(ref.bucket)?.get(ref.path);
    if (!dest) toCopy.push(ref);
    else if (dest.size !== seed.size || dest.etag !== seed.etag) {
      // admin-assets 不分使用者共用一個資料夾：只允許覆寫沒有擁有者或屬於 Demo 的物件，
      // 避免 seed 資料誤填成 designer001 的頭像路徑時，被 service role 覆寫別人的檔案。
      if (ref.bucket === "admin-assets" && dest.owner_id && dest.owner_id !== demoUserId) foreignOwned.push(refKey(ref));
      else toReplace.push(ref);
    } else unchanged += 1;
  }
  if (missing.length > 0) {
    // 來源缺檔：尚未動任何資料，dry-run 也一樣失敗。
    return fail("sync_images", `missing_seed_objects:${missing.slice(0, 10).join(",")}${missing.length > 10 ? ",…" : ""}`);
  }
  if (foreignOwned.length > 0) return fail("sync_images", `admin_asset_owned_by_other_account:${foreignOwned.slice(0, 5).join(",")}`);
  summary.sync = {
    referenced: payloadRefs.refs.size,
    unchanged,
    planned: { copy: toCopy.length, replace: toReplace.length },
    copied: 0,
    replaced: 0,
  };

  if (!dryRun) {
    const work = [...toCopy.map((ref) => ({ ref, replace: false })), ...toReplace.map((ref) => ({ ref, replace: true }))];
    const { failures, stopped } = await runPool(
      work,
      async ({ ref, replace }) => {
        // 內容不同：先 remove 再 copy（Storage 的 copy 不會覆寫既有檔案）。
        if (replace) {
          const { error } = await supabase.storage.from(ref.bucket).remove([ref.path]);
          if (error) throw new Error(`remove_failed:${refKey(ref)}`);
        }
        const { error } = await supabase.storage.from(DEMO_SEED_BUCKET).copy(refKey(ref), ref.path, { destinationBucket: ref.bucket });
        if (error) throw new Error(`copy_failed:${refKey(ref)}`);
        if (replace) summary.sync!.replaced += 1;
        else summary.sync!.copied += 1;
      },
      pastDeadline,
    );
    if (stopped) return fail("sync_images", "deadline");
    if (failures.length > 0) return fail("sync_images", failures.slice(0, 5).join(";"));
    // 交易本身不可被中斷：進入資料庫之前，最後一次檢查時間，並預留交易、帳戶處理與健康檢查所需的時間。
    if (deadlineMs - clock() < DB_AND_TAIL_RESERVE_MS) return fail("sync_images", "deadline_before_database");
  }
  summary.stages.sync_images = { status: dryRun ? "skipped" : "done", detail: dryRun ? "dry-run：只檢查來源，未複製" : undefined };

  // ---------- reset_database ----------
  let rpcFailure: string | null = null;
  let gateAttempted = false;
  try {
    if (!dryRun) {
      // 只要「呼叫過」開門就在 finally 關門：開門的回應遺失（逾時、網路）時，伺服器端可能其實已經開了。
      gateAttempted = true;
      const { error } = await supabase.rpc("demo_reset_open_gate", { p_minutes: GATE_MINUTES });
      if (error) rpcFailure = "open_gate_failed";
    }
    if (!rpcFailure) {
      const { data, error } = await supabase.rpc("reset_demo_data", { p_payload: payload, p_dry_run: dryRun });
      if (error) {
        rpcFailure = `reset_failed:${error.code ?? "unknown"}:${shorten(error.message)}`;
      } else if (!data || data.dry_run !== dryRun || typeof data.counts !== "object" || data.counts === null) {
        rpcFailure = "reset_unexpected_response";
      } else {
        summary.database = { counts: data.counts, deleted: data.deleted ?? {} };
        if (!dryRun) summary.databaseRestored = true;
      }
    }
  } finally {
    if (gateAttempted) {
      // 成功時函式已在同一個交易內關閘門；這裡無論成敗都再關一次。關閉失敗不影響結果，只記警告。
      const { error } = await supabase.rpc("demo_reset_close_gate");
      if (error) summary.warnings.push("close_gate_failed");
    }
  }
  if (rpcFailure) return fail("reset_database", rpcFailure);
  summary.stages.reset_database = { status: "done", detail: dryRun ? "dry-run（已回滾）" : undefined };

  if (dryRun) {
    summary.stages.cleanup_orphans = { status: "skipped", detail: "dry-run" };
    summary.stages.revoke_account = { status: "skipped", detail: "dry-run" };
    summary.stages.health_check = { status: "skipped", detail: "dry-run" };
    return { ok: true, summary: finish() };
  }

  // 資料庫已還原。以下階段任何一個失敗都不回滾，也不阻止後面的階段（帳戶處理與健康檢查仍要做）；
  // 最後回報第一個失敗的階段。
  let firstFailure: { stage: DemoResetStage; error: string } | null = null;
  const record = (stage: DemoResetStage, error: string) => {
    summary.stages[stage] = { status: "failed", detail: error };
    firstFailure ??= { stage, error };
  };

  // ---------- cleanup_orphans ----------
  // 資料庫已提交：清理丟出任何例外都不能中斷後面的帳戶處理與健康檢查，也不能讓摘要（databaseRestored）遺失。
  try {
    await cleanupOrphans({ supabase, payloadRefs: payloadRefs.refs, origin, demoUserId, startedAtMs, clock, deadlineMs, summary, record });
  } catch {
    record("cleanup_orphans", "cleanup_error");
  }

  // ---------- revoke_account ----------
  // 兩件事各自處理：刪 MFA factor 失敗，也要照樣撤銷 session（反之亦然）。
  let factorsRemoved = 0;
  let sessionsRevoked = 0;
  let accountFailed = false;
  try {
    const listed = await supabase.auth.admin.mfa.listFactors({ userId: demoUserId });
    if (listed.error) throw new Error("list_factors_failed");
    for (const factor of listed.data?.factors ?? []) {
      const { error } = await supabase.auth.admin.mfa.deleteFactor({ id: factor.id, userId: demoUserId });
      if (error) throw new Error("delete_factor_failed");
      factorsRemoved += 1;
    }
  } catch (error) {
    accountFailed = true;
    record("revoke_account", shorten(error instanceof Error ? error.message : "delete_factor_failed"));
  }
  try {
    const { data: revoked, error } = await supabase.rpc("demo_revoke_sessions");
    if (error) throw new Error("revoke_sessions_failed");
    sessionsRevoked = typeof revoked === "number" ? revoked : 0;
  } catch (error) {
    accountFailed = true;
    record("revoke_account", shorten(error instanceof Error ? error.message : "revoke_sessions_failed"));
  }
  summary.account = { factorsRemoved, sessionsRevoked };
  if (!accountFailed) summary.stages.revoke_account = { status: "done" };

  // ---------- health_check ----------
  await healthCheck({ demoUserId, createHealthClient: deps.createHealthClient ?? defaultHealthClient, summary, record });

  const failure = firstFailure as { stage: DemoResetStage; error: string } | null;
  if (failure) return { ok: false, stage: failure.stage, error: failure.error, summary: finish() };
  return { ok: true, summary: finish() };
}

// ============================================================
// 孤兒清理
// ============================================================

async function cleanupOrphans(args: {
  supabase: SupabaseClient;
  payloadRefs: Map<string, StorageRef>;
  origin: string;
  demoUserId: string;
  startedAtMs: number;
  clock: () => number;
  deadlineMs: number;
  summary: DemoResetSummary;
  record: (stage: DemoResetStage, error: string) => void;
}) {
  const { supabase, origin, demoUserId, startedAtMs, clock, deadlineMs, summary, record } = args;
  const result: NonNullable<DemoResetSummary["cleanup"]> = {};
  summary.cleanup = result;

  // 引用清單 = seed payload 的路徑 + 目前 admins 的頭像網址（含 designer001 的）。
  const adminsQuery = await supabase.from("admins").select("avatar_url");
  if (adminsQuery.error) {
    record("cleanup_orphans", "admins_query_failed");
    return;
  }
  const adminUrls = ((adminsQuery.data ?? []) as { avatar_url: string | null }[])
    .map((row) => row.avatar_url)
    .filter((u): u is string => typeof u === "string" && u !== "");
  const adminRefs = collectReferences(adminUrls, origin);

  // 任何引用網址（同網域）解析失敗：不知道它指向哪個 bucket，寧可全部跳過也不冒險刪到被引用的檔案。
  if (adminRefs.invalid.length > 0) {
    summary.warnings.push("unparseable_admin_avatar_url_cleanup_skipped");
    summary.stages.cleanup_orphans = { status: "skipped", detail: "unparseable_reference" };
    return;
  }
  const referenced = new Set<string>([...args.payloadRefs.keys(), ...adminRefs.refs.keys()]);

  let partial = false;
  for (const bucket of PUBLIC_BUCKETS) {
    // 清理對象是寫死的 PUBLIC_BUCKETS 白名單（不含 demo-seed），由「cleanup 絕不對 demo-seed 發出刪除」的單元測試把關。
    const listed = await listBucketObjects(supabase, bucket);
    if (!listed.ok) {
      result[bucket] = { candidates: 0, removed: 0, skipped: listed.error };
      summary.warnings.push(`${bucket}_cleanup_skipped:${listed.error}`);
      record("cleanup_orphans", listed.error);
      continue;
    }

    const candidates: string[] = [];
    for (const row of listed.rows.values()) {
      if (referenced.has(`${bucket}/${row.name}`)) continue;
      // 剛上傳的物件（只有早於還原開始時間、且超過時鐘誤差邊際的才算孤兒）一律不碰；created_at 解析失敗（NaN）也不碰。
      if (!(Date.parse(row.created_at) < startedAtMs - CLOCK_SKEW_MARGIN_MS)) continue;
      // admin-assets 不分使用者共用一個資料夾：只刪明確屬於 Demo 帳戶的；擁有者未知（null）或別人的一律不碰。
      if (bucket === "admin-assets" && row.owner_id !== demoUserId) continue;
      candidates.push(row.name);
    }

    const entry = { candidates: candidates.length, removed: 0 } as { candidates: number; removed: number; skipped?: string };
    result[bucket] = entry;
    for (let i = 0; i < candidates.length; i += REMOVE_BATCH) {
      if (clock() >= deadlineMs) {
        entry.skipped = "deadline";
        partial = true;
        break;
      }
      const batch = candidates.slice(i, i + REMOVE_BATCH);
      const { data, error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        entry.skipped = "remove_failed";
        record("cleanup_orphans", `remove_failed:${bucket}`);
        break;
      }
      // 以 Storage 實際回傳的已刪除物件數為準（取不到時才用批次大小）。
      entry.removed += Array.isArray(data) ? data.length : batch.length;
    }
  }

  const current = summary.stages.cleanup_orphans;
  if (!current) summary.stages.cleanup_orphans = { status: partial ? "partial" : "done", detail: partial ? "deadline" : undefined };
}

// ============================================================
// 健康檢查
// ============================================================

async function healthCheck(args: {
  demoUserId: string;
  createHealthClient: () => HealthClient;
  summary: DemoResetSummary;
  record: (stage: DemoResetStage, error: string) => void;
}) {
  const { demoUserId, summary, record } = args;
  const email = process.env.DEMO_EMAIL?.trim();
  const password = process.env.DEMO_PASSWORD;
  const fail = (error: string) => {
    summary.health = { ok: false, error };
    record("health_check", error);
  };
  if (!email || !password) {
    fail("credentials_missing");
    return;
  }

  let client: HealthClient;
  try {
    client = args.createHealthClient();
  } catch {
    fail("client_unavailable");
    return;
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      fail("sign_in_failed");
      return;
    }
    if (data.user.app_metadata?.is_demo !== true) {
      fail("not_demo");
      return;
    }
    if (data.user.id !== demoUserId) {
      fail("unexpected_account");
      return;
    }
    const aal = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.error || !aal.data) {
      fail("aal_error");
      return;
    }
    if (aal.data.nextLevel === "aal2") {
      fail("mfa_enrolled");
      return;
    }
    summary.health = { ok: true };
    summary.stages.health_check = { status: "done" };
  } catch {
    fail("health_check_error");
  } finally {
    // 只結束這個獨立 client 自己剛建立的 session（scope: local 只撤銷這一個），不影響其他在線的面試官。
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      // 已盡力；不影響結果。
    }
  }
}
