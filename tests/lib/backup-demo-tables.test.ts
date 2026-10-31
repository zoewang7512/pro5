import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  STORAGE_BUCKETS,
  buildRestoreSql,
  createBackup,
  formatTimestamp,
  gitignoreCoversBackups,
  parseArgs,
  pickDollarTag,
  safeLocalPath,
  verifyBackupDir,
} from "../../scripts/backup-demo-tables.mjs";

// scripts/backup-demo-tables.mjs（TASK-117）：還原前的唯讀備份。
// 這裡只測純函式與用假 client 跑完整流程（不會連到任何真實專案）。

const SCRIPT_PATH = path.resolve(__dirname, "..", "..", "scripts", "backup-demo-tables.mjs");
const TABLE_NAMES = BACKUP_TABLES.map((t: { name: string }) => t.name);

// 外鍵：子表 → 父表（migration 0001、0017；admins 的父表在 auth schema，不在備份範圍）
const FOREIGN_KEYS: Array<[string, string]> = [
  ["appointments", "services"],
  ["appointments", "customers"],
  ["appointments", "designers"],
  ["designer_services", "designers"],
  ["designer_services", "services"],
  ["designer_leaves", "designers"],
  ["designer_portfolio_images", "designers"],
];

function emptyTables(): Record<string, unknown[]> {
  return Object.fromEntries(TABLE_NAMES.map((name: string) => [name, []]));
}

describe("備份表清單與外鍵順序", () => {
  it("涵蓋任務卡指定的 13 張表，且沒有重複", () => {
    expect([...TABLE_NAMES].sort()).toEqual(
      [
        "services",
        "designers",
        "designer_services",
        "designer_leaves",
        "designer_portfolio_images",
        "business_hours",
        "closed_dates",
        "booking_policy",
        "store_settings",
        "appointments",
        "customers",
        "audit_log",
        "admins",
      ].sort(),
    );
    expect(new Set(TABLE_NAMES).size).toBe(TABLE_NAMES.length);
  });

  it("插入順序：每個外鍵的父表都在子表之前", () => {
    for (const [child, parent] of FOREIGN_KEYS) {
      expect(TABLE_NAMES.indexOf(parent), `${parent} 應在 ${child} 之前`).toBeLessThan(TABLE_NAMES.indexOf(child));
    }
  });

  it("三個公開 bucket，不含私有的 demo-seed", () => {
    expect(STORAGE_BUCKETS).toEqual(["store-assets", "designer-assets", "admin-assets"]);
  });
});

