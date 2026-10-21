-- TASK-079（資料庫層強制 MFA）
-- 起因：TASK-059 完成證據登記的 [High] 殘留風險（合併 TASK-043 已知限制 H1）——aal2 檢查只在
-- Next.js 的三個入口點（app/admin/layout.tsx、app/login/page.tsx、lib/supabase/middleware.ts）
-- 生效。已啟用 MFA 但只輸入帳密（aal1）的 session，直接呼叫 Supabase REST／RPC／Storage API
-- 仍可讀寫全部後台資料。
--
-- 做法：改 is_admin()（簽名不變，create or replace）。所有 RLS policy 與 Storage policy 都透過
-- 它判斷，改一處全部生效；多位設計師 Epic 新增的資料表也用 is_admin()，會自動受到保護。
-- **例外**：0007 的 get_admin_profile／update_admin_profile 原本直接查 admins 表、沒有呼叫
-- is_admin()，改 is_admin() 管不到它們，所以本檔案後半段另外一併修正。
--
-- 規則：
--   1. 不在 admins 表 → false（不論 aal，行為不變）。
--   2. 在 admins 表、且「沒有 verified factor」→ true（行為與 0001 相同，aal1 即可）。
--   3. 在 admins 表、且有 verified factor → 只有 JWT aal = 'aal2' 才 true。
-- 「是否啟用 MFA」以 auth.mfa_factors 為準（伺服器端權威資料），與 lib/auth/aal.ts 不信任
-- 本地 cookie 快取的原則一致；aal 取自 PostgREST 已驗簽的 JWT。註冊中的 factor 狀態是
-- unverified，不算「已啟用」，所以 MFA 註冊流程不受影響。
--
-- 套用時機注意：店長若正處於「已啟用 MFA 但只是 aal1」的 session，套用後會立即失去後台權限，
-- 需重新登入並完成 TOTP，屬預期行為。

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  )
  and (
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    )
  );
$$;

-- ============================================================
-- get_admin_profile／update_admin_profile：補上 is_admin() 檢查
-- ============================================================
-- 這兩支 SECURITY DEFINER RPC（0007）直接用 admins where user_id = auth.uid() 判斷身分，
-- 沒有呼叫 is_admin()，所以上面改 is_admin() 對它們無效：已啟用 MFA 的 aal1 session 仍能
-- 呼叫 update_admin_profile 成功寫入（TASK-079 整合測試發現）。這裡加上 and public.is_admin()
-- 讓它們同樣遵守 aal2 規則。簽名、回傳型態、grant 都不變（create or replace 保留既有授權）；
-- 非管理員或 aal 不足時行為與原本「非管理員」相同（空結果集／回傳 false），不新增可觀察差異。
create or replace function public.get_admin_profile()
returns table (display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.display_name, a.avatar_url
  from public.admins a
  where a.user_id = auth.uid()
    and public.is_admin();
$$;

create or replace function public.update_admin_profile(p_display_name text, p_avatar_url text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if char_length(coalesce(p_display_name, '')) > 50 then
    return false;
  end if;
  if char_length(coalesce(p_avatar_url, '')) > 2048 then
    return false;
  end if;

  update public.admins
  set display_name = p_display_name, avatar_url = p_avatar_url
  where user_id = auth.uid()
    and public.is_admin();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

commit;
