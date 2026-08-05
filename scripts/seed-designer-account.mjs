// 一次性腳本：建立唯一設計師帳號並登記進 admins 表。
// 執行方式：npm run seed:designer（會用 --env-file=.env.local 載入環境變數）。
// 冪等：帳號已存在時不重複建立，只補上缺少的 admins 登記。密碼全程不印出。

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.DESIGNER_EMAIL;
const password = process.env.DESIGNER_PASSWORD;

function fail(message) {
  console.error(`[seed-designer-account] ${message}`);
  process.exit(1);
}

if (!url || !serviceRoleKey) {
  fail("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請確認 .env.local 已填寫。");
}
if (!email || !password) {
  fail("缺少 DESIGNER_EMAIL 或 DESIGNER_PASSWORD，請先填入 .env.local 再執行。");
}
if (password.length < 12) {
  fail("DESIGNER_PASSWORD 長度需至少 12 碼，請換一組更強的密碼後再執行。");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(targetEmail) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    fail(`列出使用者失敗：${error.message}`);
  }
  return data.users.find(
    (candidate) => candidate.email?.toLowerCase() === targetEmail.toLowerCase(),
  );
}

async function ensureAdminRegistered(userId) {
  const { data: existing, error: selectError } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectError) {
    fail(`查詢 admins 表失敗：${selectError.message}`);
  }
  if (existing) {
    console.log("[seed-designer-account] admins 表已登記過此帳號，略過。");
    return;
  }

  const { error: insertError } = await supabase.from("admins").insert({ user_id: userId });
  if (insertError) {
    fail(`寫入 admins 表失敗：${insertError.message}`);
  }
  console.log("[seed-designer-account] 已登記為唯一設計師帳號。");
}

async function main() {
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    console.log(`[seed-designer-account] 帳號 ${email} 已存在，略過建立步驟。`);
    await ensureAdminRegistered(existingUser.id);
    return;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    fail(`建立帳號失敗：${createError.message}`);
  }

  console.log(`[seed-designer-account] 已建立帳號 ${email}。`);
  await ensureAdminRegistered(created.user.id);
}

main().then(
  () => {
    console.log("[seed-designer-account] 完成。");
    process.exit(0);
  },
  (error) => {
    fail(`未預期錯誤：${error instanceof Error ? error.message : String(error)}`);
  },
);
