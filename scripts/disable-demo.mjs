// Demo 體驗帳戶的緊急關閉與恢復（TASK-111，架構筆記 D12）。執行方式：
//   npm run demo:disable                 只印出目前狀態與將要做的事，不寫入任何東西
//   npm run demo:disable -- --yes        真的關閉
//   npm run demo:enable                  只印出目前狀態與將要做的事
//   npm run demo:enable -- --yes         真的恢復
//
// 為什麼需要它：把 Vercel 的 DEMO_ENABLED 改成 false 只擋「新的進入」，已經發出去的 session 與 refresh token
// 仍然有效，持有者還是能用 REST 與 Storage 行使 is_admin() 的全部權限。所以另外提供這條立即止血的路徑。
//
// demo:disable 依序做三件事（每一步獨立執行，一步失敗不會阻止其他步驟，最後逐步回報並以退出碼 1 結束）：
//   1. 刪除 Demo 帳戶在 admins 的那一列。is_admin() 每次請求都重新判斷，所以這一步一完成，
//      所有已發出的 session 立刻失去全部管理權限。
//   2. 以 admin API 設定 ban_duration（封鎖登入與 refresh）。banned_until 不在 0021 觸發器的鎖定欄位內，所以可寫。
//   3. 呼叫 demo_revoke_sessions() 刪除 Demo 的 auth.sessions。
//   第 2 步刻意排在第 3 步之前：若先撤銷 session，在封鎖前的空檔訪客仍可重新登入拿到新 session，
//   而這個 session 在日後 demo:enable 重新登記 admins 之後又會變回管理員。
// demo:enable 反向：解除封鎖，再重新登記 admins（顯示名稱「Demo帳號」；頭像與其他個人資料由下一次每日還原補回）。
//
// 安全：
//   - 預設只印出計畫；沒有 --yes 不會寫入任何東西。
//   - 目標帳戶由「app_metadata.is_demo = true 且剛好 1 個」決定（與 demo_revoke_sessions() 同一規則），
//     不接受從命令列指定帳號，所以不可能對 designer001 或其他非 Demo 帳戶動手。
//   - 環境有設 DEMO_EMAIL 時，找到的 Demo 帳戶 Email 必須與它相同，否則中止。
//   - 密碼、service role key、token 全程不印出。
//
// 需要的環境變數：NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY（DEMO_EMAIL 選填，用來交叉檢查）。
// 這支腳本不會改變 Vercel 的環境變數，也不會重新部署；DEMO_ENABLED 與 Redeploy 見 docs/demo-account.md。

import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const DEMO_DISPLAY_NAME = "Demo帳號";
// 約 100 年；GoTrue 以 Go 的 duration 格式解析。解除封鎖用 "none"。
export const BAN_DURATION = "876000h";
const LIST_PAGE_SIZE = 200;

/** @param {string[]} argv */
export function parseArgs(argv) {
  let mode = null;
  let yes = false;
  for (const arg of argv) {
    if (arg === "--yes") yes = true;
    else if (arg === "--disable" || arg === "--enable") {
      const next = arg.slice(2);
      if (mode !== null && mode !== next) return { error: "--disable 與 --enable 不能同時使用" };
      mode = next;
    } else return { error: `不認得的參數：${arg}` };
  }
  if (mode === null) return { error: "必須指定 --disable 或 --enable（請用 npm run demo:disable／demo:enable）" };
  return { mode, yes };
}

/** @param {unknown} value */
function isActiveBan(value, now = Date.now()) {
  if (typeof value !== "string" || value === "") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > now;
}

