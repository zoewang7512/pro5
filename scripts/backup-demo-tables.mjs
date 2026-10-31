// 還原前備份腳本（TASK-117）：Supabase Free Plan 沒有專案備份，真實還原（整表覆寫）之前必須先自建備份。
// 執行方式：npm run demo:backup（會用 --env-file=.env.local 載入環境變數）。
//   --yes   不再詢問，直接開始（非互動環境必須帶）。
//
// **唯讀**：只對資料庫做 select，只呼叫唯讀的 demo_list_storage_objects，只從 Storage 下載，零寫入。
// 輸出到本機 backups/<時間戳>/（含顧客個資，已列入 .gitignore，絕不進 git；開始前會檢查，沒列入就中止）：
//   tables/<表>.json   各表全部資料列
//   storage/<bucket>/… 三個公開 bucket 的全部物件（保留相對路徑）
//   manifest.json      各表筆數與雜湊、各物件大小與雜湊
//   restore.sql        依外鍵順序、單一交易的還原腳本（最後手段，於 SQL Editor 以 postgres 角色執行）
//   README.md          如何還原資料庫與圖片
// 先寫進 backups/<時間戳>.partial，全部寫完並讀回驗證通過才改名，所以沒有 .partial 後綴的資料夾一定是完整的。
// 輸出與日誌不含任何金鑰；執行前先印出目標專案網址供確認。
//
// 備份的還原一律走 restore.sql，**不能**用 0024 的 Demo 還原函式：它為了不寄信，拒絕任何 customer_email 非 null 的預約。

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline/promises";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_DIR_NAME = "backups";
const PAGE_SIZE = 1000; // PostgREST 預設單次最多回傳 1000 列
const DOWNLOAD_CONCURRENCY = 4;
const DOWNLOAD_ATTEMPTS = 3;

// 順序即「還原時的插入順序」：父表在前、子表在後（appointments 的三個外鍵都沒有 on delete）。
// 清空時用相反順序。audit_log 的 id 是 generated always as identity，插入要 overriding system value。
export const BACKUP_TABLES = [
  { name: "services", orderBy: ["id"] },
  { name: "designers", orderBy: ["id"] },
  { name: "designer_services", orderBy: ["designer_id", "service_id"] },
  { name: "designer_leaves", orderBy: ["designer_id", "date"] },
  { name: "designer_portfolio_images", orderBy: ["id"] },
  { name: "business_hours", orderBy: ["weekday"] },
  { name: "closed_dates", orderBy: ["date"] },
  { name: "booking_policy", orderBy: ["id"] },
  { name: "store_settings", orderBy: ["id"] },
  { name: "customers", orderBy: ["id"] },
  { name: "appointments", orderBy: ["id"] },
  { name: "audit_log", orderBy: ["id"], identityColumn: "id" },
  { name: "admins", orderBy: ["user_id"] },
];

export const STORAGE_BUCKETS = ["store-assets", "designer-assets", "admin-assets"];

export function fail(message) {
  console.error(`[backup-demo-tables] ${message}`);
  process.exit(1);
}

export function parseArgs(argv) {
  const parsed = { yes: false };
  for (const arg of argv) {
    if (arg === "--yes") parsed.yes = true;
    else return { error: `不認得的參數：${arg}（只接受 --yes）` };
  }
  return parsed;
}

// 2026-10-31T12:34:56.789Z → 20261031T123456Z（Windows 資料夾名稱不能有冒號）
export function formatTimestamp(date) {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

// .gitignore 是否排除了 backups/（接受 backups/、/backups/、backups、/backups，忽略註解與空行；否定規則不算）
export function gitignoreCoversBackups(text) {
  return text.split(/\r?\n/).some((line) => {
    const rule = line.trim();
    return rule === "backups/" || rule === "/backups/" || rule === "backups" || rule === "/backups";
  });
}

// 以 git 本身再確認一次輸出資料夾真的被忽略；git 不存在或不在版控內時回傳 null（交給 .gitignore 文字檢查）。
function gitSaysIgnored(repoRoot, targetPath) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", targetPath], { cwd: repoRoot, stdio: "ignore" });
    return true;
  } catch (error) {
    if (error && error.status === 1) return false;
    return null;
  }
}

