-- TASK-116 驗證腳本：Demo 專屬資料筆數上限（0027）。請在 Supabase SQL Editor 整份貼上執行。
--
-- 安全性：整份腳本是一個 DO 區塊，**最後一定以 raise exception 收尾**，所以不論成敗，交易都會 rollback：
--   * 不會有任何資料被改動（測試用的暫存資料表與公休日測試列都隨交易消失）。
--   * 不會寄出任何信件（沒有碰 appointments）。
-- 執行後 SQL Editor 會顯示一則「錯誤」，內容就是結果（這是刻意的，用來保證 rollback）。
--
-- 做了什麼：
--   A. 結構檢查：六個真實觸發器存在且啟用；守門函式是 SECURITY DEFINER、search_path 為空、擁有者可繞過 RLS、
--      API 角色不可執行；reset_demo_data 的白名單含六個新觸發器，初版的 customers／appointments 觸發器已不存在。
--   B. 六張表的守門邏輯：為每張表建一張**同名的暫存資料表**（pg_temp），掛上同一個 demo_row_cap_guard()，
--      以 set_config 模擬不同呼叫者的 JWT（守門函式以 tg_table_name 決定上限，所以暫存表與真實表走同一條程式路徑），
--      逐一驗證：沒有 claims 可填滿至上限；Demo（布林 true 與字串 "true"）達上限後被拒絕且訊息正確；
--      非 Demo／service role／只有 user_metadata 的偽造 claim 不受限；少一筆時 Demo 可新增一次、再一次被拒；
--      多列單一 insert 會整句被拒絕（此項是設計時的未知事項，在此實測）。
--      這樣不必滿足 appointments 的重疊限制等真實欄位約束，也不必在真實表塞 640 筆。
--   C. 真實資料表路徑（closed_dates）：把真實 public.closed_dates 補到上限（2099 年的測試日期），
--      Demo 新增被真實觸發器拒絕、非 Demo 照常新增、Demo 對「已存在日期」的 upsert 也被拒絕（已知行為）。
--   D. 資訊：六張表目前的實際筆數與上限（不影響結果）。
--
-- 結果格式：每項 `名稱=實際(預期)`，最後 `RESULT=ALL_OK` 或 `RESULT=MISMATCH`。
-- 套用 0027 之前（基準線）：A 的結構檢查與 C 會不符（觸發器不存在）、整體 MISMATCH，B 會因為 demo_row_cap_guard 不存在而中止。
-- 這份腳本內的上限數字是獨立抄寫的一份（不是從函式讀出來），與 0027 不一致就會 MISMATCH——這是刻意的雙重檢查。

do $$
declare
  v_caps constant jsonb := '{"services":10,"designers":5,"designer_services":50,"designer_leaves":20,"designer_portfolio_images":60,"closed_dates":20}';
  v_demo_bool constant text := '{"role":"authenticated","app_metadata":{"is_demo":true}}';
  v_demo_str constant text := '{"role":"authenticated","app_metadata":{"is_demo":"true"}}';
  v_admin constant text := '{"role":"authenticated","app_metadata":{},"user_metadata":{"is_demo":true},"is_demo":true}';
  v_service constant text := '{"role":"service_role"}';
  r record;
  v_cap int;
  v_actual text;
  v_n bigint;
  v_cur bigint;
  v_out text;
  v_info text := '';
  v_names constant text[] := array['demo_row_cap_closed_dates', 'demo_row_cap_designer_leaves',
    'demo_row_cap_designer_portfolio_images', 'demo_row_cap_designer_services', 'demo_row_cap_designers', 'demo_row_cap_services'];
  v_name text;
  v_reset_src text;
