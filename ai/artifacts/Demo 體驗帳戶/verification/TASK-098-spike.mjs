// TASK-098 觸發器可行性實驗腳本。只操作自己建立的拋棄式帳號（app_metadata.spike098 = true），
// 不讀取、不登入、不修改 designer001 或任何其他帳號。與 TASK-098-spike.sql 交替執行，順序見該檔檔尾。
//
// 執行方式（專案根目錄）：
//   node --env-file=.env.local "ai/artifacts/Demo 體驗帳戶/verification/TASK-098-spike.mjs" <階段>
//
// 階段：
//   observe       觸發器為 observe 模式：所有操作預期都成功（建立基準），觸發器只記錄。結束時刪除拋棄式帳號。
//   block         觸發器為 block 模式：demo 帳號的改密碼／改 Email／重設密碼／啟用 MFA 預期被擋，
//                 登入、refresh、登出與對照組（非 demo）所有操作預期成功。結束時保留帳號與 session，
//                 供 SQL 步驟 5 測試 postgres 能否刪除 auth.sessions。
//   revoke-check  讀取 block 階段留下的 refresh token：demo 已被刪除 session，預期 refresh 失敗；對照組預期成功。
//   cleanup       刪除所有拋棄式帳號（可單獨重複執行，用來清除中斷後的殘留）。
//
// 輸出只有操作名稱、時間與錯誤碼／錯誤文字，不印密碼、token 或金鑰。
// Auth 信件（Email 變更確認、密碼重設）會真的寄出：收件人用 Resend 官方測試位址
// delivered+<標籤>@resend.dev（Supabase 的自訂 SMTP 是 Resend），不會寄到任何真人信箱。

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`[task-098-spike] ${message}`);
  process.exit(1);
}

if (!url || !anonKey || !serviceRoleKey) {
  fail("缺少 NEXT_PUBLIC_SUPABASE_URL／NEXT_PUBLIC_SUPABASE_ANON_KEY／SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local。");
}

const phase = process.argv[2];
if (!["observe", "block", "revoke-check", "cleanup"].includes(phase ?? "")) {
  fail("用法：node --env-file=.env.local <本檔> observe | block | revoke-check | cleanup");
}

const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, serviceRoleKey, clientOptions);
const newAnonClient = () => createClient(url, anonKey, clientOptions);

// 狀態檔放在系統暫存目錄（不在專案內、不進 git），內含拋棄式帳號的密碼與 refresh token，
// cleanup 階段會刪除。
const STATE_PATH = path.join(tmpdir(), "spike098-state.json");
const EMAIL_DOMAIN = "resend.dev";
const RATE_LIMIT_CODES = new Set(["over_email_send_rate_limit", "over_request_rate_limit"]);

const results = [];

function describeError(error) {
  return `status=${error.status ?? "?"} code=${error.code ?? "?"} message=${error.message ?? String(error)}`;
}

// expected：'success'（預期成功）、'error'（預期失敗／被擋）、'info'（只記錄，不判定）。
async function attempt(label, expected, fn) {
  const at = new Date().toISOString();
  let error = null;
  let value;
  try {
    value = await fn();
    error = value?.error ?? null;
  } catch (caught) {
    error = caught;
  }

  let verdict;
  if (expected === "info") verdict = "INFO";
  else if (error && RATE_LIMIT_CODES.has(error.code)) verdict = "INCONCLUSIVE";
  else if (expected === "success") verdict = error ? "FAIL" : "PASS";
  else verdict = error ? "PASS" : "FAIL";

  const detail = error ? `失敗：${describeError(error)}` : "成功";
  results.push({ at, label, expected, verdict, detail });
  console.log(`[${verdict.padEnd(12)}] ${at} ${label}（預期${{ success: "成功", error: "失敗", info: "不判定" }[expected]}）→ ${detail}`);
  return value;
}

function check(label, condition, detail) {
  const verdict = condition ? "PASS" : "FAIL";
  results.push({ at: new Date().toISOString(), label, expected: "check", verdict, detail });
  console.log(`[${verdict.padEnd(12)}] ${label} → ${detail}`);
}

function randomPassword() {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}

async function createSpikeUser(role, stamp) {
  const email = `delivered+spike098-${role}-${stamp}@${EMAIL_DOMAIN}`;
  const password = randomPassword();
  const appMetadata = role === "demo" ? { spike098: true, is_demo: true } : { spike098: true };
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: { name: `__TEST__spike098-${role}` },
  });
  if (error || !data?.user) fail(`建立 ${role} 拋棄式帳號失敗：${error ? describeError(error) : "沒有回傳使用者"}`);
  console.log(`[setup] 已建立 ${role} 拋棄式帳號 id=${data.user.id}`);
  return { role, id: data.user.id, email, password };
}

