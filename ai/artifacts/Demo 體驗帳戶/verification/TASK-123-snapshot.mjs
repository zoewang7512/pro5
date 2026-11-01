// TASK-123：套用 0029 前後的「既有資料不變」證據。唯讀（只 select），不印任何欄位內容，只印列數與雜湊。
// 用法（專案根目錄）：node --env-file=.env.local "ai/artifacts/Demo 體驗帳戶/verification/TASK-123-snapshot.mjs"
// 套用前、套用後各跑一次，兩次輸出的 hash 必須相同。
// store_settings 排除 updated_at：整合測試與 set_updated_at 觸發器會更新它，不屬於「內容」。
import { createHash } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");

async function rows(query) {
  const response = await fetch(`${url}/rest/v1/${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`${query} -> ${response.status}`);
  return response.json();
}

function digest(list) {
  // 逐列以排序後的鍵序列化，列依 id 排序，確保兩次結果可比較。
  const canonical = list.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));
  return createHash("sha256").update(canonical.join("\n")).digest("hex").slice(0, 16);
}

const services = await rows("services?select=*&order=id.asc");
const store = (await rows("store_settings?select=*&order=id.asc")).map((row) => {
  const copy = { ...row };
  delete copy.updated_at;
  return copy;
});

console.log(`services        列數 ${services.length}  hash ${digest(services)}`);
console.log(`store_settings  列數 ${store.length}  hash ${digest(store)}（不含 updated_at）`);
