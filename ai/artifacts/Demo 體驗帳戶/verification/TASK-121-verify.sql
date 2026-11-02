-- TASK-121 驗證腳本：Demo 動過的預約視為已提醒（0031）。請在 Supabase SQL Editor 整份貼上執行。
--
-- 安全性：整份腳本是一個 DO 區塊，**最後一定以 raise exception 收尾**，所以不論成敗，交易都會 rollback：
--   * 不會有任何資料被改動（包含被借來測試的那筆預約）。
--   * 本腳本只更新 reminder_sent_at，**不改 start_at／end_at／status**，所以不會觸發 0012 的 UPDATE webhook；
--     就算會觸發，pg_net 的請求在交易提交前也不會被送出。**不會寄出任何信件。**
-- 執行後 SQL Editor 會顯示一則「錯誤」，內容就是結果（這是刻意的，用來保證 rollback）。
--
-- 做了什麼：借用最晚的一筆 pending／confirmed 預約，在同一個交易內以 set_config 模擬不同呼叫者的 JWT，
-- 每個情境先（以空 claims）把 reminder_sent_at 設成指定的起始值，再模擬後台改期會做的那一步——把它設回 null——
-- 然後讀回結果。預期值：
--   KEPT   ＝ 守門生效：維持原值（起始值為 null 時則被標成非 null）
--   NULLED ＝ 沒有守門：reminder_sent_at 變成 null（行為與套用前相同）
--
-- 結果格式：每個情境 `名稱=實際(預期)`，最後 `RESULT=ALL_OK` 或 `RESULT=MISMATCH`。
-- 套用 0031 之後預期 has_trigger=true、grants_ok=true、全部 ALL_OK（grants_ok 檢查觸發器賴以完整的欄位權限前提，見下方）。
-- 套用 0031 之前（基準線）：has_trigger=false，Demo 與 garbage 情境會是 NULLED（預期 KEPT）、整體 MISMATCH——這正是缺口存在的證明。
--
-- 情境說明：
--   demo_from_reminded     app_metadata.is_demo = true，起始為已提醒          → KEPT（維持原值，不被清成 null）
--   demo_from_null         app_metadata.is_demo = true，起始為 null            → KEPT（被標成已提醒，非 null）
--   demo_string_true       app_metadata.is_demo = "true"（字串；現行判斷式同樣擋下）→ KEPT
--   nondemo                app_metadata 為空物件                               → NULLED（一般管理員行為不變）
--   service_real_claims    {"role":"service_role"}（cron 的 claims 形狀）      → NULLED（cron release 行為不變）
--   no_claims              claims 為空字串（SQL Editor、無 JWT）               → NULLED
--   is_demo_false／is_demo_string_false  is_demo = false／"false"             → NULLED
--   user_metadata_demo     只有 user_metadata.is_demo = true（使用者可自行改寫，必須不被採信）→ NULLED
--   top_level_demo         頂層 is_demo = true（不在 app_metadata，必須不被採信）→ NULLED
--   garbage_with_is_demo   claims 是含 is_demo 字樣的壞字串（解析會失敗）      → KEPT，且更新本身不得丟例外
--   garbage_without_is_demo claims 是不含 is_demo 的壞字串（預篩放行，不解析）  → NULLED

do $$
declare
  v_id uuid;
  v_t0 constant timestamptz := '2026-01-01 00:00:00+00';
  v_has_trigger boolean;
  v_trigger_enabled text;
  v_secdef boolean;
  v_config text;
  v_whitelisted boolean;
  v_whitelist_kept boolean;
  v_grants_ok boolean;
  v_after timestamptz;
  v_actual text;
  v_out text := '';
  v_ok boolean := true;
  v_threw boolean;
  r record;
