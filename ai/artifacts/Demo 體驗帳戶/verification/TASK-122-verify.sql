-- TASK-122 驗證腳本：Demo 的 audit_log 每帳戶筆數上限（0028）。請在 Supabase SQL Editor 整份貼上執行。
--
-- 安全性：整份腳本是一個 DO 區塊，**最後一定以 raise exception 收尾**，所以不論成敗，交易都會 rollback：
--   * 不會有任何資料被改動（腳本寫進 audit_log 的測試列隨交易消失；actor 是兩個虛構的 uuid，不是任何真實帳戶）。
--   * 不會寄出任何信件（沒有碰 appointments）。
--   * 唯一不會 rollback 的是 audit_log.id 的序號（identity sequence 的特性）：會多消耗約 1,500 個編號，不影響任何功能。
-- 執行後 SQL Editor 會顯示一則「錯誤」，內容就是結果（這是刻意的，用來保證 rollback）。
--
-- 做了什麼：
--   A. 結構檢查：觸發器存在、啟用、BEFORE INSERT ROW、掛在 audit_log；守門函式是 SECURITY DEFINER、search_path 為空、
--      擁有者可繞過 RLS、API 角色不可執行；函式內的上限數字與本腳本獨立抄寫的 500 一致。
--   B. 行為（直接打真實的 public.audit_log，以 set_config 模擬不同呼叫者的 JWT）：
--      沒有 claims 可填滿至上限；Demo（布林 true 與字串 "true"）達上限後被拒絕且訊息正確；
--      非 Demo／service role／只有 user_metadata 或頂層偽造 is_demo 的 claim 不受限；
--      **每帳戶計數**：另一個帳戶的 500 筆不影響第二個 Demo actor 的額度（整張表 > 500 時仍可新增）；
--      少一筆時 Demo 可新增一次、再一次被拒；多列單一 insert 額度不足時整句被拒；
--      單筆大小（event_type／entity_type 超過 64 位元組）、單一請求超過 20 列被拒，非 Demo 不受這兩項限制；
--      沒有 actor（無 sub）或 actor_id 與 sub 不一致的 Demo 請求被拒；claims 不是合法 JSON 時的失敗方向（需為 22P02）。
--      注意：整份腳本在同一個交易內，而「單一請求 20 列」的計數器是交易內的，所以每個 Demo 案例前都先重設計數器（真實請求各自一個交易）。
--   C. 資訊：audit_log 目前總筆數（不影響結果）。
--
-- 結果格式：每項 `名稱=實際(預期)`，最後 `RESULT=ALL_OK` 或 `RESULT=MISMATCH`。
-- 套用 0028 之前（基準線）：會因為 demo_audit_log_cap_guard 不存在而以 VERIFY_ABORT 中止（交易已 rollback）。
-- 這份腳本內的上限數字是獨立抄寫的一份（v_cap），與 0028 不一致就會 MISMATCH——這是刻意的雙重檢查。

do $$
declare
  v_cap constant int := 500;
  v_a constant uuid := 'aaaaaaaa-0000-4000-8000-000000000122';
  v_b constant uuid := 'bbbbbbbb-0000-4000-8000-000000000122';
  v_c constant uuid := 'cccccccc-0000-4000-8000-000000000122';
  v_demo_a_bool constant text := '{"role":"authenticated","sub":"aaaaaaaa-0000-4000-8000-000000000122","app_metadata":{"is_demo":true}}';
  v_demo_a_str constant text := '{"role":"authenticated","sub":"aaaaaaaa-0000-4000-8000-000000000122","app_metadata":{"is_demo":"true"}}';
  v_demo_b constant text := '{"role":"authenticated","sub":"bbbbbbbb-0000-4000-8000-000000000122","app_metadata":{"is_demo":true}}';
  v_demo_nosub constant text := '{"role":"authenticated","app_metadata":{"is_demo":true}}';
  v_admin_forged constant text := '{"role":"authenticated","sub":"cccccccc-0000-4000-8000-000000000122","app_metadata":{},"user_metadata":{"is_demo":true},"is_demo":true}';
  v_service constant text := '{"role":"service_role"}';
  v_msg constant text := 'DEMO_ROW_CAP: audit_log (cap 500)';
  v_claims text;
  v_actual text;
  v_n bigint;
  v_total bigint;
  v_before bigint;
  v_key bigint;
  v_out text;
