-- Durable, service-only integrity monitoring for the webstore workflow.
-- The scheduled Netlify worker calls sync_webstore_integrity_incidents(), then
-- drains the alert outbox. Scans are read-only against business records: they
-- never manufacture orders, charge cards, buy labels, or guess at repairs.

create table if not exists public.webstore_integrity_incidents (
  incident_key text primary key,
  category text not null,
  severity text not null check (severity in ('warning', 'critical')),
  summary text not null,
  record_type text,
  record_id text,
  details jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_alerted_at timestamptz,
  resolved_at timestamptz,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  updated_at timestamptz not null default now()
);

create index if not exists webstore_integrity_incidents_open_idx
  on public.webstore_integrity_incidents(last_seen_at desc)
  where resolved_at is null;

create table if not exists public.webstore_integrity_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  incident_keys text[] not null check (cardinality(incident_keys) > 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webstore_integrity_alert_outbox_due_idx
  on public.webstore_integrity_alert_outbox(available_at, created_at)
  where status in ('pending', 'processing');

create table if not exists public.webstore_integrity_monitor_state (
  singleton boolean primary key default true check (singleton),
  last_scan_at timestamptz not null,
  finding_count integer not null default 0,
  open_incident_count integer not null default 0,
  last_alert_at timestamptz,
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'webstore_integrity_incidents',
    'webstore_integrity_alert_outbox',
    'webstore_integrity_monitor_state'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.scan_webstore_integrity()
returns table (
  incident_key text,
  category text,
  severity text,
  summary text,
  record_type text,
  record_id text,
  details jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Customer messages must be both durably queued and visible to staff.
  select
    'message:missing-outbox:' || m.id,
    'message_missing_outbox', 'critical',
    'A customer webstore message has no staff-notification obligation.',
    'message', m.id,
    jsonb_build_object('order_id', m.entity_id, 'created_at', m.created_at)
  from public.messages m
  where m.entity_type = 'webstore_order'
    and coalesce(m.from_customer, false)
    and m.created_at >= '2026-09-02 03:23:43+00'::timestamptz
    and not exists (
      select 1 from public.webstore_notification_outbox n
      where n.kind = 'customer_staff_reply' and n.message_id = m.id
    )

  union all
  select
    'message:unread:' || m.id,
    'customer_message_unread', 'warning',
    'A customer webstore message has remained unread for more than 30 minutes.',
    'message', m.id,
    jsonb_build_object('order_id', m.entity_id, 'created_at', m.created_at)
  from public.messages m
  where m.entity_type = 'webstore_order'
    and coalesce(m.from_customer, false)
    and not coalesce(m.read_by_staff, false)
    and m.created_at < now() - interval '30 minutes'

  union all
  select
    'notification:stuck:' || n.id::text,
    'notification_delivery_stuck', 'critical',
    'A webstore customer/staff notification is dead or overdue.',
    'notification', n.id::text,
    jsonb_build_object('kind', n.kind, 'status', n.status, 'attempts', n.attempts,
                       'created_at', n.created_at, 'available_at', n.available_at)
  from public.webstore_notification_outbox n
  left join public.webstore_shipments s on s.id = n.shipment_id
  where (
      n.status = 'dead'
      and not (
        n.kind = 'shipment_customer_email'
        and s.voided_at is not null
        and n.last_error = 'Shipment label voided before notification delivery'
      )
    ) or (
      n.status = 'pending' and n.available_at < now() - interval '20 minutes'
    ) or (
      n.status = 'processing' and n.locked_at < now() - interval '20 minutes'
    )

  union all
  select
    'shipment:missing-outbox:' || s.id::text,
    'shipment_missing_notification', 'critical',
    'An active shipment has no customer-notification obligation.',
    'shipment', s.id::text,
    jsonb_build_object('order_id', s.order_id, 'created_at', s.created_at)
  from public.webstore_shipments s
  where s.voided_at is null
    and not s.emailed
    and s.created_at >= '2026-09-02 03:23:43+00'::timestamptz
    and not exists (
      select 1 from public.webstore_notification_outbox n
      where n.kind = 'shipment_customer_email' and n.shipment_id = s.id
    )

  union all
  select
    'shipment:labeled-without-ledger:' || o.id::text,
    'labeled_order_missing_ledger', 'critical',
    'An order has complete label evidence but no active shipment ledger row.',
    'webstore_order', o.id::text,
    jsonb_build_object('order_number', o.order_number, 'created_at', o.created_at)
  from public.webstore_orders o
  where nullif(btrim(o.shipstation_shipment_id), '') is not null
    and nullif(btrim(o.tracking_number), '') is not null
    and nullif(btrim(o.label_data), '') is not null
    and o.shipped_at is not null
    and not exists (
      select 1 from public.webstore_shipments s
      where s.order_id = o.id and s.voided_at is null
    )

  union all
  select
    'shipment:cost-mismatch:' || x.id::text,
    'shipment_cost_mismatch', 'critical',
    'The order label cost does not equal its active shipment ledger total.',
    'webstore_order', x.id::text,
    jsonb_build_object('order_label_cost', x.label_cost, 'ledger_cost', x.ledger_cost)
  from (
    select o.id, o.label_cost,
           coalesce(round(sum(s.cost) filter (where s.voided_at is null), 2), 0) as ledger_cost
    from public.webstore_orders o
    left join public.webstore_shipments s on s.order_id = o.id
    where exists (select 1 from public.webstore_shipments x where x.order_id = o.id)
    group by o.id, o.label_cost
    having abs(coalesce(o.label_cost, 0)
      - coalesce(round(sum(s.cost) filter (where s.voided_at is null), 2), 0)) > 0.005
  ) x

  union all
  select
    'shipment:line-qty-mismatch:' || x.id::text,
    'shipment_line_quantity_mismatch', 'critical',
    'A tracker line quantity disagrees with the active shipment ledger.',
    'webstore_order_item', x.id::text,
    jsonb_build_object('order_id', x.order_id, 'shipped_qty', x.shipped_qty,
                       'ledger_qty', x.expected_qty)
  from (
    with ledger as (
      select s.order_id, j.item->>'lineItemKey' as line_id,
             sum(greatest(coalesce(nullif(j.item->>'qty', '')::numeric,
                                    nullif(j.item->>'quantity', '')::numeric, 0), 0)) as qty
      from public.webstore_shipments s
      cross join lateral jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) j(item)
      where s.voided_at is null and nullif(j.item->>'lineItemKey', '') is not null
      group by s.order_id, j.item->>'lineItemKey'
    )
    select i.id, i.order_id, i.shipped_qty,
           least(greatest(coalesce(i.qty, 0), 0), greatest(coalesce(l.qty, 0), 0)) as expected_qty
    from public.webstore_order_items i
    join ledger l on l.order_id = i.order_id and l.line_id = i.id::text
    where not coalesce(i.is_bundle_parent, false)
      and coalesce(i.line_status, '') <> 'cancelled'
      and abs(coalesce(i.shipped_qty, 0)
        - least(greatest(coalesce(i.qty, 0), 0), greatest(coalesce(l.qty, 0), 0))) > 0.005
  ) x

  union all
  select
    'shipment:stale-line-status:' || i.id::text,
    'fully_shipped_line_stale_status', 'warning',
    'A fully shipped tracker line is still shown in a pre-shipment status.',
    'webstore_order_item', i.id::text,
    jsonb_build_object('order_id', i.order_id, 'line_status', i.line_status)
  from public.webstore_order_items i
  where not coalesce(i.is_bundle_parent, false)
    and coalesce(i.line_status, '') <> 'cancelled'
    and coalesce(i.qty, 0) > 0
    and coalesce(i.shipped_qty, 0) >= coalesce(i.qty, 0)
    and coalesce(i.line_status, '') not in ('shipped', 'complete')

  union all
  select
    'accounting:missing-invoice:' || s.id,
    'webstore_batch_missing_invoice', 'critical',
    'A finalized webstore batch has no linked idempotent invoice.',
    'sales_order', s.id,
    jsonb_build_object('webstore_id', s.webstore_id)
  from public.sales_orders s
  where s.source = 'webstore' and s.webstore_id is not null
    and exists (select 1 from public.webstore_orders o where o.so_id = s.id)
    and not exists (
      select 1 from public.invoices i
      where i.so_id = s.id or i.idempotency_key = 'webstore:' || s.id
    )

  union all
  select
    'accounting:missing-fundraising-credit:' || s.id,
    'webstore_batch_missing_fundraising_credit', 'critical',
    'A finalized fundraising batch has no idempotent customer credit.',
    'sales_order', s.id,
    jsonb_build_object('webstore_id', s.webstore_id,
                       'expected_credit', round(s._webstore_fundraise, 2))
  from public.sales_orders s
  where s.source = 'webstore' and s.webstore_id is not null
    and coalesce(s._webstore_fundraise, 0) > 0
    and exists (select 1 from public.webstore_orders o where o.so_id = s.id)
    and not exists (
      select 1 from public.customer_credits c where c.id = 'cr_fund_so_' || s.id
    )

  union all
  select
    'accounting:invoice-payment-mismatch:' || x.id,
    'webstore_invoice_payment_mismatch', 'critical',
    'A webstore invoice paid amount does not equal its payment ledger.',
    'invoice', x.id,
    jsonb_build_object('invoice_paid', x.paid, 'payment_ledger', x.payments)
  from (
    select i.id, i.paid, coalesce(round(sum(p.amount), 2), 0) as payments
    from public.invoices i
    left join public.invoice_payments p on p.invoice_id = i.id
    where i.idempotency_key like 'webstore:%'
    group by i.id, i.paid
    having abs(coalesce(i.paid, 0) - coalesce(round(sum(p.amount), 2), 0)) > 0.005
  ) x

  union all
  select
    'accounting:refund-mismatch:' || x.id::text,
    'webstore_refund_ledger_mismatch', 'critical',
    'An order refunded amount does not equal its durable refund ledger.',
    'webstore_order', x.id::text,
    jsonb_build_object('order_refunded', x.refunded_amt, 'refund_ledger', x.ledger_amt)
  from (
    select o.id, coalesce(o.refunded_amt, 0) as refunded_amt,
           coalesce(round(sum(r.amount), 2), 0) as ledger_amt
    from public.webstore_orders o
    left join public.webstore_order_refunds r on r.order_id = o.id
    where coalesce(o.refunded_amt, 0) > 0 or r.id is not null
    group by o.id, o.refunded_amt
    having abs(coalesce(o.refunded_amt, 0) - coalesce(round(sum(r.amount), 2), 0)) > 0.005
  ) x

  -- Security canary: sensitive tables/views must not become anonymous again.
  union all
  select
    'security:anon-table:' || t.name,
    'anonymous_sensitive_table_access', 'critical',
    'Anonymous SELECT privilege was restored on a sensitive webstore table.',
    'database_table', t.name,
    '{}'::jsonb
  from unnest(array[
    'webstores', 'webstore_orders', 'webstore_order_items', 'webstore_number_claims',
    'webstore_coupons', 'webstore_roster', 'webstore_shipments', 'webstore_transfers',
    'webstore_settings', 'user_profiles'
  ]) t(name)
  where has_table_privilege('anon', format('public.%I', t.name), 'SELECT')

  union all
  select
    'security:rls-disabled:' || t.name,
    'sensitive_table_rls_disabled', 'critical',
    'RLS is disabled on a sensitive webstore table.',
    'database_table', t.name,
    '{}'::jsonb
  from unnest(array[
    'webstores', 'webstore_orders', 'webstore_order_items', 'webstore_number_claims',
    'webstore_coupons', 'webstore_roster', 'webstore_shipments', 'webstore_transfers',
    'webstore_settings', 'user_profiles'
  ]) t(name)
  join pg_catalog.pg_class c on c.relname = t.name
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where not c.relrowsecurity

  union all
  select
    'security:coach-view:' || v.name,
    'coach_view_direct_access', 'critical',
    'A broad coach webstore view regained direct client access.',
    'database_view', v.name,
    '{}'::jsonb
  from unnest(array[
    'coach_webstores', 'coach_webstore_orders', 'coach_webstore_order_items'
  ]) v(name)
  where has_table_privilege('anon', format('public.%I', v.name), 'SELECT')
     or has_table_privilege('authenticated', format('public.%I', v.name), 'SELECT')

  union all
  select
    'security:rpc:' || f.label,
    'service_rpc_client_access', 'critical',
    'A service-only webstore RPC regained direct client execution.',
    'database_function', f.label,
    '{}'::jsonb
  from (values
    ('post_webstore_customer_message', to_regprocedure('public.post_webstore_customer_message(uuid,jsonb)')),
    ('claim_webstore_notifications', to_regprocedure('public.claim_webstore_notifications(integer)')),
    ('claim_webstore_notification', to_regprocedure('public.claim_webstore_notification(text)')),
    ('complete_webstore_notification', to_regprocedure('public.complete_webstore_notification(uuid,text)')),
    ('mark_webstore_shipment_voided', to_regprocedure('public.mark_webstore_shipment_voided(uuid,text,text)')),
    ('clone_webstore_atomic', to_regprocedure('public.clone_webstore_atomic(uuid,text,text,boolean,boolean,boolean,uuid[])')),
    ('scan_webstore_integrity', to_regprocedure('public.scan_webstore_integrity()')),
    ('sync_webstore_integrity_incidents', to_regprocedure('public.sync_webstore_integrity_incidents()')),
    ('claim_webstore_integrity_alert', to_regprocedure('public.claim_webstore_integrity_alert()')),
    ('complete_webstore_integrity_alert', to_regprocedure('public.complete_webstore_integrity_alert(uuid,text)')),
    ('fail_webstore_integrity_alert', to_regprocedure('public.fail_webstore_integrity_alert(uuid,text)'))
  ) f(label, proc)
  where f.proc is null
     or has_function_privilege('anon', f.proc, 'EXECUTE')
     or has_function_privilege('authenticated', f.proc, 'EXECUTE');
$$;

revoke all on function public.scan_webstore_integrity() from public, anon, authenticated;
grant execute on function public.scan_webstore_integrity() to service_role;

create or replace function public.sync_webstore_integrity_incidents()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_findings jsonb;
  v_finding_count integer;
  v_open_count integer;
  v_resolved_count integer;
  v_alert_keys text[];
  v_alert_version timestamptz;
  v_alert_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.severity desc, f.category, f.incident_key), '[]'::jsonb)
    into v_findings
  from public.scan_webstore_integrity() f;
  v_finding_count := jsonb_array_length(v_findings);

  insert into public.webstore_integrity_incidents as existing (
    incident_key, category, severity, summary, record_type, record_id, details
  )
  select f.incident_key, f.category, f.severity, f.summary, f.record_type, f.record_id,
         coalesce(f.details, '{}'::jsonb)
  from jsonb_to_recordset(v_findings) as f(
    incident_key text, category text, severity text, summary text,
    record_type text, record_id text, details jsonb
  )
  on conflict (incident_key) do update
    set category = excluded.category,
        severity = excluded.severity,
        summary = excluded.summary,
        record_type = excluded.record_type,
        record_id = excluded.record_id,
        details = excluded.details,
        last_seen_at = now(),
        last_alerted_at = case
          when existing.resolved_at is not null then null
          else existing.last_alerted_at end,
        resolved_at = null,
        occurrence_count = case
          when existing.resolved_at is not null then 1
          else existing.occurrence_count + 1 end,
        updated_at = now();

  with resolved as (
    update public.webstore_integrity_incidents i
       set resolved_at = now(), updated_at = now()
     where i.resolved_at is null
       and not exists (
         select 1
         from jsonb_to_recordset(v_findings) as f(incident_key text)
         where f.incident_key = i.incident_key
       )
     returning 1
  ) select count(*)::integer into v_resolved_count from resolved;

  select array_agg(i.incident_key order by i.severity desc, i.category, i.incident_key),
         max(i.last_seen_at)
    into v_alert_keys, v_alert_version
  from public.webstore_integrity_incidents i
  where i.resolved_at is null
    and (i.last_alerted_at is null or i.last_alerted_at < now() - interval '24 hours')
    and not exists (
      select 1 from public.webstore_integrity_alert_outbox a
      where a.status in ('pending', 'processing') and i.incident_key = any(a.incident_keys)
    );

  if cardinality(v_alert_keys) > 0 then
    insert into public.webstore_integrity_alert_outbox (dedupe_key, incident_keys)
    values (
      md5(array_to_string(v_alert_keys, ',') || ':' || coalesce(v_alert_version::text, '')),
      v_alert_keys
    )
    on conflict (dedupe_key) do nothing
    returning id into v_alert_id;
  end if;

  select count(*)::integer into v_open_count
  from public.webstore_integrity_incidents where resolved_at is null;

  insert into public.webstore_integrity_monitor_state (
    singleton, last_scan_at, finding_count, open_incident_count, updated_at
  ) values (true, now(), v_finding_count, v_open_count, now())
  on conflict (singleton) do update
    set last_scan_at = excluded.last_scan_at,
        finding_count = excluded.finding_count,
        open_incident_count = excluded.open_incident_count,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'scanned_at', now(),
    'finding_count', v_finding_count,
    'open_incident_count', v_open_count,
    'resolved_count', coalesce(v_resolved_count, 0),
    'alert_created', v_alert_id is not null,
    'findings', v_findings
  );
