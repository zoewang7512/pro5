// 把 Demo seed 引用的圖片從目前的公開 bucket 複製到私有 bucket `demo-seed`（TASK-107）。
// 執行方式：npm run demo:upload-images -- --from-public [--overwrite] [--dry-run]（會用 --env-file=.env.local 載入環境變數）。
//
//   --from-public  必填。來源是 lib/demo/seed-base.json 引用的公開 bucket 物件（目前唯一的來源模式）。
//   --overwrite    目的地已存在但大小或 eTag 不同時，先刪再複製（Storage 的 copy 不會覆寫既有檔案）。
//                  沒帶時只報告差異，不動目的地，結束碼為 2。
//   --dry-run      只檢查與列出計畫，不寫入任何東西（demo-seed 尚未建立也能執行，用來先檢查來源是否齊全）。
//   --base <路徑>  改讀另一份基底資料（測試用）。
//
// 路徑規則：demo-seed/<來源 bucket>/<原路徑>。來源只認三個公開 bucket，且網址必須是本專案的 Storage 公開網址。
// 只讀取公開 bucket，不改動、不刪除其中任何物件；來源缺檔會列出清單並在複製前中止，不產生半套。
// 冪等：目的地已存在且大小與 eTag 相同就略過。service role key 與 token 全程不印出。

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEST_BUCKET = "demo-seed";
const SOURCE_BUCKETS = ["store-assets", "designer-assets", "admin-assets"];
const PUBLIC_PREFIX = "/storage/v1/object/public/";
const LIST_PAGE_SIZE = 1000;
const COPY_CONCURRENCY = 5;
const DEFAULT_BASE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "demo", "seed-base.json");

function fail(message) {
  console.error(`[upload-demo-images] ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const fromPublic = args.includes("--from-public");
const overwrite = args.includes("--overwrite");
const dryRun = args.includes("--dry-run");
const baseFlagIndex = args.indexOf("--base");
const basePath = baseFlagIndex >= 0 ? path.resolve(args[baseFlagIndex + 1] ?? "") : DEFAULT_BASE_PATH;

if (!fromPublic) {
  fail("必須帶 --from-public（目前唯一支援的來源：seed-base.json 引用的公開 bucket 物件）。");
}
if (baseFlagIndex >= 0 && !args[baseFlagIndex + 1]) {
  fail("--base 後面需要接檔案路徑。");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

class UploadAbort extends Error {}

function abort(message) {
  throw new UploadAbort(message);
}

// 把基底資料中的公開網址換成 { bucket, path }。網址不是本專案的公開 Storage 網址就中止（不猜）。
function parsePublicUrl(rawUrl, label) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return abort(`${label} 不是有效網址：${rawUrl}`);
  }
  if (parsed.origin !== new URL(url).origin || !parsed.pathname.startsWith(PUBLIC_PREFIX)) {
    return abort(`${label} 不是本專案的 Storage 公開網址：${rawUrl}`);
  }
  const segments = parsed.pathname.slice(PUBLIC_PREFIX.length).split("/").map(decodeURIComponent);
  const [bucket, ...rest] = segments;
  if (!SOURCE_BUCKETS.includes(bucket) || rest.length === 0 || rest.some((s) => s === "" || s === "." || s === "..")) {
    return abort(`${label} 的 bucket 或路徑不在允許範圍：${rawUrl}`);
  }
  return { bucket, path: rest.join("/") };
}

function collectRefs(base) {
  const refs = new Map();
  const add = (rawUrl, label) => {
    if (!rawUrl) return;
    const ref = parsePublicUrl(rawUrl, label);
    refs.set(`${ref.bucket}/${ref.path}`, ref);
  };
  add(base.store_settings?.logo_url, "store_settings.logo_url");
  add(base.store_settings?.cover_image_url, "store_settings.cover_image_url");
  add(base.demo_admin_profile?.avatar_url, "demo_admin_profile.avatar_url");
  for (const designer of base.designers ?? []) add(designer.avatar_url, `designers[${designer.id}].avatar_url`);
  for (const image of base.portfolio_images ?? []) {
    add(image.image_url, `portfolio_images[${image.id}].image_url`);
    const ref = parsePublicUrl(image.image_url, `portfolio_images[${image.id}].image_url`);
    if (ref.bucket !== "designer-assets" || ref.path !== image.storage_path) {
      abort(`portfolio_images[${image.id}] 的網址與 storage_path 不一致`);
    }
  }
  return [...refs.values()].sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));
}

// 列出某 bucket 內某些資料夾的物件（list 不遞迴，所以逐個資料夾列；每個資料夾分頁到列完）。
async function indexFolders(bucket, folders) {
  const index = new Map();
  for (const folder of folders) {
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: LIST_PAGE_SIZE, offset });
      if (error) abort(`列出 ${bucket}/${folder} 失敗：${error.message}`);
      for (const object of data ?? []) {
        if (object.id === null) continue; // 資料夾
        index.set(folder ? `${folder}/${object.name}` : object.name, {
          size: object.metadata?.size ?? null,
          etag: object.metadata?.eTag ?? null,
        });
      }
      if ((data ?? []).length < LIST_PAGE_SIZE) break;
    }
  }
  return index;
}

const parentOf = (objectPath) => (objectPath.includes("/") ? objectPath.slice(0, objectPath.lastIndexOf("/")) : "");

async function runPool(items, worker) {
  const queue = [...items];
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        try {
          await worker(item);
        } catch (error) {
          failures.push(`${item.bucket}/${item.path}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }),
  );
  return failures;
}