// 回傳 { user } 或 { error }。呼叫端不得在 error 時繼續。
/** @param {import("@supabase/supabase-js").SupabaseClient} supabase @param {{ demoEmail?: string | null }} [options] */
export async function findDemoUser(supabase, { demoEmail = null } = {}) {
  const demoUsers = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
    if (error) return { error: `列出使用者失敗：${error.message}` };
    demoUsers.push(...data.users.filter((candidate) => candidate.app_metadata?.is_demo === true));
    if (data.users.length < LIST_PAGE_SIZE) break;
  }
  if (demoUsers.length === 0) {
    return { error: "找不到 Demo 帳戶（沒有任何帶 is_demo 標記的帳戶）。是否尚未執行 npm run seed:demo-account？" };
  }
  if (demoUsers.length > 1) {
    return {
      error:
        `找到 ${demoUsers.length} 個帶 is_demo 標記的帳戶，無法確定要動哪一個。` +
        "請先到 Supabase Dashboard 的 Authentication 清理多餘的帳戶（只應有 1 個 Demo 帳戶）。",
    };
  }
  const user = demoUsers[0];
  if (demoEmail && user.email?.toLowerCase() !== demoEmail.toLowerCase()) {
    return { error: "找到的 Demo 帳戶 Email 與環境變數 DEMO_EMAIL 不同，已中止（沒有任何變更）。請確認你連的是正確的專案。" };
  }
  return { user };
}

// 目前狀態：是否登記在 admins、是否被封鎖。讀取失敗回 { error }。
/** @param {import("@supabase/supabase-js").SupabaseClient} supabase @param {string} userId */
export async function readState(supabase, userId) {
  const adminRow = await supabase.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (adminRow.error) return { error: `查詢 admins 失敗：${adminRow.error.message}` };
  const fetched = await supabase.auth.admin.getUserById(userId);
  if (fetched.error || !fetched.data?.user) {
    return { error: `讀取帳戶失敗：${fetched.error?.message ?? "沒有回傳使用者"}` };
  }
  const user = fetched.data.user;
  if (user.app_metadata?.is_demo !== true) {
    return { error: "目標帳戶沒有 is_demo 標記，拒絕執行（本指令只對 Demo 帳戶有效）。" };
  }
  return { registered: adminRow.data !== null, banned: isActiveBan(user.banned_until), bannedUntil: user.banned_until ?? null };
}

/** @param {"disable" | "enable"} mode */
export function describePlan(mode) {
  return mode === "disable"
    ? [
        "1. 刪除 Demo 帳戶在 admins 的那一列（已發出的 session 立刻失去管理權限）",
        `2. 封鎖 Demo 帳戶（ban_duration ${BAN_DURATION}，無法登入與 refresh）`,
        "3. 呼叫 demo_revoke_sessions() 撤銷 Demo 的全部 session",
      ]
    : [
        "1. 解除 Demo 帳戶的封鎖（ban_duration none）",
        `2. 重新登記 Demo 帳戶到 admins（顯示名稱「${DEMO_DISPLAY_NAME}」；若已登記則略過）`,
      ];
}

/**
 * 每一步包 try/catch，失敗不中斷後面的步驟（緊急關閉時能做多少算多少）。
 * @param {string} name @param {() => Promise<string>} action
 */
async function step(name, action) {
  try {
    return { name, ok: true, detail: await action() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** @param {import("@supabase/supabase-js").SupabaseClient} supabase @param {string} userId */
export async function disableDemo(supabase, userId) {
  const steps = [];

  steps.push(
    await step("刪除 admins 登記", async () => {
      const { data, error } = await supabase.from("admins").delete().eq("user_id", userId).select("user_id");
      if (error) throw new Error(error.message);
      return data.length > 0 ? "已刪除 1 列" : "本來就沒有登記（略過）";
    }),
  );

  steps.push(
    await step("封鎖帳戶", async () => {
      const { error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION });
      if (error) throw new Error(error.message);
      return "已封鎖";
    }),
  );

  steps.push(
    await step("撤銷 session", async () => {
      const { data, error } = await supabase.rpc("demo_revoke_sessions");
      if (error) throw new Error(error.message);
      return `已撤銷 ${typeof data === "number" ? data : "?"} 個 session`;
    }),
  );

  // 事後重新讀一次，不信任各步驟的回傳。
  steps.push(
    await step("事後檢查", async () => {
      const state = await readState(supabase, userId);
      if ("error" in state) throw new Error(state.error);
      if (state.registered) throw new Error("admins 仍有登記");
      if (!state.banned) throw new Error("帳戶沒有被封鎖");
      return "admins 已無登記、帳戶處於封鎖狀態";
    }),
  );

  return { ok: steps.every((entry) => entry.ok), steps };
}

/** @param {import("@supabase/supabase-js").SupabaseClient} supabase @param {string} userId */
export async function enableDemo(supabase, userId) {
  const steps = [];

  steps.push(
    await step("解除封鎖", async () => {
      const { error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: "none" });
      if (error) throw new Error(error.message);
      return "已解除封鎖";
    }),
  );

  steps.push(
    await step("重新登記 admins", async () => {
      const existing = await supabase.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data) return "已登記（略過）";
      const { error } = await supabase.from("admins").insert({ user_id: userId, display_name: DEMO_DISPLAY_NAME });
      if (error) throw new Error(error.message);
      return `已登記，顯示名稱「${DEMO_DISPLAY_NAME}」`;
    }),
  );

  steps.push(
    await step("事後檢查", async () => {
      const state = await readState(supabase, userId);
      if ("error" in state) throw new Error(state.error);
      if (!state.registered) throw new Error("admins 沒有登記");
      if (state.banned) throw new Error("帳戶仍處於封鎖狀態");
      return "admins 已登記、帳戶未被封鎖";
    }),
  );

  return { ok: steps.every((entry) => entry.ok), steps };
}