begin
  create temp table verify_results (seq serial, name text, actual text, expected text) on commit drop;

  if to_regprocedure('public.demo_audit_log_cap_guard()') is null then
    raise exception 'VERIFY_ABORT：找不到 public.demo_audit_log_cap_guard()（0028 尚未套用？交易已 rollback，沒有改動任何資料）';
  end if;

  -- ============================================================
  -- A. 結構檢查
  -- ============================================================
  select count(*) into v_n from pg_trigger t
    where t.tgname = 'demo_audit_log_cap' and t.tgrelid = 'public.audit_log'::regclass and not t.tgisinternal
      and t.tgenabled = 'O' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & (8 | 16 | 32)) = 0
      and t.tgfoid = 'public.demo_audit_log_cap_guard()'::regprocedure;
  insert into verify_results(name, actual, expected) values ('A.trigger_before_insert_row_enabled', v_n::text, '1');

  -- proconfig 的元素本身就是 search_path=""（含名稱前綴）；布林先轉 text，否則 %s 會印成 t／f。
  select format('secdef=%s,%s,owner_bypassrls=%s', p.prosecdef::text,
                coalesce(array_to_string(p.proconfig, ','), ''), r2.rolbypassrls::text)
    into v_actual
    from pg_proc p join pg_roles r2 on r2.oid = p.proowner
    where p.oid = 'public.demo_audit_log_cap_guard()'::regprocedure;
  insert into verify_results(name, actual, expected)
    values ('A.guard_function_props', v_actual, 'secdef=true,search_path=""' || ',owner_bypassrls=true');

  insert into verify_results(name, actual, expected) values (
    'A.api_roles_cannot_execute_guard',
    (has_function_privilege('anon', 'public.demo_audit_log_cap_guard()', 'execute')
      or has_function_privilege('authenticated', 'public.demo_audit_log_cap_guard()', 'execute')
      or has_function_privilege('service_role', 'public.demo_audit_log_cap_guard()', 'execute'))::text,
    'false');

  insert into verify_results(name, actual, expected) values (
    'A.function_cap_matches_independent_copy',
    (position(format('v_cap constant integer := %s;', v_cap) in
       (select prosrc from pg_proc where oid = 'public.demo_audit_log_cap_guard()'::regprocedure)) > 0)::text,
    'true');

  -- ============================================================
  -- B. 行為（真實 public.audit_log，rollback）
  -- ============================================================
  select count(*) into v_before from public.audit_log;

  -- 1. 沒有 claims（如 SQL Editor、cron）：為虛構帳戶 A 填滿至上限，不受限。
  perform set_config('request.jwt.claims', '', true);
  insert into public.audit_log(actor_id, event_type, entity_type, entity_id)
    select v_a, 'test.demo_audit_cap', 'test', 'x' from generate_series(1, v_cap);
  select count(*) into v_n from public.audit_log where actor_id = v_a;
  insert into verify_results(name, actual, expected) values ('B.fill_without_claims', v_n::text, v_cap::text);

  -- 2. Demo（布林 true 與字串 "true"）達上限後新增一筆（走預設值 auth.uid()，與真實請求相同）：被拒絕、訊息正確。
  foreach v_claims in array array[v_demo_a_bool, v_demo_a_str] loop
    perform set_config('request.jwt.claims', v_claims, true);
    perform set_config('demo.audit_rows', '0', true);
    v_actual := 'allowed';
    begin
      insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
    exception when others then
      v_actual := case when sqlstate = 'P0001' and sqlerrm = v_msg then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
    end;
    insert into verify_results(name, actual, expected)
      values ('B.demo_at_cap_' || case when v_claims = v_demo_a_bool then 'bool' else 'string' end, v_actual, 'rejected');
  end loop;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.audit_log where actor_id = v_a;
  insert into verify_results(name, actual, expected) values ('B.rows_unchanged_after_rejection', v_n::text, v_cap::text);

  -- 3. 非 Demo（含只有 user_metadata／頂層偽造 is_demo）與 service role：不受限（此時 A 已滿，但它們是別的 actor）。
  perform set_config('request.jwt.claims', v_admin_forged, true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.nondemo_admin_forged_claims', v_actual, 'allowed');

  -- 非 Demo 管理員即使「自己」超過 500 筆也不受限（一般管理員／designer001 的紀錄會無限成長）。
  perform set_config('request.jwt.claims', '', true);
  insert into public.audit_log(actor_id, event_type, entity_type, entity_id)
    select v_c, 'test.demo_audit_cap', 'test', 'x' from generate_series(1, v_cap + 10);
  perform set_config('request.jwt.claims', v_admin_forged, true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.nondemo_admin_over_cap_on_own_rows', v_actual, 'allowed');

  perform set_config('request.jwt.claims', v_service, true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.service_role_claims', v_actual, 'allowed');

  -- 4. 每帳戶計數：整張表遠超過 500，另一個 Demo actor B 自己是 0 筆，仍可新增。
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_total from public.audit_log;
  insert into verify_results(name, actual, expected) values ('B.table_total_exceeds_cap', (v_total > v_cap)::text, 'true');
  perform set_config('request.jwt.claims', v_demo_b, true);
  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.other_demo_actor_not_blocked_by_table_total', v_actual, 'allowed');

  -- 4b. 硬上限的決定性證明：Demo 寫入後，本連線持有該帳戶的 advisory lock（交易結束才釋放）；
  --     非 Demo 的 actor（v_c）沒有被上鎖。整合測試的並行案例只是機率性證明（拿掉鎖時未必每次都失敗），這裡是確定性的。
  --     pg_advisory_xact_lock(bigint) 在 pg_locks 以 classid＝高 32 位元、objid＝低 32 位元、objsubid＝1 表示。
  v_key := hashtextextended('demo-audit-cap:' || v_b::text, 0);
  select count(*) into v_n from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid = ((v_key >> 32) & 4294967295)::oid and objid = (v_key & 4294967295)::oid and objsubid = 1;
  insert into verify_results(name, actual, expected) values ('B.advisory_lock_held_after_demo_insert', v_n::text, '1');
  v_key := hashtextextended('demo-audit-cap:' || v_c::text, 0);
  select count(*) into v_n from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid()
      and classid = ((v_key >> 32) & 4294967295)::oid and objid = (v_key & 4294967295)::oid and objsubid = 1;
  insert into verify_results(name, actual, expected) values ('B.no_advisory_lock_for_nondemo_actor', v_n::text, '0');

  -- 5. 剩 1 個額度：Demo 可新增一次（變成剛好上限），再一次被拒。
  perform set_config('request.jwt.claims', '', true);
  delete from public.audit_log where id in (select id from public.audit_log where actor_id = v_a order by id desc limit 1);
  select count(*) into v_n from public.audit_log where actor_id = v_a;
  insert into verify_results(name, actual, expected) values ('B.one_slot_left_count', v_n::text, (v_cap - 1)::text);

  perform set_config('request.jwt.claims', v_demo_a_bool, true);
  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_with_one_slot', v_actual, 'allowed');

  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := case when sqlstate = 'P0001' then 'rejected' else 'other:' || sqlstate end;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_after_slot_used', v_actual, 'rejected');

  -- 6. 多列單一 insert：剩 2 個額度時一次 insert 5 列，整句被拒、表內容不變。
  perform set_config('request.jwt.claims', '', true);
  delete from public.audit_log where id in (select id from public.audit_log where actor_id = v_a order by id desc limit 2);
  select count(*) into v_before from public.audit_log where actor_id = v_a;
  perform set_config('request.jwt.claims', v_demo_a_bool, true);
  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id)
      select 'test.demo_audit_cap', 'test', 'x' from generate_series(1, 5);
  exception when others then
    v_actual := case when sqlstate = 'P0001' then 'rejected' else 'other:' || sqlstate end;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_multirow_insert_over_cap', v_actual, 'rejected');
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.audit_log where actor_id = v_a;
  insert into verify_results(name, actual, expected) values ('B.rows_unchanged_after_multirow_rejection', (v_n = v_before)::text, 'true');

  -- 6b. 單筆大小：Demo 的 event_type／entity_type 超過 64 位元組被拒；64 位元組剛好可寫；非 Demo 不受限。
  perform set_config('request.jwt.claims', v_demo_b, true);
  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.' || repeat('a', 59), 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_event_type_64_bytes_ok', v_actual, 'allowed');

  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.' || repeat('a', 60), 'test', 'x');
  exception when others then
    v_actual := case when sqlstate = 'P0001' and sqlerrm = 'DEMO_ROW_CAP: audit_log (row too large)' then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_event_type_65_bytes_rejected', v_actual, 'rejected');

  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'x_' || repeat('a', 63), 'x');
  exception when others then
    v_actual := case when sqlstate = 'P0001' and sqlerrm = 'DEMO_ROW_CAP: audit_log (row too large)' then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_entity_type_65_bytes_rejected', v_actual, 'rejected');

  perform set_config('request.jwt.claims', v_admin_forged, true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.' || repeat('a', 200), 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.nondemo_long_event_type_allowed', v_actual, 'allowed');

  -- 6c. 單一請求最多 20 列：20 列可以、21 列整句被拒且沒有部分寫入；非 Demo 一次寫 50 列不受限。
  perform set_config('request.jwt.claims', v_demo_b, true);
  perform set_config('demo.audit_rows', '0', true);
  select count(*) into v_before from public.audit_log where actor_id = v_b;
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) select 'test.demo_audit_cap', 'test', 'x' from generate_series(1, 20);
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_20_rows_in_one_request_ok', v_actual, 'allowed');

  perform set_config('demo.audit_rows', '0', true);
  select count(*) into v_before from public.audit_log where actor_id = v_b;
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) select 'test.demo_audit_cap', 'test', 'x' from generate_series(1, 21);
  exception when others then
    v_actual := case when sqlstate = 'P0001' and sqlerrm = 'DEMO_ROW_CAP: audit_log (max 20 rows per request)' then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_21_rows_in_one_request_rejected', v_actual, 'rejected');
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.audit_log where actor_id = v_b;
  insert into verify_results(name, actual, expected) values ('B.rows_unchanged_after_21_row_rejection', (v_n = v_before)::text, 'true');

  perform set_config('request.jwt.claims', v_admin_forged, true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) select 'test.demo_audit_cap', 'test', 'x' from generate_series(1, 50);
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.nondemo_50_rows_in_one_request_ok', v_actual, 'allowed');

  -- 6d. actor_id 與 JWT 的 sub 不一致（以 postgres 身分模擬「有人代為寫入自訂 actor_id」）：被拒絕。
  perform set_config('request.jwt.claims', v_demo_b, true);
  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(actor_id, event_type, entity_type, entity_id) values (v_c, 'test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := case when sqlstate = 'P0001' and sqlerrm = 'DEMO_ROW_CAP: audit_log (invalid actor)' then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_actor_mismatch_rejected', v_actual, 'rejected');
  perform set_config('request.jwt.claims', '', true);

  -- 7. 沒有 actor（無 sub）的 Demo 請求：被拒絕。
  perform set_config('request.jwt.claims', v_demo_nosub, true);
  perform set_config('demo.audit_rows', '0', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(event_type, entity_type, entity_id) values ('test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := case when sqlstate = 'P0001' then 'rejected' else 'other:' || sqlstate || ':' || sqlerrm end;
  end;
  insert into verify_results(name, actual, expected) values ('B.demo_without_actor', v_actual, 'rejected');

  -- 8. 失敗方向：claims 不是合法 JSON、也不含 is_demo → 放行（預篩不解析 JSON）；
  --    含 is_demo 卻無法解析 → 擋下（只擋疑似 Demo 的請求，不會放行）。
  perform set_config('request.jwt.claims', 'not-json', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(actor_id, event_type, entity_type, entity_id) values (v_c, 'test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate || ':' || sqlerrm;
  end;
  insert into verify_results(name, actual, expected) values ('B.garbage_claims_without_is_demo', v_actual, 'allowed');

  perform set_config('request.jwt.claims', 'not-json is_demo', true);
  v_actual := 'allowed';
  begin
    insert into public.audit_log(actor_id, event_type, entity_type, entity_id) values (v_c, 'test.demo_audit_cap', 'test', 'x');
  exception when others then
    v_actual := 'blocked:' || sqlstate;
  end;
  insert into verify_results(name, actual, expected) values ('B.garbage_claims_with_is_demo', v_actual, 'blocked:22P02');

  perform set_config('request.jwt.claims', '', true);

  -- ============================================================
  -- C. 資訊
  -- ============================================================
  select string_agg(format('%s=%s(%s)%s', name, actual, expected, case when actual is distinct from expected then ' <<<MISMATCH' else '' end),
                    E'\n' order by seq)
    into v_out from verify_results;

  raise exception E'TASK-122 verify RESULT=% (rollback 已保證，沒有改動任何資料)\n%\n\n資訊：本腳本內 audit_log 暫時總筆數 %（rollback 後恢復為執行前的筆數）',
    case when exists (select 1 from verify_results where actual is distinct from expected) then 'MISMATCH' else 'ALL_OK' end,
    v_out, v_total;
end
$$;
