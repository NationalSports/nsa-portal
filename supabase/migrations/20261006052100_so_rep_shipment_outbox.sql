begin;
-- Rep-only delivery has its own retry state; never mark the coach notified.
create table public.so_rep_shipment_outbox (
  id uuid primary key,
  so_id text not null references public.sales_orders(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.so_rep_shipment_outbox enable row level security;
revoke all on public.so_rep_shipment_outbox from public, anon, authenticated;
grant select, insert, update on public.so_rep_shipment_outbox to service_role;
create index so_rep_shipment_outbox_pending on public.so_rep_shipment_outbox(status,available_at);
create index so_rep_shipment_outbox_so on public.so_rep_shipment_outbox(so_id);
create function public.claim_so_rep_shipment_emails(p_id uuid default null)
returns setof public.so_rep_shipment_outbox language sql security invoker set search_path='' as $$
  with picked as (
    select id from public.so_rep_shipment_outbox
    where (p_id is null or id=p_id) and
      ((status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '10 minutes'))
    order by available_at for update skip locked limit 3
  ) update public.so_rep_shipment_outbox q
  set status='processing',attempts=q.attempts+1,locked_at=now()
  from picked where q.id=picked.id returning q.*;
$$;
revoke all on function public.claim_so_rep_shipment_emails(uuid) from public, anon, authenticated;
grant execute on function public.claim_so_rep_shipment_emails(uuid) to service_role;
commit;
