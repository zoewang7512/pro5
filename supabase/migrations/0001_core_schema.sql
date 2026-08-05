-- TASK-003：核心資料模型與認證框架基礎
-- 建立 services / appointments / customers 三張表、is_admin() 身分判斷機制與 RLS 政策。
-- 可重複執行（idempotent）：使用 if not exists / drop ... if exists。
-- 對應回滾腳本：0001_core_schema_down.sql

begin;

-- ============================================================
-- 擴充套件（gen_random_uuid / gen_random_bytes 需要）
-- ============================================================
create extension if not exists pgcrypto;

-- ============================================================
-- admins：登記唯一設計師帳號，取代用 authenticated 角色判斷身分
-- ============================================================
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- 刻意不建立任何 policy：一般角色（含 authenticated 自己）完全無法直接讀寫這張表，
-- 只有下面的 SECURITY DEFINER function 能繞過 RLS 讀取。

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

-- ============================================================
-- services
-- ============================================================
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10, 2) not null check (price >= 0),
  duration_minutes int not null check (duration_minutes > 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

drop policy if exists "public read active services" on public.services;
create policy "public read active services"
  on public.services
  for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "admin full access to services" on public.services;
create policy "admin full access to services"
  on public.services
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- customers
-- ============================================================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists customers_phone_key
  on public.customers (phone)
  where phone is not null;

create unique index if not exists customers_email_key
  on public.customers (email)
  where email is not null;

alter table public.customers enable row level security;
-- 刻意不建立 anon policy：顧客完全不可讀寫 customers 表。
-- 顧客去重／建檔邏輯屬未來預約流程 Epic，將以 SECURITY DEFINER RPC 處理。

drop policy if exists "admin full access to customers" on public.customers;
create policy "admin full access to customers"
  on public.customers
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- appointments
-- ============================================================
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id),
  customer_id uuid references public.customers (id),
  customer_name text not null,
  customer_phone text,
  customer_email text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  access_token text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_end_after_start check (end_at > start_at)
);

create index if not exists appointments_start_at_idx on public.appointments (start_at);
create index if not exists appointments_service_id_idx on public.appointments (service_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row
  execute function public.set_updated_at();

alter table public.appointments enable row level security;

-- 欄位層級權限：anon（未登入顧客）新增預約時只能填寫這些欄位，
-- 不能自行指定 status／access_token／customer_id（一律吃資料庫預設值，
-- 避免顧客自訂可預測的 access_token 或冒用他人 customer_id）。
-- authenticated（設計師，受 is_admin() RLS policy 保護）維持完整欄位存取，
-- 才能手動建立/調整含 status、access_token 等欄位的預約。
revoke insert on public.appointments from anon, authenticated;
grant insert (service_id, customer_name, customer_phone, customer_email, start_at, end_at)
  on public.appointments to anon;
grant insert on public.appointments to authenticated;

-- 僅開放給 anon（未登入顧客）。authenticated（設計師）已由下方
-- "admin full access to appointments" 的 is_admin() policy 涵蓋；
-- 若這裡也放行 authenticated，任何「非管理者但已登入」的帳號都能靠這條較寬鬆
-- 的 check 繞過欄位權限限制寫入任意 access_token／customer_id。
drop policy if exists "anyone can create pending appointment" on public.appointments;
create policy "anyone can create pending appointment"
  on public.appointments
  for insert
  to anon
  with check (
    status = 'pending'
    and start_at > now()
    and end_at > start_at
    and exists (
      select 1 from public.services s
      where s.id = service_id and s.is_active = true
    )
  );

-- 刻意不開放 anon SELECT：顧客用 access_token 自助查詢預約屬於未來預約流程 Epic，
-- 屆時會用 SECURITY DEFINER RPC（帶 token 參數）實作。

drop policy if exists "admin full access to appointments" on public.appointments;
create policy "admin full access to appointments"
  on public.appointments
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
