-- TASK-087（儀表板與報表 預約價格快照）
-- 為 appointments 新增 price_at_booking：「下單當下的服務價格」。服務之後改價，既有預約的快照不變，
-- 報表的營收才不會被事後改價改動。
--
-- 做法（見 ai/artifacts/儀表板與報表/architecture-notes.md §1）：
--   - BEFORE INSERT trigger 無條件以 services.price 覆寫 new.price_at_booking——不信任呼叫端帶入的值，
--     而且任何新增路徑（create_appointment RPC、service_role 腳本、未來的後台新增）都自動有快照。
--     因此 create_appointment／get_available_slots 完全不用改（簽名與內容都不動），回滾只需丟 trigger。
--   - 只有 INSERT 會寫快照；UPDATE（改期、改狀態）不重算，改期不會改價。
--   - 既有預約一次性回補為「各自服務的目前價格」——這是近似值（既有預約沒有歷史價格可還原）。
--
-- 回補時的副作用防護（同一交易內）：appointments 上有兩個會被 UPDATE 觸發的 trigger——
--   appointments_set_updated_at（BEFORE UPDATE，會把全部既有預約的 updated_at 改成現在）、
--   appointments_notify_update（AFTER UPDATE，會寄取消／改期通知信；WHEN 條件本來就不含本欄位，
--   回補不會觸發，這裡仍一併停用作為雙保險）。
--   回補前先把「目前為啟用狀態」的這兩個 trigger 停用、回補後只還原剛才停用的，不會誤啟用原本就停用的 trigger。
--   任何一步失敗整份交易回滾（包含 trigger 的停用），不會留下停用中的 trigger。
--   ALTER TABLE ... DISABLE TRIGGER 需要資料表擁有者權限，在 Supabase SQL Editor（postgres）執行即可。
--
-- 權限（GRANT 層，依 decisions.md「TASK-065」「TASK-066」規則；appointments 對 authenticated 是欄位層級授權，
-- 新欄位必須補授權，否則後台讀不到會得到 permission denied）：
--   - anon：無任何權限（本欄位也不給）。
--   - authenticated：select (price_at_booking)；**不給 update**——店長與顧客都改不了快照。RLS 的
--     is_admin() policy 照舊，非店長讀到的仍是空結果。
--   - service_role：appointments 表本來就有整表權限（0015），整合測試靠它把快照改成指定值來造資料。
--
-- 可重複執行（idempotent）：add column if not exists、create or replace、drop ... if exists、回補只動 null 列。
-- 對應回滾腳本：0020_appointment_price_snapshot_down.sql（會刪除全部快照資料）。
-- 重要：後續 migration 若調整本欄位的授權，就不要再重跑本檔（重跑會把授權還原成本檔版本）。
-- 部署順序：先套用本檔案，再部署前端（前端早於本檔案部署時，報表頁只會顯示錯誤狀態，不影響其他頁）。
--
-- 套用「前」的檢查（貼在 SQL Editor 先執行，結果不符就先停下來處理）：
--   select tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger
--     where tgrelid = 'public.appointments'::regclass and not tgisinternal order by tgname;
--   預期只有 appointments_notify_insert、appointments_notify_update、appointments_set_updated_at 三筆，
--   且 tgenabled 都是 'O'。若有人從 Dashboard 手動建過 Database Webhook（沒有 WHEN 條件），回補時每筆預約都會觸發一次。
--   select * from pg_publication_tables where tablename = 'appointments';   -- 確認是否在 realtime publication（新欄位會出現在推送內容）
-- 建議安排在離峰時段，並且在 SQL Editor 整份執行（不要只選取一部分執行，否則不在 begin 交易內、失敗時無法整份回滾）。
--
-- 套用後的驗證查詢（貼在 SQL Editor 執行）：
--   select count(*) filter (where price_at_booking is null) as null_rows, count(*) as total from public.appointments;
--   select a.id, a.price_at_booking, s.price from public.appointments a join public.services s on s.id = a.service_id limit 5;
--   select pg_get_triggerdef(oid) from pg_trigger where tgname = 'appointments_set_price_snapshot';
--   select tgname, tgenabled from pg_trigger
--     where tgrelid = 'public.appointments'::regclass and not tgisinternal order by tgname;   -- 都應為 'O'
--   select grantee, privilege_type from information_schema.column_privileges
--     where table_schema = 'public' and table_name = 'appointments' and column_name = 'price_at_booking';

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
-- （依賴檢查只查系統目錄，不會鎖 appointments。）
do $$
begin
  if to_regclass('public.appointments') is null or to_regclass('public.services') is null then
    raise exception '0020 需要先套用 0001～0019（找不到 appointments 或 services）';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'designer_id'
  ) then
    raise exception '0020 需要先套用 0017／0018（appointments 沒有 designer_id）';
  end if;
