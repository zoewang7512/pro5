-- TASK-053（Email 通知與提醒 取消／改期時寄送通知信）
-- 新增 appointments UPDATE 事件的 Database Webhook trigger，沿用 TASK-052
-- （0011_appointments_insert_webhook.sql）已建立的 Vault 密鑰
-- （appointment_webhook_url／appointment_webhook_secret）與目標端點——同一支
-- `/api/webhooks/appointment-events` 依 payload 的 `type` 欄位分派到 INSERT／
-- UPDATE 各自的處理函式，不需要另外設定密鑰或網址。
--
-- 註：任務卡（TASK-053.md）原本「允許變更的檔案」清單沒有列出本 migration
-- 檔案——這是任務卡在 TASK-052 實際定案 trigger-based 架構之前寫的既有疏漏
-- （純資料查詢的 webhook 端點若沒有對應的 DB trigger，UPDATE 分支永遠不會被
-- 觸發，需求無法達成）。新增本檔案是履行任務卡本身「需求」段落的必要手段，已於
-- TASK-053.md 的「允許變更的檔案」清單與完成證據中明確記錄。
--
-- **部署順序（務必依序執行；比照 0011 的既有慣例，本卡沒有新增 Vault 密鑰，
-- 但仍需要先部署帶 handleAppointmentUpdate 的應用程式，否則空窗期內套用本
-- migration 會讓 UPDATE webhook 打到舊版 route.ts，得到
-- `{ok:true, skipped:"type_not_handled"}`——由於 pg_net 不會重試，該空窗期內
-- 的取消／改期通知信會永久遺失，且回應 200 完全沒有異常訊號，比 0011 當初
-- 「密鑰未設定」的情境更難察覺，architect 於本卡審查提出）：
--   1. 先部署帶 `handleAppointmentUpdate` 的應用程式（Vercel）。
--   2. 套用本 migration（本檔案）。
--
-- **密鑰與目標網址不寫死明文於本檔案**：與 0011 相同，trigger function 在
-- 「執行時」才從 Supabase Vault 讀取。
--
-- **pg_net 不會重試**：與 0011 相同的既知限制。UPDATE 事件（取消／改期）不像
-- INSERT 分支有 confirmation_sent_at 去重欄位——這是刻意的設計決策，不是疏漏：
-- lib/admin/appointments.ts 的 cancelAppointment／rescheduleAppointment 本身已
-- 有狀態機／樂觀鎖保護，同一筆預約不可能被重複觸發兩次「真正的」取消或改期
-- UPDATE，因此不存在需要去重的重複觸發風險（詳見 route.ts 的
-- handleAppointmentUpdate 函式頭部說明）。**已知殘留風險**（architect 於本卡
-- 審查提出，NICE TO HAVE，非本卡阻斷項）：webhook 端點沒有節流機制，若
-- `SUPABASE_WEBHOOK_SECRET` 外洩，攻擊者可對同一筆真實存在的預約重放同一個
-- webhook payload 任意次數，每次都會寄出一封通知信（不同於 INSERT 分支有
-- `confirmation_sent_at` 天然擋住重放）；此風險與密鑰外洩本身同源，留待未來
-- 視需要另立任務卡處理（例如加節流欄位）。
--
-- 可重複執行（idempotent）：使用 drop ... if exists / create or replace。
-- 對應回滾腳本：0012_appointments_update_webhook_down.sql

begin;

-- ============================================================
-- notify_appointment_update：appointments UPDATE 後觸發，呼叫 webhook 端點
-- ============================================================
-- 與 0011 的 notify_appointment_insert() 相同，整段包在 exception handler 內，
-- 確保這支旁路機制的任何失敗都不會讓 appointments 的 UPDATE 本身失敗（例如
-- cancelAppointment／rescheduleAppointment 呼叫端不應該因為 webhook 端故障就
-- 收到取消/改期失敗的錯誤）。
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

drop trigger if exists appointments_notify_update on public.appointments;
create trigger appointments_notify_update
  after update on public.appointments
  for each row
  -- 只在「真正的取消或改期」時觸發，把 markAppointmentCompleted（僅 status 變為
  -- completed）、TASK-052 確認信去重的 confirmation_sent_at 更新、以及未來
  -- TASK-054 的 reminder_sent_at 更新全部排除在外。
  -- `old.status is distinct from new.status and new.status = 'cancelled'`
  -- （而不是單純 `new.status = 'cancelled'`）：後者會讓「已經是 cancelled 的
  -- 預約」之後的任何 UPDATE（例如上述幾種欄位更新）都白白觸發一次 pg_net +
  -- serverless invocation，即使 route 端最終會正確分類成 "none" 不寄信，仍是
  -- 浪費（architect 於本卡審查提出的 NICE TO HAVE，已收斂）。
  -- 注意：WHEN 的整個布林條件必須包在單一組括號內（PostgreSQL 的 CREATE
  -- TRIGGER 語法是 `WHEN ( condition )`，不能寫成 `WHEN (a) AND b`，那樣
  -- `AND` 會落在括號外變成語法錯誤）——用巢狀括號把整個條件包成一組。另外
  -- FOR EACH ROW 必須在 WHEN 之前（TASK-052 套用 0011 migration 時曾把順序寫反
  -- 導致 `syntax error at or near "for"`，見 0011 檔案的教訓），本檔案已確認
  -- 順序正確。
  when (
    (
      (old.status is distinct from new.status and new.status = 'cancelled')
      or old.start_at is distinct from new.start_at
      or old.end_at is distinct from new.end_at
    )
    and new.customer_email is not null
  )
  execute function public.notify_appointment_update();

commit;