// ---------- restore.sql ----------

// 挑一個不會出現在內容裡的 dollar-quote 標籤，內容就不需要任何跳脫。
export function pickDollarTag(content) {
  let tag = "bk";
  for (let i = 1; content.includes(`$${tag}$`); i += 1) tag = `bk${i}`;
  return tag;
}

function insertStatement(table, rows) {
  const json = JSON.stringify(rows);
  const tag = pickDollarTag(json);
  const overriding = table.identityColumn ? " overriding system value" : "";
  return (
    `insert into public.${table.name}${overriding}\n` +
    `select * from jsonb_populate_recordset(null::public.${table.name}, $${tag}$${json}$${tag}$::jsonb);`
  );
}

export function buildRestoreSql({ tables, generatedAt, projectHost }) {
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(tables[table.name])) throw new Error(`缺少資料表 ${table.name} 的備份資料`);
  }
  const insertOrder = BACKUP_TABLES;
  const deleteOrder = [...BACKUP_TABLES].reverse();
  const lines = [];

  lines.push(
    `-- ============================================================`,
    `-- restore.sql — 由 scripts/backup-demo-tables.mjs 於 ${generatedAt} 產生（來源專案：${projectHost}）`,
    `-- ============================================================`,
    `-- ★★ 危險：這支腳本會把下列資料表「整表清空」後換回備份時間點的內容，備份之後新增與修改的資料全部消失。`,
    `--    只在確認要回到備份時間點時，於 SQL Editor 以 postgres 角色執行。這是最後手段，不是日常工具。`,
    `--    檔案內含顧客個資，不要貼到任何對話、Issue 或公開位置。`,
    `--`,
    `-- 涵蓋範圍：${insertOrder.map((t) => t.name).join("、")}。`,
    `-- 不涵蓋：auth.users 等 auth schema（admins 的 user_id 必須仍存在於 auth.users，否則外鍵失敗、整個交易回滾）。`,
    `--`,
    `-- 安全設計：`,
    `--   * 單一交易（begin … commit）。任何一步失敗，整個交易回滾，資料維持執行前的樣子。`,
    `--   * 先以 alter table … disable trigger user 暫停被覆寫表上的「使用者觸發器」（寄信 webhook、價格快照、更新時間等），`,
    `--     結尾再啟用；這是交易的一部分，失敗會一併回滾。外鍵檢查不是使用者觸發器，不會被暫停。`,
    `--     （不使用 session_replication_role：SQL Editor 的 postgres 角色不一定能設定。）`,
    `--     若出現 must be owner of table，表示目前角色不是資料表擁有者，請切換成 postgres 再執行。`,
    `--     這支腳本結尾會啟用被覆寫表上「全部」使用者觸發器；執行前若有人刻意停用過某個觸發器，執行後會變成啟用。`,
    `--   * 交易內有鎖：lock_timeout 10 秒，搶不到鎖就失敗而不是卡住；執行期間前台預約寫入會短暫等待。`,
    `--   * 結尾逐表核對筆數，與備份清單不符就 raise exception 回滾。`,
    `--   * audit_log 的識別欄位序號只會往上調，不會降低。`,
    `--`,
    `-- 圖片：本腳本只還原資料庫。Storage 圖片在備份資料夾的 storage/<bucket>/ 下（manifest.json 有清單與雜湊）；`,
    `--   還原後若發現圖片遺失，依備份資料夾 README.md 的說明重新上傳到同一個 bucket、同一個路徑。`,
    `-- ============================================================`,
    ``,
    `begin;`,
    `set local lock_timeout = '10s';`,
    ``,
    `-- 暫停使用者觸發器（寄信、價格快照、更新時間…）`,
    ...insertOrder.map((t) => `alter table public.${t.name} disable trigger user;`),
    ``,
    `-- 清空（子表在前）`,
    ...deleteOrder.map((t) => `delete from public.${t.name};`),
    ``,
    `-- 灌入備份（父表在前）`,
  );

  for (const table of insertOrder) {
    const rows = tables[table.name];
    lines.push(`-- ${table.name}：${rows.length} 筆`);
    if (rows.length > 0) lines.push(insertStatement(table, rows));
  }

  lines.push(``, `-- 啟用使用者觸發器`);
  for (const table of insertOrder) lines.push(`alter table public.${table.name} enable trigger user;`);

  const identityTables = BACKUP_TABLES.filter((t) => t.identityColumn);
  for (const table of identityTables) {
    lines.push(
      ``,
      `-- ${table.name}.${table.identityColumn} 的序號：只往上調（nextval 會多耗掉一個值，留下空號無妨）`,
      `do $$`,
      `declare`,
      `  v_seq regclass := pg_get_serial_sequence('public.${table.name}', '${table.identityColumn}')::regclass;`,
      `  v_max bigint;`,
      `begin`,
      `  select max(${table.identityColumn}) into v_max from public.${table.name};`,
      `  if v_seq is not null and v_max is not null then`,
      `    perform setval(v_seq, greatest(v_max, nextval(v_seq)));`,
      `  end if;`,
      `end $$;`,
    );
  }

  lines.push(
    ``,
    `-- 核對筆數：與備份清單不符就中止並回滾`,
    `do $$`,
    `declare`,
    `  v_actual bigint;`,
    `begin`,
  );
  for (const table of insertOrder) {
    const expected = tables[table.name].length;
    lines.push(
      `  select count(*) into v_actual from public.${table.name};`,
      `  if v_actual <> ${expected} then`,
      `    raise exception '${table.name} 筆數不符：預期 ${expected}、實際 %', v_actual;`,
      `  end if;`,
    );
  }
  lines.push(`end $$;`, ``, `commit;`, ``);

  return lines.join("\n");
}