end $$;

-- ============================================================
-- 鎖
-- ============================================================
-- 明確一次拿下 ACCESS EXCLUSIVE 鎖，並設 5 秒逾時（比照 0018）：若套用當下有連線卡在 appointments 的交易裡，
-- 拿不到鎖就在 5 秒內整份回滾，換個時間重跑即可——不會無限等待而讓後面所有預約請求跟著排隊卡住。
-- 拿到鎖之後持有到 commit，所以回補前不會有新預約插隊產生 null 列；整份交易預估不到 1 秒（數百列）。
set local lock_timeout = '5s';
lock table public.appointments in access exclusive mode;

-- ============================================================
-- 欄位與 trigger
-- ============================================================
-- 先以可為 null 的欄位加入，回補完成後才設 not null。
alter table public.appointments add column if not exists price_at_booking numeric(10, 2);

-- 找不到服務時以 23503（foreign_key_violation）中止，保留原本「service_id 不存在 → 外鍵錯誤」的語意，
-- 不讓錯誤碼變成 not null 的 23502。security definer＋空 search_path：讀 services 不依賴呼叫者的權限與路徑。
create or replace function public.set_appointment_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.price into new.price_at_booking from public.services s where s.id = new.service_id;
  if not found then
    raise exception 'appointments.service_id 找不到對應的服務：%', new.service_id using errcode = '23503';
  end if;
  return new;
end;
$$;

-- 比照 0017：本專案預設權限會把 execute 直接授權給 anon／authenticated，三者都要收回。
-- trigger 觸發時不檢查呼叫者的 execute 權限，所以不影響新增預約（trigger function 本來也不能被直接呼叫）。
revoke execute on function public.set_appointment_price_snapshot() from public, anon, authenticated;

drop trigger if exists appointments_set_price_snapshot on public.appointments;
create trigger appointments_set_price_snapshot
  before insert on public.appointments
  for each row
  execute function public.set_appointment_price_snapshot();

-- ============================================================
-- 回補既有預約（只動 price_at_booking 為 null 的列）
-- ============================================================
do $$
declare
  v_trigger text;
  v_disabled text[] := '{}';
begin
  foreach v_trigger in array array['appointments_set_updated_at', 'appointments_notify_update'] loop
    if exists (
      select 1 from pg_trigger
      where tgrelid = 'public.appointments'::regclass and tgname = v_trigger and tgenabled = 'O'
    ) then
      execute format('alter table public.appointments disable trigger %I', v_trigger);
      v_disabled := v_disabled || v_trigger;
    end if;
  end loop;

  update public.appointments a
     set price_at_booking = s.price
    from public.services s
   where s.id = a.service_id
     and a.price_at_booking is null;

  foreach v_trigger in array v_disabled loop
    execute format('alter table public.appointments enable trigger %I', v_trigger);
  end loop;
end $$;

-- ============================================================
-- 約束
-- ============================================================
alter table public.appointments alter column price_at_booking set not null;

-- 以 drop ... if exists 再 add 的寫法建立 constraint（比照 0017），重跑才會收斂。
alter table public.appointments drop constraint if exists appointments_price_at_booking_nonnegative;
alter table public.appointments
  add constraint appointments_price_at_booking_nonnegative check (price_at_booking >= 0);

-- ============================================================
-- 權限
-- ============================================================
revoke all (price_at_booking) on public.appointments from anon, authenticated;
grant select (price_at_booking) on public.appointments to authenticated;

notify pgrst, 'reload schema';

commit;
