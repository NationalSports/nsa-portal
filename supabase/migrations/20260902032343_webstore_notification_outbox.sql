-- Durable notification queue for customer webstore replies and shipment email.
-- Rows contain only internal record identifiers; the worker reloads current
-- recipients/content with the service role immediately before delivery.

create table if not exists public.webstore_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('customer_staff_reply', 'shipment_customer_email')),
  dedupe_key text not null unique,
  order_id uuid not null references public.webstore_orders(id) on delete cascade,
  message_id text references public.messages(id) on delete cascade,
  shipment_id uuid references public.webstore_shipments(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'customer_staff_reply' and message_id is not null and shipment_id is null)
    or
    (kind = 'shipment_customer_email' and shipment_id is not null and message_id is null)
  )
);

create index if not exists idx_webstore_notification_outbox_due
  on public.webstore_notification_outbox(available_at, created_at)
  where status = 'pending';
create index if not exists idx_webstore_notification_outbox_stale
  on public.webstore_notification_outbox(locked_at)
  where status = 'processing';
create index if not exists idx_webstore_notification_outbox_order
  on public.webstore_notification_outbox(order_id, created_at desc);

alter table public.webstore_notification_outbox enable row level security;
revoke all on public.webstore_notification_outbox from public, anon, authenticated;
grant all on public.webstore_notification_outbox to service_role;

-- One transaction persists the public message and its notification obligation.
-- Only the service-role webstore endpoint may call it.
create or replace function public.post_webstore_customer_message(
  p_order_id uuid,
  p_message jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := nullif(trim(p_message->>'id'), '');
begin
  if v_id is null then raise exception 'message id required'; end if;
  if not exists (select 1 from public.webstore_orders where id = p_order_id) then
    raise exception 'order not found';
  end if;

  insert into public.messages (
    id, entity_type, entity_id, so_id, author_id, author, text, ts, dept,
    tagged_members, from_customer, read_by_staff
  ) values (
    v_id,
    'webstore_order',
    p_order_id::text,
    nullif(p_message->>'so_id', ''),
    nullif(p_message->>'author_id', ''),
    nullif(p_message->>'author', ''),
    p_message->>'text',
    p_message->>'ts',
    'store',
    coalesce(p_message->'tagged_members', '[]'::jsonb),
    true,
    false
  );

  insert into public.webstore_notification_outbox (
    kind, dedupe_key, order_id, message_id
  ) values (
    'customer_staff_reply',
    'customer_staff_reply:' || v_id,
    p_order_id,
    v_id
  ) on conflict (dedupe_key) do nothing;

  return v_id;
end;
$$;

revoke all on function public.post_webstore_customer_message(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.post_webstore_customer_message(uuid, jsonb) to service_role;

-- Atomic multi-worker claim. Stale processing rows are reclaimable after ten
-- minutes, so a function timeout cannot strand a notification forever.
create or replace function public.claim_webstore_notifications(p_limit integer default 20)
returns setof public.webstore_notification_outbox
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select id
    from public.webstore_notification_outbox
    where attempts < 8
      and (
        (status = 'pending' and available_at <= now())
        or (status = 'processing' and locked_at < now() - interval '10 minutes')
      )
    order by available_at, created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  update public.webstore_notification_outbox n
  set status = 'processing',
      attempts = n.attempts + 1,
      locked_at = now(),
      updated_at = now(),
      last_error = null
  from candidates c
  where n.id = c.id
  returning n.*;
$$;

revoke all on function public.claim_webstore_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_webstore_notifications(integer) to service_role;

-- Immediate delivery uses the same atomic claim as the scheduled worker, but
-- targets the one obligation just created by the request. Concurrent webhook
-- deliveries cannot both claim and send the same notification.
create or replace function public.claim_webstore_notification(p_dedupe_key text)
returns setof public.webstore_notification_outbox
language sql
security definer
set search_path = ''
as $$
  update public.webstore_notification_outbox n
  set status = 'processing',
      attempts = n.attempts + 1,
      locked_at = now(),
      updated_at = now(),
      last_error = null
  where n.dedupe_key = p_dedupe_key
    and n.attempts < 8
    and (
      (n.status = 'pending' and n.available_at <= now())
      or (n.status = 'processing' and n.locked_at < now() - interval '10 minutes')
    )
  returning n.*;
$$;

revoke all on function public.claim_webstore_notification(text) from public, anon, authenticated;
grant execute on function public.claim_webstore_notification(text) to service_role;

-- Marking a shipment notification sent and updating the customer tracker are
-- one database transaction. A crash cannot leave email delivery recorded while
-- the shipment still looks unnotified (or vice versa).
create or replace function public.complete_webstore_notification(
  p_id uuid,
  p_provider_message_id text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment_id uuid;
begin
  update public.webstore_notification_outbox
  set status = 'sent',
      sent_at = now(),
      locked_at = null,
      provider_message_id = p_provider_message_id,
      last_error = null,
      updated_at = now()
  where id = p_id
    and status = 'processing'
  returning shipment_id into v_shipment_id;

  if not found then
    raise exception 'notification % is not processing', p_id;
  end if;

  if v_shipment_id is not null then
    update public.webstore_shipments
    set emailed = true
    where id = v_shipment_id;
  end if;
end;
$$;

revoke all on function public.complete_webstore_notification(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_webstore_notification(uuid, text) to service_role;