begin
  select id into v_id from public.appointments
    where status in ('pending', 'confirmed') order by start_at desc limit 1;
  if v_id is null then
    raise exception 'VERIFY_ABORT：找不到可借用的 pending／confirmed 預約（交易已 rollback，沒有改動任何資料）';
  end if;

  select exists (
           select 1 from pg_trigger t
           where t.tgrelid = 'public.appointments'::regclass and t.tgname = 'demo_appointment_reminder'
             and not t.tgisinternal and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16 and (t.tgtype & 1) = 1),
         coalesce((select t.tgenabled::text from pg_trigger t
                   where t.tgrelid = 'public.appointments'::regclass and t.tgname = 'demo_appointment_reminder' and not t.tgisinternal), '')
    into v_has_trigger, v_trigger_enabled;

  select coalesce(p.prosecdef, false), coalesce(array_to_string(p.proconfig, ','), '')
    into v_secdef, v_config
    from pg_proc p where p.oid = to_regprocedure('public.demo_appointment_reminder_guard()');

  -- 還原函式的白名單：含新觸發器，且 0027 的觸發器仍在（比對引號包住的完整名稱，不會被註解誤中）。
  select position(quote_literal('demo_appointment_reminder') in p.prosrc) > 0,
         position(quote_literal('demo_row_cap_closed_dates') in p.prosrc) > 0
    into v_whitelisted, v_whitelist_kept
    from pg_proc p where p.oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure;

  -- 觸發器完整的前提：authenticated／anon 不能 INSERT／DELETE appointments（否則可 upsert 出 reminder_sent_at 為 null 的列，觸發器只掛 UPDATE），
  -- 也不能改 customer_email／customer_name／created_at（否則可把收件人改成任意 Email）。有人在 Dashboard 放寬權限時，這裡會變 MISMATCH。
  select not has_any_column_privilege('authenticated', 'public.appointments', 'INSERT')
         and not has_any_column_privilege('anon', 'public.appointments', 'INSERT')
         and not has_table_privilege('authenticated', 'public.appointments', 'DELETE')
         and not has_table_privilege('anon', 'public.appointments', 'DELETE')
         and not has_any_column_privilege('anon', 'public.appointments', 'UPDATE')
         and not has_column_privilege('authenticated', 'public.appointments', 'customer_email', 'UPDATE')
         and not has_column_privilege('authenticated', 'public.appointments', 'customer_name', 'UPDATE')
         and not has_column_privilege('authenticated', 'public.appointments', 'created_at', 'UPDATE')
    into v_grants_ok;

  for r in
    select * from (values
      (1,  'demo_from_reminded',      '{"role":"authenticated","app_metadata":{"is_demo":true}}',                         true,  'KEPT'),
      (2,  'demo_from_null',          '{"role":"authenticated","app_metadata":{"is_demo":true}}',                         false, 'KEPT'),
      (3,  'demo_string_true',        '{"role":"authenticated","app_metadata":{"is_demo":"true"}}',                       true,  'KEPT'),
      (4,  'nondemo',                 '{"role":"authenticated","app_metadata":{}}',                                       true,  'NULLED'),
      (5,  'service_real_claims',     '{"role":"service_role"}',                                                          true,  'NULLED'),
      (6,  'no_claims',               '',                                                                                 true,  'NULLED'),
      (7,  'is_demo_false',           '{"role":"authenticated","app_metadata":{"is_demo":false}}',                        true,  'NULLED'),
      (8,  'is_demo_string_false',    '{"role":"authenticated","app_metadata":{"is_demo":"false"}}',                      true,  'NULLED'),
      (9,  'user_metadata_demo',      '{"role":"authenticated","user_metadata":{"is_demo":true},"app_metadata":{}}',       true,  'NULLED'),
      (10, 'top_level_demo',          '{"role":"authenticated","is_demo":true,"app_metadata":{}}',                        true,  'NULLED'),
      (11, 'garbage_with_is_demo',    'garbage is_demo',                                                                  true,  'KEPT'),
      (12, 'garbage_without_is_demo', 'garbage',                                                                          true,  'NULLED')
    ) as t(ord, label, claims, start_reminded, expected)
    order by ord
  loop
    -- 起始值一律在空 claims 下設定（不受守門影響）。
    perform set_config('request.jwt.claims', '', true);
    update public.appointments
      set reminder_sent_at = case when r.start_reminded then v_t0 else null end
      where id = v_id;

    perform set_config('request.jwt.claims', r.claims, true);
    v_threw := false;
    begin
      update public.appointments set reminder_sent_at = null where id = v_id;
    exception when others then
      v_threw := true;
    end;

    perform set_config('request.jwt.claims', '', true);
    select reminder_sent_at into v_after from public.appointments where id = v_id;
    v_actual := case
      when v_threw then 'THREW'
      when v_after is null then 'NULLED'
      when r.start_reminded and v_after is distinct from v_t0 then 'CHANGED'
      else 'KEPT'
    end;

    if v_actual <> r.expected then
      v_ok := false;
    end if;
    v_out := v_out || r.label || '=' || v_actual || '(' || r.expected || '), ';
  end loop;

  raise exception 'VERIFY_RESULT（交易已 rollback，沒有改動任何資料、沒有寄出任何信件）：has_trigger=%, trigger_enabled=%, security_definer=%, proconfig=[%], whitelist_has_new=%, whitelist_keeps_0027=%, grants_ok=%, % RESULT=%',
    v_has_trigger, v_trigger_enabled, v_secdef, v_config, v_whitelisted, v_whitelist_kept, v_grants_ok, v_out,
    case when v_ok and v_has_trigger and v_trigger_enabled = 'O' and v_secdef and v_whitelisted and v_whitelist_kept and v_grants_ok then 'ALL_OK' else 'MISMATCH' end;
end
$$;
