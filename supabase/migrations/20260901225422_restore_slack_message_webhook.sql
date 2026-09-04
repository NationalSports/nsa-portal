-- Restore the production messages -> slack-notify delivery hook.
--
-- This deliberately lives in the non-exposed private schema: it reads the
-- service-role key from Vault so the Edge Function can keep verify_jwt=false
-- for Database Webhook compatibility while still authenticating every call in
-- its own authorizeWebhook guard. pg_net is asynchronous, so message inserts
-- never wait for Slack.

create or replace function private.notify_slack_on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  service_key text;
begin
  select decrypted_secret
    into service_key
    from vault.decrypted_secrets
   where name = 'service_role_key'
   limit 1;

  if coalesce(service_key, '') = '' then
    raise warning 'slack-notify webhook skipped: Vault secret service_role_key is missing';
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/slack-notify',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'schema', 'public',
      'record', to_jsonb(NEW),
      'old_record', null
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    timeout_milliseconds := 5000
  );

  return NEW;
end;
$$;

revoke all on function private.notify_slack_on_message_insert() from public, anon, authenticated;

drop trigger if exists slack_notify_on_message_insert on public.messages;
create trigger slack_notify_on_message_insert
after insert on public.messages
for each row
execute function private.notify_slack_on_message_insert();