const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function main() {
  let base;
  try {
    base = JSON.parse(readFileSync(basePath, "utf8"));
  } catch (error) {
    abort(`讀不到基底資料 ${basePath}：${error instanceof Error ? error.message : String(error)}`);
  }
  const refs = collectRefs(base);
  console.log(`[upload-demo-images] seed-base 引用 ${refs.length} 個圖片物件${dryRun ? "（dry-run，不寫入）" : ""}。`);

  // 目的 bucket 必須存在且是私有。dry-run 容許尚未建立（migration 0023 未套用），改視為全部缺少。
  let destReady = true;
  const { data: bucketInfo, error: bucketError } = await supabase.storage.getBucket(DEST_BUCKET);
  if (bucketError || !bucketInfo) {
    if (!dryRun) abort(`找不到 bucket ${DEST_BUCKET}，請先套用 migration 0023_demo_seed_bucket.sql。`);
    destReady = false;
    console.warn(`[upload-demo-images] 提醒：bucket ${DEST_BUCKET} 尚未建立（migration 0023 未套用），以下視為全部尚未複製。`);
  } else if (bucketInfo.public) {
    abort(`bucket ${DEST_BUCKET} 不是私有，已中止（請檢查 migration 0023）。`);
  }

  // 1. 來源檢查：缺檔就列出並中止，不做任何複製。
  const sourceIndexes = new Map();
  for (const bucket of SOURCE_BUCKETS) {
    const folders = [...new Set(refs.filter((r) => r.bucket === bucket).map((r) => parentOf(r.path)))];
    if (folders.length > 0) sourceIndexes.set(bucket, await indexFolders(bucket, folders));
  }
  const missing = refs.filter((r) => !sourceIndexes.get(r.bucket)?.has(r.path));
  if (missing.length > 0) {
    console.error("[upload-demo-images] 來源缺檔，已中止（沒有複製任何東西）：");
    for (const ref of missing) console.error(`  - ${ref.bucket}/${ref.path}`);
    process.exitCode = 1;
    return;
  }

  // 2. 目的地比對。
  const destFolders = [...new Set(refs.map((r) => parentOf(`${r.bucket}/${r.path}`)))];
  const destIndex = destReady ? await indexFolders(DEST_BUCKET, destFolders) : new Map();
  const plan = { same: [], missing: [], different: [] };
  for (const ref of refs) {
    const source = sourceIndexes.get(ref.bucket).get(ref.path);
    const dest = destIndex.get(`${ref.bucket}/${ref.path}`);
    const entry = { ...ref, source };
    if (!dest) plan.missing.push(entry);
    else if (dest.size === source.size && dest.etag === source.etag) plan.same.push(entry);
    else plan.different.push(entry);
  }
  console.log(
    `[upload-demo-images] 已相同 ${plan.same.length}、缺少 ${plan.missing.length}、內容不同 ${plan.different.length}。`,
  );
  for (const entry of plan.different) console.log(`  不同：${entry.bucket}/${entry.path}`);

  if (dryRun) return;

  // 3. 複製（缺少的）；內容不同的只有 --overwrite 才先刪再複製。
  const toCopy = [...plan.missing, ...(overwrite ? plan.different : [])];
  const failures = await runPool(toCopy, async (entry) => {
    const destPath = `${entry.bucket}/${entry.path}`;
    if (plan.different.includes(entry)) {
      const { error: removeError } = await supabase.storage.from(DEST_BUCKET).remove([destPath]);
      if (removeError) throw new Error(`刪除舊檔失敗：${removeError.message}`);
    }
    const { error } = await supabase.storage.from(entry.bucket).copy(entry.path, destPath, { destinationBucket: DEST_BUCKET });
    if (error) throw new Error(`複製失敗：${error.message}`);
  });
  if (failures.length > 0) {
    console.error(`[upload-demo-images] ${failures.length} 個物件複製失敗：`);
    for (const line of failures) console.error(`  - ${line}`);
    process.exitCode = 1;
  }

  // 4. 事後核對：每個引用路徑在 demo-seed 都要存在、大小與來源一致。
  const finalIndex = await indexFolders(DEST_BUCKET, destFolders);
  let totalBytes = 0;
  let present = 0;
  const stale = [];
  for (const ref of refs) {
    const source = sourceIndexes.get(ref.bucket).get(ref.path);
    const dest = finalIndex.get(`${ref.bucket}/${ref.path}`);
    if (dest && dest.size === source.size) {
      present += 1;
      totalBytes += dest.size;
    } else {
      stale.push(`${ref.bucket}/${ref.path}`);
    }
  }
  console.log(`[upload-demo-images] demo-seed 內已就緒 ${present}/${refs.length} 張，合計 ${formatMb(totalBytes)}。`);
  if (stale.length > 0) {
    console.error(`[upload-demo-images] 仍有 ${stale.length} 個物件缺少或大小不符${overwrite ? "" : "（內容不同的未覆寫，需要請加 --overwrite）"}：`);
    for (const line of stale) console.error(`  - ${line}`);
    process.exitCode = process.exitCode || (plan.different.length > 0 && !overwrite ? 2 : 1);
  }
}

main().then(
  () => {},
  (error) => {
    console.error(`[upload-demo-images] ${error instanceof UploadAbort ? error.message : `未預期錯誤：${error instanceof Error ? error.message : String(error)}`}`);
    process.exitCode = 1;
  },
);