begin
  create temp table verify_results (seq serial, name text, actual text, expected text) on commit drop;

  if to_regprocedure('public.demo_row_cap_guard()') is null then
    raise exception 'VERIFY_ABORT：找不到 public.demo_row_cap_guard()（0027 尚未套用？交易已 rollback，沒有改動任何資料）';
  end if;

  -- ============================================================
  -- A. 結構檢查
  -- ============================================================
  select count(*) into v_n from pg_trigger t
    where t.tgname = any (v_names) and not t.tgisinternal and t.tgenabled = 'O'
      and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & (8 | 16 | 32)) = 0
      and t.tgfoid = 'public.demo_row_cap_guard()'::regprocedure;
  insert into verify_results(name, actual, expected) values ('A.triggers_before_insert_row_enabled', v_n::text, '6');

  select count(*) into v_n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = any (v_names) and c.relnamespace = 'public'::regnamespace
      and t.tgname = 'demo_row_cap_' || c.relname;
  insert into verify_results(name, actual, expected) values ('A.trigger_names_match_tables', v_n::text, '6');

  -- proconfig 的元素本身就是 search_path=""（含名稱前綴）；布林先轉 text，否則 %s 會印成 t／f。
  select format('secdef=%s,%s,owner_bypassrls=%s', p.prosecdef::text,
                coalesce(array_to_string(p.proconfig, ','), ''), r2.rolbypassrls::text)
    into v_actual
    from pg_proc p join pg_roles r2 on r2.oid = p.proowner
    where p.oid = 'public.demo_row_cap_guard()'::regprocedure;
  insert into verify_results(name, actual, expected)
    values ('A.guard_function_props', v_actual, 'secdef=true,search_path=""' || ',owner_bypassrls=true');

  insert into verify_results(name, actual, expected) values (
    'A.api_roles_cannot_execute_guard',
    (has_function_privilege('anon', 'public.demo_row_cap_guard()', 'execute')
      or has_function_privilege('authenticated', 'public.demo_row_cap_guard()', 'execute')
      or has_function_privilege('service_role', 'public.demo_row_cap_guard()', 'execute'))::text,
    'false');

  select prosrc into v_reset_src from pg_proc where oid = 'public.reset_demo_data(jsonb,boolean)'::regprocedure;
  select count(*) into v_n from unnest(v_names) n where position(quote_literal(n) in v_reset_src) > 0;
  insert into verify_results(name, actual, expected) values ('A.reset_whitelist_has_all_triggers', v_n::text, '6');

  -- 初版曾建立、審查後移除的 customers／appointments 觸發器必須已不存在。
  select count(*) into v_n from pg_trigger where tgname in ('demo_row_cap_customers', 'demo_row_cap_appointments') and not tgisinternal;
  insert into verify_results(name, actual, expected) values ('A.removed_triggers_gone', v_n::text, '0');

  -- ============================================================
  -- B. 六張表的守門邏輯（同名暫存表 + 同一個守門函式）
  -- ============================================================
  for r in select key as t, value::int as cap from jsonb_each_text(v_caps) order by key loop
    execute format('create temp table %I (id int)', r.t);
    execute format('create trigger demo_row_cap_verify before insert on pg_temp.%I for each row execute function public.demo_row_cap_guard()', r.t);

    -- 1. 沒有 claims（如 SQL Editor、cron）填滿至上限：不受限。
    perform set_config('request.jwt.claims', '', true);
    execute format('insert into pg_temp.%I select g from generate_series(1, %s) g', r.t, r.cap);
    execute format('select count(*) from pg_temp.%I', r.t) into v_n;
    insert into verify_results(name, actual, expected) values (r.t || '.fill_without_claims', v_n::text, r.cap::text);

    -- 2. Demo（布林 true）達上限後新增一筆：被拒絕、訊息正確。
    foreach v_name in array array[v_demo_bool, v_demo_str] loop
      perform set_config('request.jwt.claims', v_name, true);
      v_actual := 'allowed';
      begin
        execute format('insert into pg_temp.%I values (-1)', r.t);
      exception when others then
        v_actual := case when sqlstate = 'P0001' and sqlerrm = format('DEMO_ROW_CAP: %s (cap %s)', r.t, r.cap)
                         then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
      end;
      insert into verify_results(name, actual, expected)
        values (r.t || '.demo_at_cap_' || case when v_name = v_demo_bool then 'bool' else 'string' end, v_actual, 'rejected');
    end loop;
    execute format('select count(*) from pg_temp.%I', r.t) into v_n;
    insert into verify_results(name, actual, expected) values (r.t || '.rows_unchanged_after_rejection', v_n::text, r.cap::text);

    -- 3. 非 Demo 管理員（含只有 user_metadata／頂層偽造 is_demo）與 service role：已滿仍可新增。
    perform set_config('request.jwt.claims', v_admin, true);
    v_actual := 'allowed';
    begin
      execute format('insert into pg_temp.%I values (-2)', r.t);
    exception when others then
      v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
    end;
    insert into verify_results(name, actual, expected) values (r.t || '.nondemo_admin_at_cap', v_actual, 'allowed');

    perform set_config('request.jwt.claims', v_service, true);
    v_actual := 'allowed';
    begin
      execute format('insert into pg_temp.%I values (-3)', r.t);
    exception when others then
      v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
    end;
    insert into verify_results(name, actual, expected) values (r.t || '.service_role_at_cap', v_actual, 'allowed');

    -- 4. 剩 1 個額度：Demo 可新增一次（變成剛好上限），再一次被拒。
    -- 此時共 cap+2 筆（填滿的 cap 筆加上步驟 3 的兩筆）；刪最大的 3 個 id 後剩 cap-1。
    execute format('delete from pg_temp.%I where id in (select id from pg_temp.%I order by id desc limit 3)', r.t, r.t);
    execute format('select count(*) from pg_temp.%I', r.t) into v_n;
    insert into verify_results(name, actual, expected) values (r.t || '.one_slot_left_count', v_n::text, (r.cap - 1)::text);

    perform set_config('request.jwt.claims', v_demo_bool, true);
    v_actual := 'allowed';
    begin
      execute format('insert into pg_temp.%I values (-4)', r.t);
    exception when others then
      v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
    end;
    insert into verify_results(name, actual, expected) values (r.t || '.demo_with_one_slot', v_actual, 'allowed');

    v_actual := 'allowed';
    begin
      execute format('insert into pg_temp.%I values (-5)', r.t);
    exception when others then
      v_actual := case when sqlstate = 'P0001' then 'rejected' else 'other:' || sqlstate end;
    end;
    insert into verify_results(name, actual, expected) values (r.t || '.demo_after_slot_used', v_actual, 'rejected');

    -- 5. 多列單一 insert：剩 2 個額度時一次 insert 5 列，整句被拒、表內容不變。
    perform set_config('request.jwt.claims', '', true);
    execute format('delete from pg_temp.%I where id in (select id from pg_temp.%I order by id desc limit 2)', r.t, r.t);
    execute format('select count(*) from pg_temp.%I', r.t) into v_cur;
    perform set_config('request.jwt.claims', v_demo_bool, true);
    v_actual := 'allowed';
    begin
      execute format('insert into pg_temp.%I select g from generate_series(100, 104) g', r.t);
    exception when others then
      v_actual := case when sqlstate = 'P0001' then 'rejected' else 'other:' || sqlstate end;
    end;
    insert into verify_results(name, actual, expected) values (r.t || '.demo_multirow_insert_over_cap', v_actual, 'rejected');
    execute format('select count(*) from pg_temp.%I', r.t) into v_n;
    insert into verify_results(name, actual, expected)
      values (r.t || '.rows_unchanged_after_multirow_rejection', (v_n = v_cur)::text, 'true');

    -- 6. 失敗方向：claims 不是合法 JSON、也不含 is_demo → 放行（預篩不解析 JSON）；
    --    含 is_demo 卻無法解析 → 擋下（只擋疑似 Demo 的請求，不會放行）。
    perform set_config('request.jwt.claims', 'not-json', true);
    v_actual := 'allowed';
    begin
      execute format('insert into pg_temp.%I values (-6)', r.t);
    exception when others then
      v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
    end;
    insert into verify_results(name, actual, expected) values (r.t || '.garbage_claims_without_is_demo', v_actual, 'allowed');

    perform set_config('request.jwt.claims', 'not-json is_demo', true);
    v_actual := 'allowed';
    begin
      execute format('insert into pg_temp.%I values (-7)', r.t);
    exception when others then
      v_actual := 'blocked';
    end;
    insert into verify_results(name, actual, expected) values (r.t || '.garbage_claims_with_is_demo', v_actual, 'blocked');
  end loop;

  perform set_config('request.jwt.claims', '', true);

  -- ============================================================
  -- C. 真實資料表路徑：closed_dates
  -- ============================================================
  select count(*) into v_cur from public.closed_dates;
  v_cap := (v_caps ->> 'closed_dates')::int;
  if v_cur < v_cap then
    insert into public.closed_dates(date)
      select (date '2099-01-01' + g) from generate_series(1, (v_cap - v_cur)::int) g;
  end if;
  select count(*) into v_n from public.closed_dates;
  insert into verify_results(name, actual, expected) values ('C.closed_dates_filled_to_cap_or_above', (v_n >= v_cap)::text, 'true');

  perform set_config('request.jwt.claims', v_demo_bool, true);
  v_actual := 'allowed';
  begin
    insert into public.closed_dates(date) values (date '2099-12-31');
  exception when others then
    v_actual := case when sqlstate = 'P0001' and sqlerrm like 'DEMO_ROW_CAP: closed_dates (cap 20)' then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
  end;
  insert into verify_results(name, actual, expected) values ('C.real_closed_dates_demo_at_cap', v_actual, 'rejected');

  v_actual := 'allowed';
  begin
    insert into public.closed_dates(date) select min(date) from public.closed_dates
      on conflict (date) do update set date = excluded.date;
  exception when others then
    v_actual := case when sqlstate = 'P0001' then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
  end;
  insert into verify_results(name, actual, expected) values ('C.real_closed_dates_demo_upsert_existing_at_cap(known)', v_actual, 'rejected');

  perform set_config('request.jwt.claims', v_admin, true);
  v_actual := 'allowed';
  begin
    insert into public.closed_dates(date) values (date '2099-12-30');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('C.real_closed_dates_nondemo_admin_at_cap', v_actual, 'allowed');

  perform set_config('request.jwt.claims', '', true);

  -- ============================================================
  -- D. 資訊：六張表目前的實際筆數／上限
  -- ============================================================
  for r in select key as t, value::int as cap from jsonb_each_text(v_caps) order by key loop
    execute format('select count(*) from public.%I', r.t) into v_n;
    v_info := v_info || format(E'\n  %s: %s / %s%s', r.t, v_n, r.cap,
      case when r.t = 'closed_dates' then '（含本腳本暫時補的測試列，rollback 後消失）' when v_n >= r.cap then '（已達或超過上限：Demo 要等還原後才有額度）' else '' end);
  end loop;

  select string_agg(format('%s=%s(%s)%s', name, actual, expected, case when actual is distinct from expected then ' <<<MISMATCH' else '' end),
                    E'\n' order by seq)
    into v_out from verify_results;

  raise exception E'TASK-116 verify RESULT=% (rollback 已保證，沒有改動任何資料)\n%\n\n資訊（真實表目前筆數／上限）：%',
    case when exists (select 1 from verify_results where actual is distinct from expected) then 'MISMATCH' else 'ALL_OK' end,
    v_out, v_info;
end
$$;