async function listSpikeUsers() {
  const found = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`列出使用者失敗：${describeError(error)}`);
    for (const user of data.users) {
      // 雙重條件：app_metadata 標記 + Email 含 spike098，絕不可能命中真實帳號。
      if (user.app_metadata?.spike098 === true && user.email?.includes("spike098")) found.push(user);
    }
    if (data.users.length < 200) break;
  }
  return found;
}

async function deleteUsers(users) {
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    console.log(`[cleanup] 刪除 ${user.email} → ${error ? describeError(error) : "完成"}`);
  }
}

// 對一個拋棄式帳號跑完整操作序列。mode = 'observe' 時全部預期成功；
// mode = 'block' 時 demo 的「變更憑證」類操作預期被擋，其餘（含 demo 的登入／refresh／登出）預期成功。
async function exercise(user, mode) {
  const locked = mode === "block" && user.role === "demo";
  const mutate = locked ? "error" : "success";
  const tag = `${user.role}`;
  const client = newAnonClient();
  const stamp = Date.now();

  await attempt(`${tag}: signInWithPassword`, "success", () =>
    client.auth.signInWithPassword({ email: user.email, password: user.password }),
  );
  await attempt(`${tag}: refreshSession`, "success", () => client.auth.refreshSession());

  const newPassword = randomPassword();
  const passwordResult = await attempt(`${tag}: updateUser({ password })`, mutate, () =>
    client.auth.updateUser({ password: newPassword }),
  );
  if (passwordResult && !passwordResult.error) user.password = newPassword;

  await attempt(`${tag}: updateUser({ email })`, mutate, () =>
    client.auth.updateUser({ email: `delivered+spike098-${user.role}-new-${stamp}@${EMAIL_DOMAIN}` }),
  );

  await attempt(`${tag}: resetPasswordForEmail`, mutate, () => newAnonClient().auth.resetPasswordForEmail(user.email));

  await attempt(`${tag}: mfa.enroll(totp)`, mutate, () => client.auth.mfa.enroll({ factorType: "totp" }));

  // 不帶 data 的 user_metadata 更新：不在鎖定欄位內，兩種模式都預期成功（只記錄，確認觸發器沒有擋太多）。
  await attempt(`${tag}: updateUser({ data }) 只改 user_metadata`, "success", () =>
    client.auth.updateUser({ data: { spike098_note: "metadata only" } }),
  );

  // admin API（service_role）也經過 GoTrue，架構筆記 D5 預期同樣被擋。
  const adminPassword = randomPassword();
  const adminPasswordResult = await attempt(`${tag}: admin.updateUserById({ password })`, mutate, () =>
    admin.auth.admin.updateUserById(user.id, { password: adminPassword }),
  );
  if (adminPasswordResult && !adminPasswordResult.error) user.password = adminPassword;

  // 讀回：被擋的帳號，Email／待確認 Email／重設密碼時間戳都不應該有變化。
  if (locked) {
    const { data, error } = await admin.auth.admin.getUserById(user.id);
    if (error || !data?.user) {
      check(`${tag}: 讀回帳號狀態`, false, error ? describeError(error) : "沒有回傳使用者");
    } else {
      check(`${tag}: 被擋後 Email 未改變`, data.user.email === user.email, `email 與建立時${data.user.email === user.email ? "相同" : "不同"}`);
      check(`${tag}: 被擋後沒有待確認的新 Email`, !data.user.new_email, `new_email ${data.user.new_email ? "有值" : "為空"}`);
      check(`${tag}: 被擋後沒有重設密碼紀錄`, !data.user.recovery_sent_at, `recovery_sent_at ${data.user.recovery_sent_at ? "有值" : "為空"}`);
    }
  }

  const adminEmail = `delivered+spike098-${user.role}-admin-${stamp}@${EMAIL_DOMAIN}`;
  const adminEmailResult = await attempt(`${tag}: admin.updateUserById({ email })`, mutate, () =>
    admin.auth.admin.updateUserById(user.id, { email: adminEmail, email_confirm: true }),
  );
  if (adminEmailResult && !adminEmailResult.error) user.email = adminEmail;

  // banned_until 不在鎖定欄位內：緊急關閉（D12）靠它，兩種模式都預期成功。
  await attempt(`${tag}: admin 設定 ban_duration`, "success", () =>
    admin.auth.admin.updateUserById(user.id, { ban_duration: "1h" }),
  );
  await attempt(`${tag}: admin 解除 ban`, "success", () => admin.auth.admin.updateUserById(user.id, { ban_duration: "none" }));

  // admin 設定電話（資訊用）：看 phone／phone_change 是否被擋；專案若未啟用電話登入可能因其他原因失敗，不判定。
  await attempt(`${tag}: admin.updateUserById({ phone })（資訊）`, "info", () =>
    // 電話欄位有唯一限制，兩個角色要用不同號碼（假號碼，不會收到簡訊）。
    admin.auth.admin.updateUserById(user.id, { phone: user.role === "demo" ? "+886900000098" : "+886900000099", phone_confirm: true }),
  );

  // 第二個 session：登入 → 本地登出，證明登入／登出沒有被誤擋，也證明被擋的帳號憑證沒有被改動
  // （用追蹤中的密碼再登入一次：demo 在 block 模式下必須仍是建立時的密碼）。
  const secondClient = newAnonClient();
  await attempt(`${tag}: 第二個 session signInWithPassword`, "success", () =>
    secondClient.auth.signInWithPassword({ email: user.email, password: user.password }),
  );
  await attempt(`${tag}: signOut({ scope: "local" })`, "success", () => secondClient.auth.signOut({ scope: "local" }));

  return client;
}

