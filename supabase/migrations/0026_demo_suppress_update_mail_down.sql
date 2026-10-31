-- 回滾 0026_demo_suppress_update_mail.sql
-- 把 public.notify_appointment_update() 還原成 0012 的原本文（逐字，沒有 Demo 守門）。
-- 觸發器 appointments_notify_update 本來就沒被 0026 動過，這裡也不動。
--
-- 警告：回滾等於重新打開缺口——Demo 體驗帳號改期／取消會再次經由店家寄件網域寄信。
-- 回滾期間請確認 Demo 入口已關閉（DEMO_ENABLED=false 並執行 demo:disable），或接受這個風險。
-- 可重複執行（idempotent）。請在 SQL Editor 整份執行。

begin;

create or replace function public.notify_appointment_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_webhook_url text;
  v_webhook_secret text;
begin
  select decrypted_secret into v_webhook_url
    from vault.decrypted_secrets where name = 'appointment_webhook_url';
  select decrypted_secret into v_webhook_secret
    from vault.decrypted_secrets where name = 'appointment_webhook_secret';

  if v_webhook_url is null or v_webhook_secret is null then
    return new;
  end if;

  -- payload 帶 record（新值：id／status／start_at／end_at）與 old_record
  -- （舊值：status／start_at／end_at）**同一次 UPDATE 語句的完整前後快照**——
  -- 兩者都必須來自 payload，不能只送 id 再讓 route 端事後重讀資料庫當下值。
  -- 原因（architect 於本卡審查發現的 MUST FIX）：若同一筆預約在極短時間內
  -- 連續發生兩次真正的異動（例如先改期、幾秒內又取消），兩次 UPDATE 各自觸發
  -- 一次 webhook，但兩次 route 端處理的時間點都可能晚於「取消」那次 UPDATE
  -- 已提交——若分類邏輯是拿 payload 的 old_record 去跟「資料庫當下最新值」比較，
  -- 兩次 webhook 讀到的「當下值」會是同一個（都已是 cancelled），導致兩次都被
  -- 分類成取消、顧客收到兩封取消信。改成 record／old_record 都來自同一次
  -- trigger 呼叫的快照後，分類只反映「這一次 UPDATE 語句本身改了什麼」，不受
  -- 之後又發生的異動影響。
  -- customer_name／customer_email／service_id 這幾個不受這個時序問題影響的
  -- 識別性欄位，仍由 route 端依 id 重新讀回資料庫，不放進 payload（避免整列
  -- 送出，見 0011 migration 檔頭的既有說明）。
  perform net.http_post(
    url := v_webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'appointments',
      'schema', 'public',
      'record', jsonb_build_object(
        'id', new.id,
        'status', new.status,
        'start_at', new.start_at,
        'end_at', new.end_at
      ),
      'old_record', jsonb_build_object(
        'status', old.status,
        'start_at', old.start_at,
        'end_at', old.end_at
      )
    ),
    timeout_milliseconds := 15000
  );

  return new;
exception
  when others then
    raise warning 'notify_appointment_update: webhook dispatch failed for appointment % (%): %',
      new.id, sqlstate, sqlerrm;
    return new;
end;
$$;

revoke execute on function public.notify_appointment_update() from public;

commit;