function maskId(id) {
  return `${id.slice(0, 8)}…`;
}

function printSteps(steps) {
  for (const entry of steps) {
    console.log(`  [${entry.ok ? "OK" : "失敗"}] ${entry.name}：${entry.detail}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`[demo-switch] ${args.error}`);
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("[demo-switch] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
    process.exitCode = 1;
    return;
  }

  let host;
  try {
    host = new URL(url).host;
  } catch {
    console.error("[demo-switch] NEXT_PUBLIC_SUPABASE_URL 格式不正確。");
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const demoEmail = process.env.DEMO_EMAIL?.trim() || null;

  console.log(`[demo-switch] 目標專案：${host}`);
  if (!demoEmail) {
    console.warn("[demo-switch] 未設定 DEMO_EMAIL，略過 Email 交叉檢查（仍以 is_demo 且剛好 1 個帳戶為準）。");
  }

  const found = await findDemoUser(supabase, { demoEmail });
  if ("error" in found) {
    console.error(`[demo-switch] ${found.error}`);
    process.exitCode = 1;
    return;
  }
  const userId = found.user.id;

  const state = await readState(supabase, userId);
  if ("error" in state) {
    console.error(`[demo-switch] ${state.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[demo-switch] Demo 帳戶 ${maskId(userId)}：admins ${state.registered ? "已登記" : "未登記"}，${state.banned ? "已封鎖" : "未封鎖"}。`);
  console.log(`[demo-switch] 模式：${args.mode === "disable" ? "緊急關閉（disable）" : "恢復（enable）"}。將執行：`);
  for (const line of describePlan(args.mode)) console.log(`  ${line}`);

  if (!args.yes) {
    console.log(`[demo-switch] 這只是預覽，沒有寫入任何東西。要真的執行請加 --yes（npm run demo:${args.mode} -- --yes）。`);
    return;
  }

  const result = args.mode === "disable" ? await disableDemo(supabase, userId) : await enableDemo(supabase, userId);
  printSteps(result.steps);

  if (!result.ok) {
    console.error("[demo-switch] 有步驟失敗，請依上方訊息處理後重跑（本指令可安全重複執行）。");
    process.exitCode = 1;
    return;
  }

  if (args.mode === "disable") {
    console.log("[demo-switch] 完成：Demo 帳戶已失去管理權限並被封鎖。若要同時關閉登入頁入口，另外把 Vercel 的 DEMO_ENABLED 改為 false 並 Redeploy。");
    console.log("[demo-switch] 提醒：封鎖期間每日還原會在資料庫守門處失敗（Demo 不在 admins），資料庫不會被改動；長期關閉請一併關閉 DEMO_RESET_ENABLED 並 Redeploy。");
  } else {
    console.log("[demo-switch] 完成：Demo 帳戶已恢復。若入口先前被關閉，把 Vercel 的 DEMO_ENABLED 改回 true 並 Redeploy。");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