describe("buildRestoreSql", () => {
  const meta = { generatedAt: "2026-10-31T00:00:00.000Z", projectHost: "example.supabase.co" };

  function statements(sql: string) {
    return sql.split("\n");
  }
  function indexOfLine(sql: string, startsWith: string) {
    return statements(sql).findIndex((line) => line.startsWith(startsWith));
  }

  it("單一交易：只有一個 begin、一個 commit，commit 是最後一句，之間沒有其他交易控制", () => {
    const sql = buildRestoreSql({ tables: emptyTables(), ...meta });
    const lines = statements(sql).filter((l) => !l.startsWith("--"));
    expect(lines.filter((l) => l === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l === "commit;")).toHaveLength(1);
    expect(lines.filter((l) => /^(rollback|savepoint|release)\b/i.test(l))).toHaveLength(0);
    expect(lines.filter((l) => l !== "").at(-1)).toBe("commit;");
    expect(indexOfLine(sql, "begin;")).toBeLessThan(indexOfLine(sql, "delete from"));
  });

  it("含警語：只在確認要回到備份時間點時，於 SQL Editor 以 postgres 角色執行", () => {
    const sql = buildRestoreSql({ tables: emptyTables(), ...meta });
    expect(sql).toContain("只在確認要回到備份時間點時，於 SQL Editor 以 postgres 角色執行");
    expect(sql).toContain("example.supabase.co");
  });

  it("順序：先暫停觸發器 → 子表先清空 → 父表先插入 → 啟用觸發器 → 核對筆數", () => {
    const tables = emptyTables();
    for (const name of TABLE_NAMES) tables[name] = [{ id: 1 }];
    const sql = buildRestoreSql({ tables, ...meta });

    const firstDisable = indexOfLine(sql, "alter table public.");
    const firstDelete = indexOfLine(sql, "delete from");
    const firstInsert = indexOfLine(sql, "insert into");
    const lastInsert = statements(sql).map((l, i) => (l.startsWith("insert into") ? i : -1)).filter((i) => i >= 0).at(-1)!;
    const firstEnable = indexOfLine(sql, "alter table public.services enable trigger user;");
    const check = indexOfLine(sql, "-- 核對筆數");
    expect(firstDisable).toBeLessThan(firstDelete);
    expect(firstDelete).toBeLessThan(firstInsert);
    expect(lastInsert).toBeLessThan(firstEnable);
    expect(firstEnable).toBeLessThan(check);

    const deletes = statements(sql).filter((l) => l.startsWith("delete from")).map((l) => l.replace(/^delete from public\.(\w+);$/, "$1"));
    expect(deletes).toEqual([...TABLE_NAMES].reverse());
    const inserts = [...sql.matchAll(/^insert into public\.(\w+)/gm)].map((m) => m[1]);
    expect(inserts).toEqual(TABLE_NAMES);
  });

  it("外鍵：產生的 delete 順序中子表在父表之前，insert 順序中父表在子表之前", () => {
    const tables = emptyTables();
    for (const name of TABLE_NAMES) tables[name] = [{ id: 1 }];
    const sql = buildRestoreSql({ tables, ...meta });
    const deletes = [...sql.matchAll(/^delete from public\.(\w+);$/gm)].map((m) => m[1]);
    const inserts = [...sql.matchAll(/^insert into public\.(\w+)/gm)].map((m) => m[1]);
    for (const [child, parent] of FOREIGN_KEYS) {
      expect(deletes.indexOf(child)).toBeLessThan(deletes.indexOf(parent));
      expect(inserts.indexOf(parent)).toBeLessThan(inserts.indexOf(child));
    }
  });

  it("空表只清空、不產生 insert；每張表仍有核對筆數", () => {
    const sql = buildRestoreSql({ tables: emptyTables(), ...meta });
    expect(sql).not.toMatch(/^insert into/m);
    expect((sql.match(/^delete from public\./gm) ?? []).length).toBe(TABLE_NAMES.length);
    for (const name of TABLE_NAMES) expect(sql).toContain(`${name} 筆數不符：預期 0`);
  });

  it("audit_log 用 overriding system value，並把識別欄位序號只往上調", () => {
    const tables = emptyTables();
    tables.audit_log = [{ id: 7, event_type: "a.b" }];
    tables.services = [{ id: "s1" }];
    const sql = buildRestoreSql({ tables, ...meta });
    expect(sql).toMatch(/insert into public\.audit_log overriding system value\n/);
    expect(sql).not.toMatch(/insert into public\.services overriding system value/);
    expect(sql).toContain("perform setval(v_seq, greatest(v_max, nextval(v_seq)));");
    // setval 在所有 insert 之後、commit 之前
    expect(sql.indexOf("perform setval")).toBeGreaterThan(sql.lastIndexOf("insert into"));
    expect(sql.indexOf("perform setval")).toBeLessThan(sql.lastIndexOf("commit;"));
  });

  it("筆數核對：預期筆數等於備份資料的筆數", () => {
    const tables = emptyTables();
    tables.appointments = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const sql = buildRestoreSql({ tables, ...meta });
    expect(sql).toContain("appointments 筆數不符：預期 3");
    expect(sql).toContain("if v_actual <> 3 then");
  });

  it("缺少任何一張表的備份資料 → 丟錯（不產生殘缺的 restore.sql）", () => {
    const tables = emptyTables();
    delete tables.customers;
    expect(() => buildRestoreSql({ tables, ...meta })).toThrow(/customers/);
  });

  it("跳脫：含引號、反斜線、換行、$$、dollar-quote 標籤、SQL 注入字串、emoji 的內容都能原樣取回", () => {
    const nasty = [
      "O'Brien",
      'say "hi"',
      "back\\slash \\n literal",
      "line1\nline2\r\nline3",
      "price $$ 100 and $1",
      "$bk$ closes early? $bk1$ also $bk2$",
      "'; drop table public.appointments; --",
      "emoji 💇‍♀️ 中文 行分隔",
      "$",
      "",
    ];
    const tables = emptyTables();
    tables.customers = nasty.map((name, i) => ({ id: `c${i}`, name }));
    tables.appointments = [{ id: "a1", note: nasty.join("|"), customer_email: "a'b@example.com" }];
    const sql = buildRestoreSql({ tables, ...meta });

    for (const tableName of ["customers", "appointments"]) {
      const match = new RegExp(
        `insert into public\\.${tableName}\\nselect \\* from jsonb_populate_recordset\\(null::public\\.${tableName}, \\$(\\w+)\\$([\\s\\S]*?)\\$\\1\\$::jsonb\\);`,
      ).exec(sql);
      expect(match, `${tableName} 的 insert 敘述`).not.toBeNull();
      const [, tag, body] = match!;
      expect(body).not.toContain(`$${tag}$`); // 標籤不會出現在內容裡，內容不可能提早結束引號
      expect(JSON.parse(body)).toEqual(tables[tableName]);
    }
  });

  it("每個 dollar-quote 標籤在整份檔案中只成對出現一次開頭與結尾", () => {
    const tables = emptyTables();
    tables.customers = [{ id: "c", name: "$bk$ x $bk$" }];
    const sql = buildRestoreSql({ tables, ...meta });
    const tag = /jsonb_populate_recordset\(null::public\.customers, \$(\w+)\$/.exec(sql)![1];
    expect(tag).not.toBe("bk");
    expect(sql.split(`$${tag}$`).length - 1).toBe(2);
  });
});

describe("pickDollarTag", () => {
  it("內容沒有衝突時用 bk；衝突時換標籤直到不衝突", () => {
    expect(pickDollarTag("[1,2]")).toBe("bk");
    expect(pickDollarTag("a $bk$ b")).toBe("bk1");
    expect(pickDollarTag("a $bk$ b $bk1$ c $bk2$")).toBe("bk3");
  });
});

describe("gitignoreCoversBackups", () => {
  it.each(["backups/", "/backups/", "backups", "/backups", "node_modules/\nbackups/\n.env", "x\r\nbackups/\r\n"])("接受：%j", (text) => {
    expect(gitignoreCoversBackups(text)).toBe(true);
  });
  it.each(["", "# backups/", "backup/", "backups/*.sql", "!backups/", "my-backups/", "backups.txt"])("不接受：%j", (text) => {
    expect(gitignoreCoversBackups(text)).toBe(false);
  });
  it("專案真正的 .gitignore 已排除 backups/", () => {
    const text = readFileSync(path.resolve(__dirname, "..", "..", ".gitignore"), "utf8");
    expect(gitignoreCoversBackups(text)).toBe(true);
  });
});

describe("safeLocalPath", () => {
  it("保留 bucket 與資料夾結構", () => {
    expect(safeLocalPath("designer-assets", "abc/portfolio/x.jpg")).toBe("storage/designer-assets/abc/portfolio/x.jpg");
    expect(safeLocalPath("admin-assets", "avatar/u.png")).toBe("storage/admin-assets/avatar/u.png");
  });
  it.each(["../escape.png", "a/../../b.png", "a//b.png", "/abs.png", "a/./b.png", "trailing/", ""])("拒絕不安全名稱：%j", (name) => {
    expect(() => safeLocalPath("store-assets", name)).toThrow();
  });
  it("Windows 不允許的字元與百分號編碼成 %XX", () => {
    expect(safeLocalPath("store-assets", 'a:b*c?d"e<f>g|h\\i%j.png')).toBe(
      "storage/store-assets/a%3Ab%2Ac%3Fd%22e%3Cf%3Eg%7Ch%5Ci%25j.png",
    );
  });
});

describe("parseArgs / formatTimestamp", () => {
  it("預設不帶 --yes；--yes 才為 true；不認得的參數 → 錯誤", () => {
    expect(parseArgs([])).toEqual({ yes: false });
    expect(parseArgs(["--yes"])).toEqual({ yes: true });
    expect(parseArgs(["--force"])).toHaveProperty("error");
    expect(parseArgs(["--yes", "extra"])).toHaveProperty("error");
  });
  it("時間戳不含冒號（Windows 資料夾名稱）", () => {
    expect(formatTimestamp(new Date("2026-10-31T12:34:56.789Z"))).toBe("20261031T123456Z");
  });
});

describe("腳本原始碼掃描：零寫入", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");

  it("沒有任何會寫入資料庫或 Storage 的呼叫", () => {
    // 雜湊物件的 update 只是餵資料給 SHA-256，不是資料庫寫入。
    const scanned = source.replace('createHash("sha256").update(data)', 'createHash("sha256")');
    const writeCalls = scanned.match(
      /\.(insert|update|upsert|delete|remove|upload|copy|move|createBucket|updateBucket|deleteBucket|emptyBucket|createSignedUploadUrl|uploadToSignedUrl)\s*\(/g,
    );
    expect(writeCalls).toBeNull();
  });

  it("沒有碰 auth admin API", () => {
    expect(source).not.toMatch(/auth\.admin/);
  });

  it("只呼叫唯讀的 demo_list_storage_objects 一支 RPC", () => {
    const rpcs = [...source.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(rpcs).toEqual(["demo_list_storage_objects"]);
    expect([...source.matchAll(/\.rpc\(/g)]).toHaveLength(1);
  });

  it("不印出金鑰：沒有任何 console 輸出引用 serviceRoleKey", () => {
    const consoleLines = source.split("\n").filter((line) => /console\.(log|error|warn)/.test(line));
    for (const line of consoleLines) expect(line).not.toMatch(/serviceRoleKey|SERVICE_ROLE/i);
  });

  it("開始前檢查 .gitignore，且檢查在建立 client 之前", () => {
    expect(source).toContain("gitignoreCoversBackups(gitignoreText)");
    expect(source.indexOf("gitignoreCoversBackups(gitignoreText)")).toBeLessThan(source.indexOf("createClient(url"));
  });
});

// ---------- 假 client：跑完整備份流程 ----------

type Row = Record<string, unknown>;
type Manifest = {
  tables: Array<{ name: string; rows: number }>;
  buckets: Array<{ bucket: string; objects: number; bytes: number }>;
  objects: Array<{ name: string; content_type: string | null; sha256: string }>;
};
type Result = { data?: unknown; count?: number; error: { message: string } | null };
type Thenable = { then: (resolve: (value: Result) => void) => void };
type QueryBuilder = Thenable & {
  select: (columns: string, options?: { head?: boolean }) => QueryBuilder;
  order: () => QueryBuilder;
  range: (from: number, to: number) => QueryBuilder;
};

type FakeData = {
  tables: Record<string, Row[]>;
  objects: Record<string, Array<{ name: string; content: string; type?: string }>>;
  mutateAfterFirstFetch?: () => void;
};

function makeFakeSupabase(data: FakeData) {
  const calls: string[] = [];
  let fetched = 0;
  const bytes = (s: string) => new TextEncoder().encode(s);

  function query(tableName: string) {
    const state = { head: false, range: null as [number, number] | null };
    const builder: QueryBuilder = {
      select(_columns: string, options?: { head?: boolean }) {
        state.head = Boolean(options?.head);
        return builder;
      },
      order() {
        return builder;
      },
      range(from: number, to: number) {
        state.range = [from, to];
        return builder;
      },
      then(resolve: (value: Result) => void) {
        const rows = data.tables[tableName];
        if (!rows) return resolve({ data: null, error: { message: `no such table ${tableName}` } });
        if (state.head) {
          calls.push(`count:${tableName}`);
          return resolve({ count: rows.length, error: null });
        }
        calls.push(`select:${tableName}`);
        fetched += 1;
        if (fetched === 1) data.mutateAfterFirstFetch?.();
        const [from, to] = state.range ?? [0, rows.length - 1];
        return resolve({ data: rows.slice(from, to + 1), error: null });
      },
    };
    return builder;
  }

  return {
    calls,
    from: (tableName: string) => query(tableName),
    rpc(name: string, args: { p_bucket: string }) {
      calls.push(`rpc:${name}:${args.p_bucket}`);
      const list = (data.objects[args.p_bucket] ?? []).map((o) => ({
        name: o.name,
        size: bytes(o.content).length,
        etag: `"etag-${o.name}"`,
        created_at: "2026-10-01T00:00:00Z",
        owner_id: null,
      }));
      return {
        range: (from: number, to: number): Thenable => ({
          then: (resolve) => resolve({ data: list.slice(from, to + 1), error: null }),
        }),
      };
    },
    storage: {
      from: (bucket: string) => ({
        async download(name: string) {
          calls.push(`download:${bucket}:${name}`);
          const found = data.objects[bucket]?.find((o) => o.name === name);
          if (!found) return { data: null, error: { message: "not found" } };
          return { data: new Blob([bytes(found.content)], { type: found.type ?? "image/png" }), error: null };
        },
      }),
    },
  };
}

describe("createBackup（假 client）", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "backup-demo-test-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function sampleData(): FakeData {
    const tables = emptyTables() as Record<string, Row[]>;
    tables.services = [{ id: "s1", name: "剪髮'造型" }];
    tables.customers = [{ id: "c1", name: "陳小美", email: "a@example.com" }];
    tables.appointments = [{ id: "a1", service_id: "s1", customer_id: "c1", customer_email: "a@example.com" }];
    // 超過單頁 1000 筆，驗證分頁
    tables.audit_log = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, event_type: "x.y" }));
    const objects = {
      "store-assets": [{ name: "logo.png", content: "LOGO" }],
      "designer-assets": [
        { name: "d1/avatar.jpg", content: "AVATAR", type: "image/jpeg" },
        { name: "d1/portfolio/p1.jpg", content: "P1", type: "image/jpeg" },
      ],
      "admin-assets": [],
    };
    return { tables, objects };
  }

  const now = new Date("2026-10-31T12:34:56.000Z");

  it("寫出 tables、storage、manifest、restore.sql、README，並在驗證後才改名為正式資料夾", async () => {
    const fake = makeFakeSupabase(sampleData());
    const { dir, manifest, counts } = (await createBackup({ supabase: fake, outputRoot: tmp, now, projectHost: "example.supabase.co" })) as unknown as { dir: string; manifest: Manifest; counts: Record<string, number> };

    expect(path.basename(dir)).toBe("20261031T123456Z");
    expect(existsSync(`${dir}.partial`)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(["README.md", "manifest.json", "restore.sql", "storage", "tables"]);
    expect(readdirSync(path.join(dir, "tables")).sort()).toEqual(TABLE_NAMES.map((n: string) => `${n}.json`).sort());

    // 筆數：與資料來源一致，含分頁
    expect(counts.audit_log).toBe(2500);
    const auditEntry = manifest.tables.find((t) => t.name === "audit_log");
    expect(auditEntry?.rows).toBe(2500);
    expect(JSON.parse(readFileSync(path.join(dir, "tables", "audit_log.json"), "utf8"))).toHaveLength(2500);
    expect(JSON.parse(readFileSync(path.join(dir, "tables", "services.json"), "utf8"))).toEqual([{ id: "s1", name: "剪髮'造型" }]);

    // 圖片：保留路徑、大小與內容
    expect(readFileSync(path.join(dir, "storage", "designer-assets", "d1", "portfolio", "p1.jpg"), "utf8")).toBe("P1");
    expect(readFileSync(path.join(dir, "storage", "store-assets", "logo.png"), "utf8")).toBe("LOGO");
    expect(manifest.buckets).toEqual([
      { bucket: "store-assets", objects: 1, bytes: 4 },
      { bucket: "designer-assets", objects: 2, bytes: 8 },
      { bucket: "admin-assets", objects: 0, bytes: 0 },
    ]);
    const avatar = manifest.objects.find((o) => o.name === "d1/avatar.jpg");
    expect(avatar?.content_type).toBe("image/jpeg");
    expect(avatar?.sha256).toMatch(/^[0-9a-f]{64}$/);

    // restore.sql 與 manifest 的雜湊一致
    expect(() => verifyBackupDir(dir)).not.toThrow();
    expect(readFileSync(path.join(dir, "restore.sql"), "utf8")).toContain("appointments 筆數不符：預期 1");
  });

  it("零寫入：假 client 只收到 count／select／唯讀 rpc／download", async () => {
    const fake = makeFakeSupabase(sampleData());
    await createBackup({ supabase: fake, outputRoot: tmp, now, projectHost: "example.supabase.co" });
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call).toMatch(/^(count:|select:|rpc:demo_list_storage_objects:|download:)/);
    }
    // 前後筆數比對：每張表開始前與結束後各數一次
    for (const name of TABLE_NAMES) expect(fake.calls.filter((c) => c === `count:${name}`)).toHaveLength(2);
  });

  it("備份期間資料筆數變動 → 中止，不留下正式資料夾", async () => {
    const data = sampleData();
    data.mutateAfterFirstFetch = () => {
      data.tables.customers.push({ id: "c2", name: "新顧客" });
    };
    const fake = makeFakeSupabase(data);
    await expect(createBackup({ supabase: fake, outputRoot: tmp, now, projectHost: "example.supabase.co" })).rejects.toThrow(/customers/);
    expect(existsSync(path.join(tmp, "20261031T123456Z"))).toBe(false);
  });

  it("圖片下載失敗 → 中止，正式資料夾不存在（只留 .partial）", async () => {
    const data = sampleData();
    const fake = makeFakeSupabase(data);
    // 清單說有 logo.png，但下載不到
    const originalFrom = fake.storage.from;
    fake.storage.from = (bucket: string) => ({
      ...originalFrom(bucket),
      download: async () => ({ data: null, error: { message: "boom" } }),
    });
    await expect(createBackup({ supabase: fake, outputRoot: tmp, now, projectHost: "example.supabase.co" })).rejects.toThrow(/下載/);
    expect(existsSync(path.join(tmp, "20261031T123456Z"))).toBe(false);
    expect(existsSync(path.join(tmp, "20261031T123456Z.partial"))).toBe(true);
  });

  it("下載內容大小與 Storage 回報不符 → 中止", async () => {
    const data = sampleData();
    const fake = makeFakeSupabase(data);
    const originalFrom = fake.storage.from;
    fake.storage.from = (bucket: string) => ({
      ...originalFrom(bucket),
      download: async () => ({ data: new Blob([new Uint8Array([1])]), error: null }),
    });
    await expect(createBackup({ supabase: fake, outputRoot: tmp, now, projectHost: "example.supabase.co" })).rejects.toThrow(/大小不符/);
  });

  it("輸出資料夾已存在 → 拒絕覆寫", async () => {
    mkdirSync(path.join(tmp, "20261031T123456Z"));
    const fake = makeFakeSupabase(sampleData());
    await expect(createBackup({ supabase: fake, outputRoot: tmp, now, projectHost: "example.supabase.co" })).rejects.toThrow(/已存在/);
    expect(fake.calls).toHaveLength(0);
  });

  it("verifyBackupDir：檔案被改動 → 雜湊不符", async () => {
    const fake = makeFakeSupabase(sampleData());
    const { dir } = await createBackup({ supabase: fake, outputRoot: tmp, now, projectHost: "example.supabase.co" });
    writeFileSync(path.join(dir, "tables", "services.json"), "[]\n", "utf8");
    expect(() => verifyBackupDir(dir)).toThrow(/services\.json/);
  });
});