async function saveState(users, clients) {
  const state = { savedAt: new Date().toISOString(), users: {} };
  for (const user of users) {
    const { data } = await clients[user.role].auth.getSession();
    state.users[user.role] = { id: user.id, email: user.email, refreshToken: data.session?.refresh_token ?? null };
  }
  writeFileSync(STATE_PATH, JSON.stringify(state), { mode: 0o600 });
}

function loadState() {
  if (!existsSync(STATE_PATH)) fail("找不到狀態檔，請先執行 block 階段。");
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

function printSummary() {
  const count = (verdict) => results.filter((r) => r.verdict === verdict).length;
  console.log("\n===== 摘要 =====");
  console.log(`PASS ${count("PASS")}　FAIL ${count("FAIL")}　INCONCLUSIVE ${count("INCONCLUSIVE")}　INFO ${count("INFO")}`);
  if (count("FAIL") > 0) {
    console.log("FAIL 項目：");
    for (const r of results.filter((x) => x.verdict === "FAIL")) console.log(`  - ${r.label}：${r.detail}`);
  }
  if (count("INCONCLUSIVE") > 0) {
    console.log("INCONCLUSIVE（遇到寄信或請求限流，無法判定，需稍後重跑該階段）：");
    for (const r of results.filter((x) => x.verdict === "INCONCLUSIVE")) console.log(`  - ${r.label}：${r.detail}`);
  }
  process.exitCode = count("FAIL") > 0 ? 1 : 0;
}

async function runObserve() {
  const stamp = Date.now();
  const users = [await createSpikeUser("demo", stamp), await createSpikeUser("control", stamp)];
  try {
    for (const user of users) await exercise(user, "observe");
  } finally {
    await deleteUsers(await listSpikeUsers());
  }
  console.log("\n下一步：到 SQL Editor 執行「步驟 3」讀取紀錄，並把結果貼給我。");
}

async function runBlock() {
  const stamp = Date.now();
  const users = [await createSpikeUser("demo", stamp), await createSpikeUser("control", stamp)];
  const clients = {};
  for (const user of users) clients[user.role] = await exercise(user, "block");
  await saveState(users, clients);
  const demo = users.find((u) => u.role === "demo");
  console.log(
    `\ndemo 拋棄式帳號 id = ${demo.id}\n` +
      "下一步：1) 請你用自己的瀏覽器登入 designer001 一次並登出，回報結果；\n" +
      "        2) 到 SQL Editor 執行「步驟 5」（把 <DEMO_ID> 換成上面的 id）；\n" +
      "        3) 接著執行 revoke-check 階段。",
  );
}

async function runRevokeCheck() {
  const state = loadState();
  for (const role of ["demo", "control"]) {
    const entry = state.users[role];
    if (!entry?.refreshToken) {
      check(`${role}: 狀態檔含 refresh token`, false, "沒有 refresh token");
      continue;
    }
    await attempt(
      `${role}: 用 block 階段留下的 refresh token 做 refreshSession`,
      role === "demo" ? "error" : "success",
      () => newAnonClient().auth.refreshSession({ refresh_token: entry.refreshToken }),
    );
  }
  console.log("\n下一步：執行 cleanup 階段，再到 SQL Editor 執行「步驟 8」。");
}

async function runCleanup() {
  const users = await listSpikeUsers();
  console.log(`[cleanup] 找到 ${users.length} 個拋棄式帳號`);
  await deleteUsers(users);
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
  const remaining = await listSpikeUsers();
  check("cleanup: 沒有殘留的拋棄式帳號", remaining.length === 0, `剩餘 ${remaining.length} 個`);
}

async function main() {
  if (phase === "observe") await runObserve();
  else if (phase === "block") await runBlock();
  else if (phase === "revoke-check") await runRevokeCheck();
  else await runCleanup();
  printSummary();
}

main().catch((error) => fail(`未預期錯誤：${error instanceof Error ? error.message : String(error)}`));
