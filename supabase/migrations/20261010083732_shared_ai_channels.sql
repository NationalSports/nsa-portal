alter table public.ai_inbox_messages
  add column if not exists mailbox_email text,
  add column if not exists source_channel text not null default 'gmail',
  add column if not exists source_message_id text,
  add column if not exists webstore_order_id uuid references public.webstore_orders(id) on delete set null;
create unique index if not exists ai_inbox_source_message_unique
  on public.ai_inbox_messages(source_channel, source_message_id)
  where source_message_id is not null;
create index if not exists ai_inbox_mailbox_received
  on public.ai_inbox_messages(mailbox_email, received_at desc);
create index if not exists ai_inbox_webstore_order
  on public.ai_inbox_messages(webstore_order_id) where webstore_order_id is not null;

-- Customer messages become durable AI work in the same transaction. Staff
-- replies never enqueue work, preventing response loops.
create or replace function private.queue_webstore_ai_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.webstore_orders%rowtype;
begin
  if new.entity_type <> 'webstore_order' or new.from_customer is not true then return new; end if;
  select * into o from public.webstore_orders where id::text = new.entity_id::text;
  if not found or coalesce(o.buyer_email, '') = '' then return new; end if;
  insert into public.ai_inbox_messages (
    gmail_message_id,gmail_thread_id,source_channel,source_message_id,
    webstore_order_id,mailbox_email,sender_email,sender_name,to_emails,
    subject,text_body,snippet,received_at,status
  ) values (
    'webstore:' || new.id::text, 'webstore:' || o.id::text, 'webstore', new.id::text,
    o.id, 'stores@nationalsportsapparel.com', o.buyer_email, o.buyer_name,
    '["stores@nationalsportsapparel.com"]'::jsonb,
    'Store order ' || coalesce(o.omg_order_number::text,o.id::text),
    new.text,left(new.text,200),now(),'queued'
  ) on conflict (gmail_message_id) do nothing;
  return new;
end;
$$;
revoke all on function private.queue_webstore_ai_message() from public, anon, authenticated;
drop trigger if exists queue_webstore_ai_message on public.messages;
create trigger queue_webstore_ai_message after insert on public.messages
for each row execute function private.queue_webstore_ai_message();
