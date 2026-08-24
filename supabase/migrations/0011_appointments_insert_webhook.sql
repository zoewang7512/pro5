-- TASK-052（Email 通知與提醒 預約成立確認信）
-- 新增 appointments.confirmation_sent_at 欄位（重複寄送防護，比照 TASK-051 的
-- reminder_sent_at 設計，語意為「已嘗試處理」而非「已成功寄出」，見下方 route
-- 端在寄信失敗時會把它釋放回 null 的說明）；新增 Supabase Database Webhook
-- （appointments INSERT 事件），觸發 /api/webhooks/appointment-events 組確認信
-- 並寄送。
--
-- Webhook 建立方式：透過 migration SQL 建立 trigger（維持本專案「一切透過
-- migration、人工貼 SQL Editor 執行」的既有慣例，不使用 Supabase Dashboard 手動
-- 設定 Database Webhook 這種版控外的隱性狀態），呼叫 pg_net 的 net.http_post。
--
-- **密鑰與目標網址不寫死明文於本檔案**：trigger function 在「執行時」才從
-- Supabase Vault（vault.decrypted_secrets）讀取，本檔案只引用密鑰名稱
-- （'appointment_webhook_url'／'appointment_webhook_secret'）。
--
-- **部署順序（務必依序執行，順序錯誤會導致空窗期內的確認信永久遺失——見下方
-- 「pg_net 不會重試」說明）：**
--   1. 先部署帶正確 SUPABASE_WEBHOOK_SECRET 環境變數的應用程式（Vercel）。
--   2. 套用本 migration（本檔案）。
--   3. 最後才在 Supabase Dashboard 的 SQL Editor 執行以下兩個一次性指令建立 Vault
--      密鑰（不進版控；之後修改用 vault.update_secret 或 Dashboard Vault UI）：
--
--   select vault.create_secret(
--     'https://<你的正式網域>/api/webhooks/appointment-events',
--     'appointment_webhook_url'
--   );
--   select vault.create_secret(
--     '<與 .env/Vercel 環境變數的 SUPABASE_WEBHOOK_SECRET 完全相同的值>',
--     'appointment_webhook_secret'
--   );
--
-- 若上述兩個 Vault 密鑰尚未設定，trigger function 會直接略過寄送 HTTP 請求（不會
-- 讓 INSERT 失敗），詳見下方 notify_appointment_insert() 的判斷。
--
-- **pg_net 不會重試**：net.http_post 只是把請求寫進 net.http_request_queue 交給
-- 背景 worker 送出一次，不論目標端點回應什麼狀態碼都不會重送。這代表：(a) 部署
-- 順序錯誤導致端點暫時 404／401 時，那段時間新增的預約會永久收不到確認信，沒有
-- 自動補救機制；(b) route 端「回 200」不是為了避免觸發 pg_net 重試（它本來就不會
-- 重試），而是避免非 2xx 回應污染監控訊號。人工排查可執行
-- `select * from net._http_response order by created desc limit 20;` 檢視最近
-- 的寄送嘗試與回應狀態。
--
-- 套用前建議先確認 pg_net 實際安裝的 schema（本 migration 假設是預設的 net）：
-- `select extnamespace::regnamespace from pg_extension where extname = 'pg_net';`
--
-- 可重複執行（idempotent）：使用 if not exists / drop ... if exists / create or replace。
-- 對應回滾腳本：0011_appointments_insert_webhook_down.sql

begin;

-- ============================================================
-- 重複寄送防護欄位（比照 0010 的 reminder_sent_at 設計）
-- ============================================================
alter table public.appointments
  add column if not exists confirmation_sent_at timestamptz;

-- ============================================================
-- pg_net：DB 端發出非同步 HTTP 請求所需的擴充套件
-- ============================================================
create extension if not exists pg_net;

-- ============================================================
-- notify_appointment_insert：appointments INSERT 後觸發，呼叫 webhook 端點
-- ============================================================
-- 整段包在 exception handler 內：這支 trigger 掛在 appointments 的 AFTER INSERT，
-- 也就是 create_appointment RPC（0002_booking_flow.sql）的寫入路徑上。若沒有
-- exception handler，任何非預期例外（Vault schema/權限問題、net.http_post 解析
-- 失敗等）都會讓例外原樣往外傳，被 create_appointment 的 `when others` 分支吞成
-- INTERNAL_ERROR，等於「寄確認信」這個附加動作能讓顧客的預約整筆回滾——這與本卡
-- 「webhook 是額外掛上去的旁路機制，不影響既有預約寫入邏輯」的設計意圖完全相反
-- （architect／security-reviewer／test-engineer 於本卡審查一致提出的 MUST FIX）。
create or replace function public.notify_appointment_insert()
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

  -- Vault 密鑰尚未設定時（例如本機開發環境未執行上述人工步驟），略過寄送但不阻擋
  -- INSERT 本身——寄確認信是預約成立後的附加動作，不是交易的一部分。
  if v_webhook_url is null or v_webhook_secret is null then
    return new;
  end if;

  -- payload 只帶 appointment id，不把整列（含 access_token 這個顧客自助查詢用的
  -- capability token、customer_phone 等個資欄位）送到 webhook 目標網址——本卡不
  -- 使用 access_token（見任務卡「假設」段落），route 端會用 service role client
  -- 依 id 重新讀回實際需要的欄位，不信任 payload 內容（security-reviewer 於本卡
  -- 審查提出的 MUST FIX：整列外送會把一個目前零暴露面的憑證，隨 Vault 密鑰設定
  -- 錯誤的風險一併擴散到 DB 之外）。
  perform net.http_post(
    url := v_webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'appointments',
      'schema', 'public',
      'record', jsonb_build_object('id', new.id),
      'old_record', null
    ),
    timeout_milliseconds := 15000
  );

  return new;
exception
  when others then
    -- 任何例外（Vault 讀取失敗、net.http_post 解析失敗等）都只記警告、不往外傳，
    -- 確保這支旁路機制永遠不會讓 appointments 的 INSERT 本身失敗。
    raise warning 'notify_appointment_insert: webhook dispatch failed for appointment % (%): %',
      new.id, sqlstate, sqlerrm;
    return new;
end;
$$;

revoke execute on function public.notify_appointment_insert() from public;

drop trigger if exists appointments_notify_insert on public.appointments;
create trigger appointments_notify_insert
  after insert on public.appointments
  for each row
  -- customer_email 為 null 的預約（例如後台手動建立、未來的資料匯入）不需要觸發
  -- webhook，省下無謂的 pg_net 請求與 route 端 serverless invocation
  -- （architect 於本卡審查建議）。PostgreSQL 的 CREATE TRIGGER 語法規定 WHEN 子句
  -- 必須接在 FOR EACH ROW 之後，寫反順序會直接語法錯誤（syntax error at or near
  -- "for"）——本檔案套用時曾實際踩到這個錯誤，記錄於此避免日後修改時重蹈覆轍。
  when (new.customer_email is not null)
  execute function public.notify_appointment_insert();

commit;
