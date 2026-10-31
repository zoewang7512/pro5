-- TASK-114 驗證腳本：Demo 發動的改期／取消不寄信（0026）。請在 Supabase SQL Editor 整份貼上執行。
--
-- 安全性：整份腳本是一個 DO 區塊，**最後一定以 raise exception 收尾**，所以不論成敗，交易都會 rollback：
--   * 不會有任何資料被改動（包含被借來測試的那筆預約、pg_net 的請求佇列）。
--   * pg_net 的請求在交易提交前不會被送出，所以**不會寄出任何信件**。
-- 執行後 SQL Editor 會顯示一則「錯誤」，內容就是結果（這是刻意的，用來保證 rollback）。
--
-- 做了什麼：借用最晚的一筆 pending／confirmed 預約，在同一個交易內以 set_config 模擬不同呼叫者的 JWT，
-- 逐一改期或取消，並數 net.http_request_queue 的新增列數（一次 UPDATE 觸發 webhook ＝ 新增 1 列）。
-- 計數方式：只數「id 大於腳本開始時最大 id」的列，所以背景 worker 刪除別人已處理的舊列不會抵銷 Demo 步驟的 +1
-- （審查發現：舊版用整張表 count(*) 的差，可能把「守門失效」誤判成 0）。仍請在低流量時段執行；
-- 若有真實流量同時進來，Demo 情境可能多出別人的列（變成不是 0），重跑即可。
--
-- 結果格式：每個情境 `名稱=實際(預期)`，最後 `RESULT=ALL_OK` 或 `RESULT=MISMATCH`。
-- 套用 0026 之後預期 has_guard=true、全部 ALL_OK。
-- 套用 0026 之前（基準線）：has_guard=false，三個 Demo 情境會是 1（預期 0）、整體 MISMATCH——這正是缺口存在的證明。
--
-- 情境說明（預期值＝0 代表守門擋下、1 代表照常寄）：
--   demo_reschedule／demo_cancel      app_metadata.is_demo = true（布林）                  → 0
--   demo_string_true                  app_metadata.is_demo = "true"（字串；現行判斷式同樣擋下）→ 0
--   nondemo_reschedule／nondemo_cancel app_metadata 為空物件                               → 1
--   service_real_claims               {"role":"service_role"}（真實 service role 的 claims 形狀）→ 1
--   no_claims                         claims 為空字串（cron 或無 JWT 的呼叫）                → 1
--   is_demo_false／is_demo_string_false is_demo = false／"false"                           → 1
--   user_metadata_demo                只有 user_metadata.is_demo = true（使用者可自行改寫，必須不被採信）→ 1
--   top_level_demo                    頂層 is_demo = true（不在 app_metadata，必須不被採信）  → 1

do $$
declare
  v_id uuid;
  v_base bigint;
  v_before bigint;
  v_delta bigint;
  v_has_guard boolean;
  v_secdef boolean;
  v_config text;
  v_out text := '';
  v_ok boolean := true;
  r record;
begin
  if (select count(*) from vault.decrypted_secrets
        where name in ('appointment_webhook_url', 'appointment_webhook_secret')
          and decrypted_secret is not null) < 2 then
    raise exception 'VERIFY_ABORT：Vault 缺少 appointment_webhook_url／appointment_webhook_secret，非 Demo 對照組不會送出請求，無法驗證';
  end if;

  select id into v_id from public.appointments
    where status in ('pending', 'confirmed') order by start_at desc limit 1;
  if v_id is null then
    raise exception 'VERIFY_ABORT：找不到可借用的 pending／confirmed 預約（交易已 rollback，沒有改動任何資料）';
  end if;

  -- 比對守門的實際條件字串（不會被註解裡的 is_demo 誤中），並確認線上函式仍是 security definer、search_path 為空。
  select position($g$if coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true' then$g$ in prosrc) > 0,
         prosecdef,
         coalesce(array_to_string(proconfig, ','), '')
    into v_has_guard, v_secdef, v_config
    from pg_proc where oid = 'public.notify_appointment_update()'::regprocedure;

  -- 觸發器的 WHEN 需要 customer_email 非 null；只改這一欄不會滿足 start_at／end_at／status 的條件，不觸發。
  update public.appointments set customer_email = 'verify@example.invalid' where id = v_id;

  v_base := coalesce((select max(id) from net.http_request_queue), 0);

  for r in
    select * from (values
      (1,  'demo_reschedule',       '{"role":"authenticated","app_metadata":{"is_demo":true}}',            'reschedule', 0),
      (2,  'demo_cancel',           '{"role":"authenticated","app_metadata":{"is_demo":true}}',            'cancel',     0),
      (3,  'demo_string_true',      '{"role":"authenticated","app_metadata":{"is_demo":"true"}}',          'reschedule', 0),
      (4,  'nondemo_reschedule',    '{"role":"authenticated","app_metadata":{}}',                          'reschedule', 1),
      (5,  'nondemo_cancel',        '{"role":"authenticated","app_metadata":{}}',                          'cancel',     1),
      (6,  'service_real_claims',   '{"role":"service_role"}',                                             'reschedule', 1),
      (7,  'no_claims',             '',                                                                    'reschedule', 1),
      (8,  'is_demo_false',         '{"role":"authenticated","app_metadata":{"is_demo":false}}',           'reschedule', 1),
      (9,  'is_demo_string_false',  '{"role":"authenticated","app_metadata":{"is_demo":"false"}}',         'reschedule', 1),
      (10, 'user_metadata_demo',    '{"role":"authenticated","user_metadata":{"is_demo":true},"app_metadata":{}}', 'reschedule', 1),
      (11, 'top_level_demo',        '{"role":"authenticated","is_demo":true,"app_metadata":{}}',           'reschedule', 1)
    ) as t(ord, label, claims, act, expected)
    order by ord
  loop
    perform set_config('request.jwt.claims', r.claims, true);
    v_before := (select count(*) from net.http_request_queue where id > v_base);

    if r.act = 'reschedule' then
      update public.appointments
        set start_at = start_at + interval '1 day', end_at = end_at + interval '1 day' where id = v_id;
    else
      update public.appointments set status = 'cancelled' where id = v_id;
    end if;

    v_delta := (select count(*) from net.http_request_queue where id > v_base) - v_before;

    if r.act = 'cancel' then
      -- 還原成未取消（沒有改時間、也不是變成 cancelled，不滿足 WHEN，不觸發）。
      perform set_config('request.jwt.claims', '', true);
      update public.appointments set status = 'confirmed' where id = v_id;
    end if;

    if v_delta <> r.expected then
      v_ok := false;
    end if;
    v_out := v_out || r.label || '=' || v_delta || '(' || r.expected || '), ';
  end loop;

  raise exception 'VERIFY_RESULT（交易已 rollback，沒有改動任何資料、沒有寄出任何信件）：has_guard=%, security_definer=%, proconfig=[%], % RESULT=%',
    v_has_guard, v_secdef, v_config, v_out, case when v_ok and v_has_guard then 'ALL_OK' else 'MISMATCH' end;
end
$$;
