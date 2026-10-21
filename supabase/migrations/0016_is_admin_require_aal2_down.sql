-- TASK-079 還原：把 is_admin() 還原成 0001 的原始定義（只檢查 admins 表），並把
-- get_admin_profile／update_admin_profile 還原成 0007 的原始定義。
-- **警告（安全降級）**：還原後，已啟用 MFA 的帳號只要 aal1（帳密）就恢復完整後台權限，
-- 資料庫層不再強制 aal2。只在鎖死復原等必要情況使用；0017／0018 之後新增的資料表也會一併失去保護。

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
  );
$$;

-- 還原 get_admin_profile／update_admin_profile 為 0007 的原始定義（不呼叫 is_admin()）。
create or replace function public.get_admin_profile()
returns table (display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.display_name, a.avatar_url
  from public.admins a
  where a.user_id = auth.uid();
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
  where user_id = auth.uid();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

commit;
