-- TASK-066（為既有 8 張資料表寫出明確的最小權限 GRANT）
-- 起因：Supabase 自 2026-10-30 起，既有專案在 public schema 新建的資料表不再自動授權給
-- Data API 角色（anon／authenticated／service_role）。0001～0014 建立的 8 張表都沒有明確
-- 的 table GRANT，全靠平台自動授權；10/30 之後若用這些 migration 重建資料庫（新專案、
-- 換環境），表建得出來，但 supabase-js 會一律回 permission denied。本檔案依
-- ai/context/decisions.md「TASK-065」的規則，為這 8 張表補上明確且最小權限的授權，
-- 權限表與兩個刻意收斂的理由另記錄於 decisions.md「TASK-066」。
--
-- **套用前的實際授權**（2026-10-21 於正式環境以 information_schema.role_table_grants 查得）：
-- anon／authenticated 對 8 張表幾乎都有 select／insert／update／delete／truncate／
-- references／trigger 全部權限，例外只有 0001／0002 撤銷的 anon insert on appointments、
-- 0008／0014 撤銷的 truncate on booking_policy／business_hours。service_role 全開。
-- 換句話說，到目前為止唯一的實際邊界是 RLS。0015_explicit_table_grants_down.sql 會還原
-- 成這個狀態。
--
-- **權限表**（人工於 2026-10-21 核准；依程式碼實際存取路徑盤點，見 TASK-066 任務卡）：
--
--   表              anon      authenticated（RLS 再以 is_admin() 過濾）
--   services        select    select, insert, update
--   business_hours  select    select, insert, update（後台用 upsert）
--   store_settings  select    select, update
--   booking_policy  select    select, update
--   closed_dates    －        select, insert, update, delete（後台用 upsert／delete）
--   appointments    －        欄位層級：select 除 access_token 以外的欄位；
--                             update 只限 status, start_at, end_at, reminder_sent_at
--   customers       －        －
--   admins          －        －（只透過 SECURITY DEFINER 的 is_admin()／get_admin_profile()／
--                                update_admin_profile() 存取）
--
--   service_role 對 8 張表皆為 select, insert, update, delete（Route Handler 的 webhook／
--   cron、seed 腳本與整合測試使用），不給 truncate／references／trigger。
--
-- 為何上表沒列到的路徑不受影響：
--   - 顧客端建立預約、查可預約時段都走 create_appointment／get_available_slots，兩者皆為
--     SECURITY DEFINER，以函式擁有者身分存取 appointments／customers／closed_dates 等表，
--     不需要呼叫者（anon）對資料表本身有任何權限。函式的 grant execute 不在本檔案範圍。
--   - 0011／0012 的 webhook trigger function 亦為 SECURITY DEFINER；set_updated_at 雖為
--     SECURITY INVOKER，但只改寫 NEW，不讀任何表。欄位層級 update 權限只檢查 UPDATE
--     語句 SET 的欄位，trigger 改寫的 updated_at 不受限。
--   - 外鍵檢查以表擁有者身分執行，不需要呼叫者對被參照的表有權限。
--
-- 刻意的收斂：
--   - closed_dates 不給 anon（人工核准）：顧客前台不直接讀此表（公休日由
--     get_available_slots 判斷）。RLS 上既有的 "public read closed dates" policy 保留不動
--     （本卡不改 policy），只是 anon 在權限層就進不來，該 policy 對 anon 實際上不再生效。
--   - customers 不給 authenticated（人工核准）：後台目前沒有任何地方直接查 customers
--     （顧客姓名／電話都從 appointments 讀）。未來「顧客資料管理」Epic 需要時，由該卡的
--     migration 開放。RLS 上既有的 "admin full access to customers" policy 同樣保留不動。
--   - appointments 對 authenticated 用欄位層級授權（security-reviewer 於 TASK-066 審查
--     提出）：後台只讀 id／customer_name／customer_phone／start_at／end_at／status 與
--     service_id（嵌入 services 用），只更新 status（標記完成／取消）與 start_at／end_at／
--     reminder_sent_at（改期）。access_token 是顧客自助查詢的憑證，後台用不到，不給讀；
--     customer_id／customer_* 等欄位不給改，設計師 session 被盜用時也無法竄改。select
--     除了 access_token 之外先全部給，保留後台顯示其他欄位的彈性。
--
-- 寫法：每張表先 revoke all from anon, authenticated, service_role（含 truncate／
-- references／trigger，以及 Postgres 17 的 maintain），讓結果不受環境原本的授權影響，
-- 再只 grant 上表需要的權限。整份包在單一交易內：revoke 與 grant 在 commit 時才一起生效，
-- 其他連線看不到中間狀態，不會有權限空窗；任何一行失敗都會整份回滾，不會留下只收緊一半的
-- 狀態。務必在 SQL Editor 整份執行，不要只選取部分內容執行。
-- 可重複執行（idempotent）：revoke／grant 重複執行結果相同。

begin;

-- services：顧客前台讀服務列表（RLS 只放行 is_active = true），後台新增／編輯／上下架。
revoke all on public.services from anon, authenticated, service_role;
grant select on public.services to anon;
grant select, insert, update on public.services to authenticated;
grant select, insert, update, delete on public.services to service_role;

-- business_hours：顧客前台讀營業時間，後台以 upsert（onConflict: weekday）儲存。
revoke all on public.business_hours from anon, authenticated, service_role;
grant select on public.business_hours to anon;
grant select, insert, update on public.business_hours to authenticated;
grant select, insert, update, delete on public.business_hours to service_role;

-- store_settings：單例表（id = 1，由 0006 seed 建立），顧客前台讀品牌資訊，後台只更新
-- 既有那一列。
revoke all on public.store_settings from anon, authenticated, service_role;
grant select on public.store_settings to anon;
grant select, update on public.store_settings to authenticated;
grant select, insert, update, delete on public.store_settings to service_role;

-- booking_policy：單例表（id = 1，由 0008 seed 建立），顧客前台讀政策說明，後台只更新
-- 既有那一列。
revoke all on public.booking_policy from anon, authenticated, service_role;
grant select on public.booking_policy to anon;
grant select, update on public.booking_policy to authenticated;
grant select, insert, update, delete on public.booking_policy to service_role;

-- closed_dates：只有後台直接存取（新增用 upsert，onConflict: date；移除用 delete）。
revoke all on public.closed_dates from anon, authenticated, service_role;
grant select, insert, update, delete on public.closed_dates to authenticated;
grant select, insert, update, delete on public.closed_dates to service_role;

-- appointments：顧客端一律走 create_appointment RPC；後台讀列表、標記完成／取消／改期。
-- 日後新增欄位時，若後台需要讀寫，要在新的 migration 補上對應的欄位層級授權。
revoke all on public.appointments from anon, authenticated, service_role;
grant select (
  id, service_id, customer_id, customer_name, customer_phone, customer_email,
  start_at, end_at, status, created_at, updated_at, confirmation_sent_at, reminder_sent_at
) on public.appointments to authenticated;
grant update (status, start_at, end_at, reminder_sent_at) on public.appointments to authenticated;
grant select, insert, update, delete on public.appointments to service_role;

-- customers：目前只有 create_appointment（SECURITY DEFINER）與 service_role 會存取。
revoke all on public.customers from anon, authenticated, service_role;
grant select, insert, update, delete on public.customers to service_role;

-- admins：只透過 SECURITY DEFINER function 存取，比照 TASK-003「RLS 啟用、零 policy」的
-- 鎖死設計，權限層也一併收死。
revoke all on public.admins from anon, authenticated, service_role;
grant select, insert, update, delete on public.admins to service_role;

commit;
