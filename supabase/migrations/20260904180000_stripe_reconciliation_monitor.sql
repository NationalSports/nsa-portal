-- Durable, service-only incident + alert-outbox monitoring for the nightly
-- Stripe settlement sweep.  It mirrors the webstore integrity monitor: the
-- scheduled Netlify worker classifies PaymentIntents, records what it found,
-- calls sync_stripe_reconciliation_incidents(), then drains at most one alert.
--
-- Nothing here moves money.  The scan is read-only against business records; it
-- never links a charge, promotes an order to paid, or creates a QuickBooks row.

-- ---------------------------------------------------------------------------
-- Durable state
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_reconciliation_incidents (
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

create index if not exists stripe_reconciliation_incidents_open_idx
  on public.stripe_reconciliation_incidents(last_seen_at desc)
  where resolved_at is null;

create table if not exists public.stripe_reconciliation_alert_outbox (
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

create index if not exists stripe_reconciliation_alert_outbox_due_idx
  on public.stripe_reconciliation_alert_outbox(available_at, created_at)
  where status in ('pending', 'processing');

create table if not exists public.stripe_reconciliation_monitor_state (
  singleton boolean primary key default true check (singleton),
  last_scan_at timestamptz not null,
  finding_count integer not null default 0,
  open_incident_count integer not null default 0,
  last_alert_at timestamptz,
  updated_at timestamptz not null default now()
);

-- What the sweep actually learned from Stripe about one unlinked order.  This
-- is the difference between "no ledger link" and "no money to link": the portal
-- alone cannot tell those apart, and without a durable record every night's
-- alert would repeat the same unanswerable question.
create table if not exists public.stripe_reconciliation_order_checks (
  order_id uuid primary key,
  payment_intent_id text,
  payment_intent_status text,
  portal_status text,
  disposition text not null check (disposition in ('linked', 'not_succeeded', 'missing_in_stripe', 'error')),
  last_error text,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'stripe_reconciliation_incidents',
    'stripe_reconciliation_alert_outbox',
    'stripe_reconciliation_monitor_state',
    'stripe_reconciliation_order_checks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Classification record from the sweep's read-only Stripe lookups
-- ---------------------------------------------------------------------------

create or replace function public.record_stripe_reconciliation_order_checks(p_checks jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  insert into public.stripe_reconciliation_order_checks as existing (
    order_id, payment_intent_id, payment_intent_status, portal_status,
    disposition, last_error, checked_at, updated_at
  )
  select c.order_id, c.payment_intent_id, c.payment_intent_status, c.portal_status,
         c.disposition, left(c.last_error, 2000), now(), now()
  from jsonb_to_recordset(coalesce(p_checks, '[]'::jsonb)) as c(
    order_id uuid, payment_intent_id text, payment_intent_status text,
    portal_status text, disposition text, last_error text
  )
  where c.order_id is not null
    and c.disposition in ('linked', 'not_succeeded', 'missing_in_stripe', 'error')
  on conflict (order_id) do update
    set payment_intent_id = excluded.payment_intent_id,
        payment_intent_status = excluded.payment_intent_status,
        portal_status = excluded.portal_status,
        disposition = excluded.disposition,
        last_error = excluded.last_error,
        checked_at = excluded.checked_at,
        updated_at = excluded.updated_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_stripe_reconciliation_order_checks(jsonb) from public, anon, authenticated;
grant execute on function public.record_stripe_reconciliation_order_checks(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Read-only finding scan
-- ---------------------------------------------------------------------------

create or replace function public.scan_stripe_reconciliation(p_grace_days integer default 7)
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
  -- Card orders past the grace window with no settlement link.  The category
  -- comes from what Stripe actually said about the PaymentIntent, not from the
  -- portal status, so a real money gap can never be filed as a status question.
  select
    'order:unlinked:' || o.id::text,
    case
      when k.disposition = 'error' then 'order_link_error'
      when k.disposition = 'missing_in_stripe' then 'stripe_payment_intent_missing'
      when k.disposition = 'not_succeeded' then 'portal_payment_status_review'
      when k.order_id is null then 'order_link_not_attempted'
      else 'settled_order_unlinked'
    end,
    case
      when k.disposition = 'error' then 'critical'
      when k.order_id is null then 'warning'
      when k.disposition in ('missing_in_stripe', 'not_succeeded') then 'warning'
      else 'critical'
    end,
    case
      when k.disposition = 'error'
        then 'A card order could not be checked against Stripe.'
      when k.disposition = 'missing_in_stripe'
        then 'A card order references a PaymentIntent Stripe will not return.'
      when k.disposition = 'not_succeeded'
        then 'A non-pending card order has no successful Stripe payment.'
      when k.order_id is null
        then 'An old card order has not been checked against Stripe yet.'
      else 'A settled Stripe charge is missing its portal ledger link.'
    end,
    'webstore_order', o.id::text,
    jsonb_build_object(
      'so_id', o.so_id,
      'portal_status', o.status,
      'portal_total_cents', round(coalesce(o.total, 0) * 100)::bigint,
      'created_at', o.created_at,
      'payment_intent_id', o.stripe_pi_id,
      'payment_intent_status', k.payment_intent_status,
      'disposition', coalesce(k.disposition, 'not attempted'),
      'checked_at', k.checked_at,
      'last_error', k.last_error
    )
  from public.webstore_orders o
  left join public.stripe_reconciliation_order_checks k on k.order_id = o.id
  where o.payment_mode = 'paid'
    and o.stripe_pi_id is not null
    and o.stripe_balance_transaction_id is null
    and coalesce(o.status, '') <> 'pending_payment'
    and o.created_at < now() - make_interval(days => greatest(0, coalesce(p_grace_days, 7)))
    -- A cancelled checkout that Stripe confirms was never paid is a normal
    -- outcome, not an accounting gap.  It only stops being a finding once
    -- Stripe has actually been asked -- silence is never assumed.
    -- coalesce is load-bearing: k.disposition is NULL for an order that has
    -- never been checked, and `not (NULL and true)` is NULL, which would drop
    -- the unchecked order out of the scan entirely.
    and not (
      coalesce(k.disposition, '') in ('not_succeeded', 'missing_in_stripe')
      and lower(coalesce(o.status, '')) in ('cancelled', 'canceled')
    )

  union all
  -- Automatic payouts Stripe has paid to the bank that the portal cannot prove.
  select
    'payout:actionable:' || p.stripe_payout_id,
    'payout_not_reconciled', 'critical',
    'A paid automatic payout is not reconciled against the settlement ledger.',
    'stripe_payout', p.stripe_payout_id,
    jsonb_build_object(
      'amount_cents', p.amount_cents,
      'reconciliation_status', p.reconciliation_status,
      'difference_cents', p.reconciliation_difference_cents,
      'arrival_date', p.arrival_date
    )
  from public.stripe_payouts p
  where p.automatic and p.status = 'paid'
    and coalesce(p.reconciliation_status, 'pending') in ('pending', 'mismatch', 'failed')

  union all
  select
    'payout:failed:' || p.stripe_payout_id,
    'payout_failed', 'critical',
    'An automatic payout to the bank failed or was canceled.',
    'stripe_payout', p.stripe_payout_id,
    jsonb_build_object(
      'amount_cents', p.amount_cents,
      'status', p.status,
      'failure_code', p.failure_code,
      'failure_message', p.failure_message,
      'arrival_date', p.arrival_date
    )
  from public.stripe_payouts p
  where p.automatic and p.status in ('failed', 'canceled')
    and p.stripe_created_at >= now() - interval '30 days'

  union all
  -- Net customer activity (charge plus every refund/dispute adjustment) against
  -- the portal total.  Aggregating in SQL is what makes this complete: the
  -- previous JavaScript version pulled both ledgers through PostgREST in one
  -- unbounded request and would silently drop everything past the row cap.
  select
    'order:amount-mismatch:' || o.id::text,
    'order_amount_mismatch', 'critical',
    'Stripe net customer activity does not equal the portal order total.',
    'webstore_order', o.id::text,
    jsonb_build_object(
      'so_id', o.so_id,
      'portal_total_cents', round(coalesce(o.total, 0) * 100)::bigint,
      'stripe_charge_cents', c.amount_cents,
      'stripe_activity_cents', a.activity_cents,
      'difference_cents', a.activity_cents - round(coalesce(o.total, 0) * 100)::bigint,
      'created_at', o.created_at
    )
  from public.webstore_orders o
  join public.stripe_balance_transactions c
    on c.stripe_balance_transaction_id = o.stripe_balance_transaction_id
   and c.reporting_category = 'charge'
  join lateral (
    select coalesce(sum(t.amount_cents), 0)::bigint as activity_cents
    from public.stripe_balance_transactions t
    where t.webstore_order_id = o.id
  ) a on true
  where o.payment_mode = 'paid'
    and o.stripe_balance_transaction_id is not null
    and round(coalesce(o.total, 0) * 100)::bigint <> a.activity_cents;
$$;

revoke all on function public.scan_stripe_reconciliation(integer) from public, anon, authenticated;
grant execute on function public.scan_stripe_reconciliation(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Incident sync + deduplicated alert queueing
-- ---------------------------------------------------------------------------

-- p_runtime_findings carries the findings only the worker can observe -- the
-- live Stripe webhook subscription and per-payout catch-up errors -- so every
-- finding, wherever it came from, gets the same incident and reminder policy.
create or replace function public.sync_stripe_reconciliation_incidents(
  p_runtime_findings jsonb default '[]'::jsonb,
  p_grace_days integer default 7
)
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
  v_alert_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  with combined as (
    select f.incident_key, f.category, f.severity, f.summary,
           f.record_type, f.record_id, coalesce(f.details, '{}'::jsonb) as details
    from public.scan_stripe_reconciliation(p_grace_days) f
    union all
    select r.incident_key, r.category, r.severity, r.summary,
           r.record_type, r.record_id, coalesce(r.details, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_runtime_findings, '[]'::jsonb)) as r(
      incident_key text, category text, severity text, summary text,
      record_type text, record_id text, details jsonb
    )
    where r.incident_key is not null
      and r.severity in ('warning', 'critical')
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.severity desc, c.category, c.incident_key), '[]'::jsonb)
    into v_findings
  from combined c;
  v_finding_count := jsonb_array_length(v_findings);

  insert into public.stripe_reconciliation_incidents as existing (
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
        -- A reopened incident alerts again immediately rather than inheriting
        -- the resolved run's 24 hour reminder suppression.
        last_alerted_at = case
          when existing.resolved_at is not null then null
          else existing.last_alerted_at end,
        resolved_at = null,
        occurrence_count = case
          when existing.resolved_at is not null then 1
          else existing.occurrence_count + 1 end,
        updated_at = now();

  with resolved as (
    update public.stripe_reconciliation_incidents i
       set resolved_at = now(), updated_at = now()
     where i.resolved_at is null
       and not exists (
         select 1
         from jsonb_to_recordset(v_findings) as f(incident_key text)
         where f.incident_key = i.incident_key
       )
     returning 1
  ) select count(*)::integer into v_resolved_count from resolved;

  select array_agg(i.incident_key order by i.severity desc, i.category, i.incident_key)
    into v_alert_keys
  from public.stripe_reconciliation_incidents i
  where i.resolved_at is null
    -- 23 hours, not 24: the sweep is nightly, and last_alerted_at is stamped a
    -- few seconds into the run. An exact 24 hour window would fall marginally
    -- short on the next night and silently push each reminder out a full day.
    and (i.last_alerted_at is null or i.last_alerted_at < now() - interval '23 hours')
    and not exists (
      select 1 from public.stripe_reconciliation_alert_outbox a
      where a.status in ('pending', 'processing') and i.incident_key = any(a.incident_keys)
    );

  if cardinality(v_alert_keys) > 0 then
    -- The dedupe key is the finding set plus the UTC day, never a per-run
    -- timestamp: two concurrent invocations over the same findings collide on
    -- one row instead of queueing two identical emails, while a genuinely new
    -- finding still queues its own alert the same day.
    insert into public.stripe_reconciliation_alert_outbox (dedupe_key, incident_keys)
    values (
      md5(array_to_string(v_alert_keys, ',') || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')),
      v_alert_keys
    )
    on conflict do nothing
    returning id into v_alert_id;
  end if;

  select count(*)::integer into v_open_count
  from public.stripe_reconciliation_incidents where resolved_at is null;

  insert into public.stripe_reconciliation_monitor_state (
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

revoke all on function public.sync_stripe_reconciliation_incidents(jsonb, integer) from public, anon, authenticated;
grant execute on function public.sync_stripe_reconciliation_incidents(jsonb, integer) to service_role;

create or replace function public.claim_stripe_reconciliation_alert()
returns setof public.stripe_reconciliation_alert_outbox
language sql
security definer
set search_path = ''
as $$
  with candidate as (
    select id from public.stripe_reconciliation_alert_outbox
    where (status = 'pending' and available_at <= now())
       or (status = 'processing' and locked_at < now() - interval '10 minutes')
    order by created_at
    for update skip locked
    limit 1
  )
  update public.stripe_reconciliation_alert_outbox a
     set status = 'processing', attempts = a.attempts + 1,
         locked_at = now(), last_error = null, updated_at = now()
    from candidate c
   where a.id = c.id
  returning a.*;
$$;

revoke all on function public.claim_stripe_reconciliation_alert() from public, anon, authenticated;
grant execute on function public.claim_stripe_reconciliation_alert() to service_role;

create or replace function public.complete_stripe_reconciliation_alert(
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
  update public.stripe_reconciliation_alert_outbox
     set status = 'sent', sent_at = now(), locked_at = null,
         provider_message_id = p_provider_message_id, last_error = null, updated_at = now()
   where id = p_id and status = 'processing'
  returning incident_keys into v_keys;
  if not found then raise exception 'stripe reconciliation alert % is not processing', p_id; end if;

  update public.stripe_reconciliation_incidents
     set last_alerted_at = now(), updated_at = now()
   where incident_key = any(v_keys);
  update public.stripe_reconciliation_monitor_state
     set last_alert_at = now(), updated_at = now()
   where singleton = true;
end;
$$;

revoke all on function public.complete_stripe_reconciliation_alert(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_stripe_reconciliation_alert(uuid, text) to service_role;

create or replace function public.fail_stripe_reconciliation_alert(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.stripe_reconciliation_alert_outbox
     set status = 'pending', locked_at = null,
         available_at = now() + make_interval(mins => least(60, greatest(5, attempts * 5))),
         last_error = left(coalesce(p_error, 'Unknown alert delivery error'), 2000),
         updated_at = now()
   where id = p_id and status = 'processing';
end;
$$;

revoke all on function public.fail_stripe_reconciliation_alert(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_stripe_reconciliation_alert(uuid, text) to service_role;

comment on function public.scan_stripe_reconciliation(integer) is
  'Service-only, read-only Stripe settlement scan. Aggregates net customer activity in SQL so the result is not truncated by the PostgREST row cap.';
comment on function public.sync_stripe_reconciliation_incidents(jsonb, integer) is
  'Runs the Stripe settlement scan, merges worker runtime findings, resolves healed incidents, and durably queues one deduplicated alert.';
comment on table public.stripe_reconciliation_order_checks is
  'What Stripe reported for an unlinked card order. Distinguishes a missing ledger link from an order that was never successfully paid.';