end;
$$;

revoke all on function public.sync_webstore_integrity_incidents() from public, anon, authenticated;
grant execute on function public.sync_webstore_integrity_incidents() to service_role;

create or replace function public.claim_webstore_integrity_alert()
returns setof public.webstore_integrity_alert_outbox
language sql
security definer
set search_path = ''
as $$
  with candidate as (
    select id from public.webstore_integrity_alert_outbox
    where (status = 'pending' and available_at <= now())
       or (status = 'processing' and locked_at < now() - interval '10 minutes')
    order by created_at
    for update skip locked
    limit 1
  )
  update public.webstore_integrity_alert_outbox a
     set status = 'processing', attempts = a.attempts + 1,
         locked_at = now(), last_error = null, updated_at = now()
    from candidate c
   where a.id = c.id
  returning a.*;
$$;

revoke all on function public.claim_webstore_integrity_alert() from public, anon, authenticated;
grant execute on function public.claim_webstore_integrity_alert() to service_role;

create or replace function public.complete_webstore_integrity_alert(
  p_id uuid,
  p_provider_message_id text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.webstore_integrity_alert_outbox
     set status = 'sent', sent_at = now(), locked_at = null,
         provider_message_id = p_provider_message_id, last_error = null, updated_at = now()
   where id = p_id and status = 'processing'
  returning incident_keys into v_keys;
  if not found then raise exception 'integrity alert % is not processing', p_id; end if;

  update public.webstore_integrity_incidents
     set last_alerted_at = now(), updated_at = now()
   where incident_key = any(v_keys);
  update public.webstore_integrity_monitor_state
     set last_alert_at = now(), updated_at = now()
   where singleton = true;
end;
$$;

revoke all on function public.complete_webstore_integrity_alert(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_webstore_integrity_alert(uuid, text) to service_role;

create or replace function public.fail_webstore_integrity_alert(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.webstore_integrity_alert_outbox
     set status = 'pending', locked_at = null,
         available_at = now() + make_interval(mins => least(60, greatest(5, attempts * 5))),
         last_error = left(coalesce(p_error, 'Unknown alert delivery error'), 2000),
         updated_at = now()
   where id = p_id and status = 'processing';
end;
$$;

revoke all on function public.fail_webstore_integrity_alert(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_webstore_integrity_alert(uuid, text) to service_role;

comment on function public.scan_webstore_integrity() is
  'Service-only, read-only canary for webstore messages, shipments, accounting, refunds, and access boundaries.';
comment on function public.sync_webstore_integrity_incidents() is
  'Runs the integrity canary, resolves healed incidents, and durably queues deduplicated alerts.';