// ---------- 本機路徑 ----------

// Storage 物件名稱 → 本機相對路徑（保留 bucket 與資料夾結構）。
// 拒絕空片段、"."、".."，並把 Windows 不允許的字元與百分號編碼成 %XX，避免寫出備份資料夾之外。
export function safeLocalPath(bucket, objectName) {
  if (typeof objectName !== "string" || objectName.length === 0) throw new Error("物件名稱為空");
  const segments = objectName.split("/");
  const safe = segments.map((segment) => {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`物件名稱含不安全的片段：${JSON.stringify(objectName)}`);
    }
    return segment.replace(/[<>:"\\|?*%\u0000-\u001f]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  });
  return ["storage", bucket, ...safe].join("/");
}

// ---------- 備份主流程（可注入 supabase client 與輸出位置，供測試） ----------

async function countRows(supabase, tableName) {
  const { count, error } = await supabase.from(tableName).select("*", { count: "exact", head: true });
  if (error) throw new Error(`讀取 ${tableName} 筆數失敗：${error.message}`);
  return count ?? 0;
}

async function fetchAllRows(supabase, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table.name).select("*");
    for (const column of table.orderBy) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`讀取 ${table.name} 失敗：${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function listObjects(supabase, bucket) {
  const objects = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("demo_list_storage_objects", { p_bucket: bucket })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`列出 ${bucket} 的物件失敗：${error.message}`);
    objects.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return objects;
}

async function downloadObject(supabase, bucket, name) {
  let lastError = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.storage.from(bucket).download(name);
    if (!error && data) {
      return { buffer: Buffer.from(await data.arrayBuffer()), contentType: data.type || null };
    }
    lastError = error;
  }
  throw new Error(`下載 ${bucket}/${name} 失敗：${lastError?.message ?? "未知錯誤"}`);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function writeTableFile(file, rows) {
  // 一列一行，方便人工檢視；JSON 本身仍是合法的陣列。
  const body = rows.length === 0 ? "[]\n" : `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
  writeFileSync(file, body, "utf8");
  return Buffer.from(body, "utf8");
}

function readmeText({ generatedAt, projectHost, dirName }) {
  return [
    `# 備份 ${dirName}`,
    ``,
    `- 產生時間：${generatedAt}`,
    `- 來源專案：${projectHost}`,
    `- 這個資料夾含顧客個資，只放本機，不要上傳、不要提交進 git（\`backups/\` 已列入 .gitignore）。`,
    ``,
    `## 內容`,
    ``,
    `- \`tables/<表>.json\`：各表全部資料列。`,
    `- \`storage/<bucket>/…\`：三個公開 bucket（${STORAGE_BUCKETS.join("、")}）的全部物件，路徑與 Storage 內相同（Windows 不允許的字元以 %XX 編碼，原始名稱見 manifest.json）。`,
    `- \`manifest.json\`：各表筆數與 SHA-256、各物件大小與 SHA-256、restore.sql 的 SHA-256。`,
    `- \`restore.sql\`：還原資料庫的腳本。`,
    ``,
    `## 還原資料庫（最後手段）`,
    ``,
    `1. 先確認真的要回到備份時間點：備份之後新增與修改的資料會全部消失。`,
    `2. 先用 manifest.json 核對檔案沒有被改過（對 restore.sql 與 tables/*.json 重算 SHA-256）。`,
    `3. 打開 Supabase Dashboard 的 SQL Editor（角色 postgres），貼上 restore.sql 全文執行。`,
    `4. 它是單一交易，失敗會整個回滾；成功後結尾已核對各表筆數。`,
    `5. 寄信觸發器由腳本在交易內暫停再啟用，還原期間不會對顧客寄信。`,
    ``,
    `## 還原圖片`,
    ``,
    `restore.sql 只還原資料庫。若真實還原後圖片遺失（例如被孤兒清理刪掉），把 \`storage/<bucket>/<路徑>\` 重新上傳到同一個 bucket、同一個路徑（路徑以 manifest.json 的 \`objects[].name\` 為準）：`,
    ``,
    `- Dashboard → Storage → 選 bucket → 依資料夾上傳；或`,
    `- 用 service role 對該 bucket 呼叫 Storage 的 upload 方法，帶 \`upsert: true\` 與 \`contentType\`（示意，未實測；Content-Type 見 manifest.json 的 \`objects[].content_type\`）。`,
    ``,
    `## 何時可以刪除這份備份`,
    ``,
    `由使用者決定。建議：真實還原成功、回歸測試全過、前台與後台人工檢查無誤，並確認不再需要回到這個時間點之後，再整個資料夾一併刪除（含個資，刪除後不可復原）。`,
    ``,
  ].join("\n");
}

export async function createBackup({ supabase, outputRoot, now, projectHost, log = () => {} }) {
  const stamp = formatTimestamp(now);
  const generatedAt = now.toISOString();
  const finalDir = path.join(outputRoot, stamp);
  const workDir = `${finalDir}.partial`;
  if (existsSync(finalDir) || existsSync(workDir)) throw new Error(`輸出資料夾已存在：${finalDir}（請稍後再試）`);

  // 1. 開始前的筆數與物件清單（備份結束後再比對一次：資料在備份期間被改動就中止）
  log("讀取筆數與物件清單…");
  const countsBefore = {};
  for (const table of BACKUP_TABLES) countsBefore[table.name] = await countRows(supabase, table.name);
  const objectsBefore = {};
  for (const bucket of STORAGE_BUCKETS) objectsBefore[bucket] = await listObjects(supabase, bucket);

  // 2. 匯出資料表
  mkdirSync(path.join(workDir, "tables"), { recursive: true });
  const tables = {};
  const tableEntries = [];
  for (const table of BACKUP_TABLES) {
    const rows = await fetchAllRows(supabase, table);
    if (rows.length !== countsBefore[table.name]) {
      throw new Error(`${table.name} 讀到 ${rows.length} 筆，與開始前的筆數 ${countsBefore[table.name]} 不同（備份期間資料有變動？請重跑）`);
    }
    tables[table.name] = rows;
    const relativeFile = `tables/${table.name}.json`;
    const buffer = writeTableFile(path.join(workDir, relativeFile), rows);
    tableEntries.push({ name: table.name, rows: rows.length, file: relativeFile, sha256: sha256Hex(buffer) });
    log(`  ${table.name}：${rows.length} 筆`);
  }

  // 3. 下載圖片
  const objectEntries = [];
  const seenLocal = new Set();
  for (const bucket of STORAGE_BUCKETS) {
    const list = objectsBefore[bucket];
    for (const item of list) {
      const relative = safeLocalPath(bucket, item.name);
      const key = relative.toLowerCase(); // Windows／macOS 檔案系統不分大小寫
      if (seenLocal.has(key)) throw new Error(`本機路徑衝突（大小寫不同的同名物件）：${bucket}/${item.name}`);
      seenLocal.add(key);
    }
    log(`下載 ${bucket}：${list.length} 個物件…`);
    const entries = await mapWithConcurrency(list, DOWNLOAD_CONCURRENCY, async (item) => {
      const relative = safeLocalPath(bucket, item.name);
      const { buffer, contentType } = await downloadObject(supabase, bucket, item.name);
      if (item.size !== null && item.size !== undefined && Number(item.size) !== buffer.length) {
        throw new Error(`${bucket}/${item.name} 大小不符：Storage 回報 ${item.size}、實際下載 ${buffer.length}`);
      }
      const target = path.join(workDir, ...relative.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, buffer);
      return {
        bucket,
        name: item.name,
        file: relative,
        size: buffer.length,
        sha256: sha256Hex(buffer),
        content_type: contentType,
        etag: item.etag ?? null,
        created_at: item.created_at ?? null,
        owner_id: item.owner_id ?? null,
      };
    });
    objectEntries.push(...entries);
  }

  // 4. 備份期間資料沒有變動才算數
  for (const table of BACKUP_TABLES) {
    const after = await countRows(supabase, table.name);
    if (after !== countsBefore[table.name]) {
      throw new Error(`${table.name} 的筆數在備份期間由 ${countsBefore[table.name]} 變成 ${after}（請重跑）`);
    }
  }
  for (const bucket of STORAGE_BUCKETS) {
    const after = await listObjects(supabase, bucket);
    if (after.length !== objectsBefore[bucket].length) {
      throw new Error(`${bucket} 的物件數在備份期間由 ${objectsBefore[bucket].length} 變成 ${after.length}（請重跑）`);
    }
  }

  // 5. restore.sql、README、manifest
  const restoreSql = buildRestoreSql({ tables, generatedAt, projectHost });
  writeFileSync(path.join(workDir, "restore.sql"), restoreSql, "utf8");
  writeFileSync(path.join(workDir, "README.md"), readmeText({ generatedAt, projectHost, dirName: stamp }), "utf8");
  const manifest = {
    version: 1,
    generated_at: generatedAt,
    project_host: projectHost,
    tables: tableEntries,
    buckets: STORAGE_BUCKETS.map((bucket) => {
      const mine = objectEntries.filter((entry) => entry.bucket === bucket);
      return { bucket, objects: mine.length, bytes: mine.reduce((sum, entry) => sum + entry.size, 0) };
    }),
    objects: objectEntries,
    restore_sql: { file: "restore.sql", sha256: sha256Hex(Buffer.from(restoreSql, "utf8")) },
  };
  writeFileSync(path.join(workDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // 6. 讀回驗證：檔案可讀、雜湊與筆數一致、restore.sql 結構完整
  verifyBackupDir(workDir);

  renameSync(workDir, finalDir);
  return { dir: finalDir, manifest, counts: countsBefore };
}

// 讀回驗證（也供測試與日後人工核對使用）：任何不符都 throw。
export function verifyBackupDir(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  for (const entry of manifest.tables) {
    const buffer = readFileSync(path.join(dir, ...entry.file.split("/")));
    if (sha256Hex(buffer) !== entry.sha256) throw new Error(`${entry.file} 雜湊不符`);
    const rows = JSON.parse(buffer.toString("utf8"));
    if (!Array.isArray(rows) || rows.length !== entry.rows) throw new Error(`${entry.file} 筆數不符`);
  }
  for (const entry of manifest.objects) {
    const buffer = readFileSync(path.join(dir, ...entry.file.split("/")));
    if (buffer.length !== entry.size || sha256Hex(buffer) !== entry.sha256) throw new Error(`${entry.file} 大小或雜湊不符`);
  }
  const sql = readFileSync(path.join(dir, manifest.restore_sql.file));
  if (sha256Hex(sql) !== manifest.restore_sql.sha256) throw new Error("restore.sql 雜湊不符");
  const text = sql.toString("utf8");
  if (!/^begin;$/m.test(text) || !/^commit;$/m.test(text)) throw new Error("restore.sql 缺少交易包覆");
  return manifest;
}

// ---------- 指令列 ----------

async function confirmStart(host, autoYes) {
  if (autoYes) return;
  if (!process.stdin.isTTY) fail("非互動環境請加 --yes 明確同意（會從上述專案讀取全部資料與圖片到本機）。");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`[backup-demo-tables] 目標專案 ${host}。唯讀備份到本機，繼續？(y/N) `);
  rl.close();
  if (answer.trim().toLowerCase() !== "y") fail("已取消，沒有讀取或寫入任何東西。");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) fail(args.error);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
  }
  let projectHost;
  try {
    projectHost = new URL(url).host;
  } catch {
    fail("NEXT_PUBLIC_SUPABASE_URL 格式不正確。");
  }

  // 備份含個資：沒有排除 backups/ 就不動手。
  const gitignorePath = path.join(REPO_ROOT, ".gitignore");
  const gitignoreText = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!gitignoreCoversBackups(gitignoreText)) {
    fail(".gitignore 沒有排除 backups/，備份含顧客個資、不得進 git。請先加入再重跑。");
  }
  const outputRoot = path.join(REPO_ROOT, BACKUP_DIR_NAME);
  if (gitSaysIgnored(REPO_ROOT, `${BACKUP_DIR_NAME}/probe`) === false) {
    fail("git 回報 backups/ 沒有被忽略（.gitignore 可能被後面的規則取消）。請修正後重跑。");
  }

  console.log(`[backup-demo-tables] 目標專案：${projectHost}`);
  console.log(`[backup-demo-tables] 輸出位置：${path.join(BACKUP_DIR_NAME, "<時間戳>")}（只讀取，對資料庫與 Storage 零寫入）`);
  await confirmStart(projectHost, args.yes);

  const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  mkdirSync(outputRoot, { recursive: true });
  const { dir, manifest } = await createBackup({
    supabase,
    outputRoot,
    now: new Date(),
    projectHost,
    log: (message) => console.log(`[backup-demo-tables] ${message}`),
  });

  console.log(`[backup-demo-tables] 完成並已讀回驗證：${path.relative(REPO_ROOT, dir)}`);
  console.log("[backup-demo-tables] 資料表筆數：");
  for (const entry of manifest.tables) {
    console.log(`  ${entry.name.padEnd(26)} ${String(entry.rows).padStart(6)} 筆  sha256:${entry.sha256.slice(0, 12)}`);
  }
  console.log("[backup-demo-tables] 圖片：");
  for (const bucket of manifest.buckets) {
    console.log(`  ${bucket.bucket.padEnd(16)} ${String(bucket.objects).padStart(5)} 個  ${bucket.bytes} bytes`);
  }
  console.log(`[backup-demo-tables] restore.sql sha256:${manifest.restore_sql.sha256.slice(0, 12)}`);
  console.log("[backup-demo-tables] 備份含顧客個資：只放本機，不要上傳或提交。何時可刪由使用者決定（見備份資料夾的 README.md）。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => {
      process.exitCode = 0;
    },
    (error) => {
      console.error(`[backup-demo-tables] ${error instanceof Error ? error.message : String(error)}`);
      console.error("[backup-demo-tables] 若有 backups/<時間戳>.partial，代表備份未完成，不可當成有效備份。");
      process.exitCode = 1;
    },
  );
}
