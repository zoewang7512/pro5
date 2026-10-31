-- TASK-114（Demo 體驗帳戶：Demo 發動的改期／取消不寄信，架構筆記 D13）
-- 以 create or replace 改寫 public.notify_appointment_update()：函式開頭多一道守門，JWT 的
-- app_metadata.is_demo 為 'true' 時直接 return new，不讀 Vault、不呼叫 net.http_post。
-- **其餘本文與 0012 逐字相同**（tests/lib/demo-mail-suppress-migration.test.ts 以逐字比對把關）。
--
-- 為什麼要做：Demo 帳號是管理員，能對任意 Email 的預約改期或取消；每次都會經由店家已驗證的寄件網域
-- 寄出通知信，等於把寄件網域借給公開入口的任何人濫用。使用者決定（D13 方案 A）：Demo 發動的
-- 改期／取消不寄信；面試官自己預約的確認信照寄。
--
-- 不動的東西：
--   * 觸發器 appointments_notify_update 不重建、WHEN 條件不改（只換函式本文）。
--   * notify_appointment_insert 與其觸發器（0011，確認信）。
--   * 預約資料本身：Demo 的改期與取消照常成功，只是不寄信。
--   * cron、service role、顧客前台：沒有 Demo JWT，行為不變。
--   * 殘留風險維持：reminder_sent_at 可被清成 null 造成提醒信重寄（頻率受每日排程限制）。
--
-- 守門為什麼讀得到 JWT：觸發器與發動它的 UPDATE 在同一個交易內，auth.jwt() 讀的是 PostgREST 為該請求
-- 設定的 request.jwt.claims；security definer 不會改變這個設定值。若讀取發生任何例外，函式既有的
-- exception handler 會吞掉並 return new——結果是「不寄信」，方向是安全的。
--
-- 套用順序：任何時間都可套用（只依賴 0012 已存在的函式與觸發器），與應用程式部署順序無關。
-- 可重複執行（idempotent）。回滾：0026_demo_suppress_update_mail_down.sql（把函式還原成 0012 本文）。
-- 請在 SQL Editor 整份執行（不要只選取一部分，否則不在 begin 交易內、失敗時無法整份回滾）。
--
-- 套用後的驗證：
--   1. 貼上並執行 ai/artifacts/Demo 體驗帳戶/verification/TASK-114-verify.sql（整個交易以例外收尾，保證 rollback，
--      不會寄出任何信件；訊息內列出四種情境的 webhook 請求增量）。
--   2. select prosrc like '%is_demo%' as has_guard from pg_proc
--        where oid = 'public.notify_appointment_update()'::regprocedure;   -- 預期 true
--   3. select tgname, tgenabled from pg_trigger
--        where tgrelid = 'public.appointments'::regclass and tgname = 'appointments_notify_update';  -- 預期 1 列、O

begin;

-- 依賴檢查：缺少前置物件時直接中止，不留下半套。
do $$
begin
  if to_regprocedure('public.notify_appointment_update()') is null then
    raise exception '0026 需要 public.notify_appointment_update()（0012 尚未套用）';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'appointments_notify_update'
      and not tgisinternal
  ) then
    raise exception '0026 需要觸發器 appointments_notify_update（0012 尚未套用）';
  end if;
  if to_regprocedure('auth.jwt()') is null then
    raise exception '0026 需要 auth.jwt()（此 Supabase 版本沒有；請回報，不要硬套）';
  end if;
end
$$;

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
  -- TASK-114 Demo 守門（本函式與 0012 唯一的差異）：由 Demo 體驗帳號發動的改期／取消不寄信。
  -- 判斷來源是呼叫端 JWT 的 app_metadata.is_demo（簽章後的 claim，使用者無法自行改寫），
  -- 不讀可被使用者修改的欄位。cron、service role、顧客前台請求沒有 Demo JWT（auth.jwt() 為 null
  -- 或不含 is_demo），行為與 0012 完全相同。早退發生在讀 Vault 與 net.http_post 之前。
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'is_demo', '') = 'true' then
    return new;
  end if;

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
