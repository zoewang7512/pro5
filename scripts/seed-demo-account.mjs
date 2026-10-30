// 一次性腳本：建立（或檢查）Demo 體驗帳戶，標記 app_metadata.is_demo、登記 admins、設定顯示名稱。
// 執行方式：npm run seed:demo-account（會用 --env-file=.env.local 載入環境變數）。
//
// 需要的環境變數：NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、DEMO_EMAIL、DEMO_PASSWORD。
//   - DEMO_PASSWORD 至少 32 字元；DEMO_EMAIL 不得等於 DESIGNER_EMAIL（不分大小寫）。
//   - DEMO_EMAIL 會顯示在後台的帳號設定頁，等於公開：必須是你自己控制的信箱，
//     否則資料庫鎖定失效時，密碼重設信會寄給第三方。
//
// 冪等：帳戶已存在且是 Demo 帳戶時略過建立，只補登記 admins、顯示名稱，並清掉 MFA factor。
// 絕不把既有的非 Demo 帳戶轉成 Demo，也不改它的密碼；已存在的帳戶一律不改密碼。
// TASK-100 的觸發器啟用後，admin API 也無法改 Demo 的密碼與 Email（同樣經過 GoTrue），
// 要輪換密碼只能走 SQL Editor（手冊見 TASK-111）。
// 密碼、service role key、token 全程不印出。

import { createClient } from "@supabase/supabase-js";

const DEMO_DISPLAY_NAME = "Demo帳號";
const MIN_PASSWORD_LENGTH = 32;
const LIST_PAGE_SIZE = 200;

// 啟動時的輸入檢查（還沒有任何網路連線）直接結束；連線之後的失敗改丟例外、只設 exitCode，
// 不在連線還開著時呼叫 process.exit()（Windows 上 Node 會以 0xC0000409 崩潰，退出碼就不可靠）。
function fail(message) {
  console.error(`[seed-demo-account] ${message}`);
  process.exit(1);
}

class SeedAbort extends Error {}

function abort(message) {
  throw new SeedAbort(message);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.DEMO_EMAIL?.trim();
const password = process.env.DEMO_PASSWORD;
const designerEmail = process.env.DESIGNER_EMAIL?.trim();

if (!url || !serviceRoleKey) {
  fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
}
if (!email || !password) {
  fail("缺少 DEMO_EMAIL 或 DEMO_PASSWORD，請先填入 .env.local 再執行。");
}
if (!email.includes("@")) {
  fail("DEMO_EMAIL 不是有效的 Email 格式。");
}
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`DEMO_PASSWORD 長度需至少 ${MIN_PASSWORD_LENGTH} 字元，請換一組長隨機值後再執行。`);
}
if (designerEmail && email.toLowerCase() === designerEmail.toLowerCase()) {
  fail("DEMO_EMAIL 不得與 DESIGNER_EMAIL 相同（不分大小寫），已中止，資料庫沒有任何變更。");
}
if (!designerEmail) {
  console.warn(
    "[seed-demo-account] 未設定 DESIGNER_EMAIL，無法比對 DEMO_EMAIL 是否與設計師帳號衝突；" +
      "請自行確認 DEMO_EMAIL 不是真實管理員的信箱。",
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
    if (error) {
      abort(`列出使用者失敗：${error.message}`);
    }
    users.push(...data.users);
    if (data.users.length < LIST_PAGE_SIZE) return users;
  }
}

async function ensureAdminRegistered(userId) {
  const { data: existing, error: selectError } = await supabase
    .from("admins")
    .select("user_id, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError) {
    abort(`查詢 admins 表失敗：${selectError.message}`);
  }

  if (!existing) {
    const { error: insertError } = await supabase
      .from("admins")
      .insert({ user_id: userId, display_name: DEMO_DISPLAY_NAME });
    if (insertError) {
      abort(`寫入 admins 表失敗：${insertError.message}`);
    }
    console.log(`[seed-demo-account] 已登記為管理員，顯示名稱「${DEMO_DISPLAY_NAME}」。`);
    return;
  }

  if (existing.display_name === DEMO_DISPLAY_NAME) {
    console.log("[seed-demo-account] admins 表已登記，顯示名稱正確，略過。");
    return;
  }

  // 只更新這個帳戶那一列。
  const { error: updateError } = await supabase
    .from("admins")
    .update({ display_name: DEMO_DISPLAY_NAME })
    .eq("user_id", userId);
  if (updateError) {
    abort(`更新 admins 顯示名稱失敗：${updateError.message}`);
  }
  console.log(`[seed-demo-account] admins 已登記，顯示名稱已改為「${DEMO_DISPLAY_NAME}」。`);
}

async function removeMfaFactors(userId) {
  const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
  if (error) {
    abort(`列出 MFA factor 失敗：${error.message}`);
  }
  const factors = data?.factors ?? [];
  if (factors.length === 0) {
    console.log("[seed-demo-account] 沒有 MFA factor。");
    return;
  }
  for (const factor of factors) {
    const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (deleteError) {
      abort(`刪除 MFA factor 失敗：${deleteError.message}`);
    }
  }
  console.log(`[seed-demo-account] 偵測到 ${factors.length} 個 MFA factor，已全部刪除（Demo 帳戶不應啟用 MFA）。`);
}

async function main() {
  const users = await listAllUsers();
  const existingUser = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());

  // 資料庫端的還原與撤銷函式要求 is_demo 帳戶剛好 1 個；多出來的會讓它們拒絕執行。
  const otherDemoCount = users.filter(
    (candidate) => candidate.app_metadata?.is_demo === true && candidate.id !== existingUser?.id,
  ).length;
  if (otherDemoCount > 0) {
    console.warn(
      `[seed-demo-account] 警告：另外還有 ${otherDemoCount} 個帶 is_demo 標記的帳戶；` +
        "還原與撤銷 session 函式要求 Demo 帳戶剛好 1 個，請確認並清理多餘的帳戶。",
    );
  }

  let userId;
  if (existingUser) {
    if (existingUser.app_metadata?.is_demo !== true) {
      abort(
        `帳戶 ${email} 已存在但不是 Demo 帳戶（沒有 is_demo 標記）。為避免誤動真實帳戶，已中止；` +
          "本腳本不會把既有帳戶轉成 Demo，也不會改它的密碼。請換一個 DEMO_EMAIL。",
      );
    }
    console.log(`[seed-demo-account] Demo 帳戶 ${email} 已存在，略過建立（不改密碼）。`);
    userId = existingUser.id;
  } else {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { is_demo: true },
    });
    if (createError || !created?.user) {
      abort(`建立帳戶失敗：${createError?.message ?? "沒有回傳使用者"}`);
    }
    console.log(`[seed-demo-account] 已建立 Demo 帳戶 ${email} 並標記 is_demo。`);
    userId = created.user.id;
  }

  await ensureAdminRegistered(userId);
  await removeMfaFactors(userId);

  console.log(
    `[seed-demo-account] 提醒：${email} 會顯示在後台帳號設定頁（公開），必須是你自己控制的信箱。`,
  );
}

main().then(
  () => {
    console.log("[seed-demo-account] 完成。");
  },
  (error) => {
    const message = error instanceof SeedAbort ? error.message : `未預期錯誤：${error instanceof Error ? error.message : String(error)}`;
    console.error(`[seed-demo-account] ${message}`);
    process.exitCode = 1;
  },
);
