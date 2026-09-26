-- Offline refunds in the Stripe order amount reconciliation.
--
-- The amount check compared Stripe net customer activity against the portal
-- order total.  That is only complete while every refund goes back through
-- Stripe: money returned by cheque, cash, ACH or store credit never reaches
-- the Stripe ledger, so the charge stays whole there forever while the portal
-- total drops.  The order then reported order_amount_mismatch on every nightly
-- sweep with no reachable end state -- the incident auto-resolves only when the
-- finding stops appearing, and no data edit could make it stop.
--
-- Non-Stripe refunds are now subtracted from Stripe activity before the
-- comparison.  A refund is non-Stripe exactly when it carries no
-- stripe_refund_id: a card refund or dispute already appears as its own
-- balance transaction, and subtracting it here as well would double-count it
-- and invent a fresh mismatch in the opposite direction.
--
-- The offline total is reported in the finding either way, so an order that is
-- still genuinely short says so with the offline credit visible rather than
-- silently netting to zero.

create or replace function public.scan_stripe_reconciliation(p_grace_days integer default 7)
returns table(incident_key text, category text, severity text, summary text, record_type text, record_id text, details jsonb)
language sql
stable
security definer
set search_path to ''
as $function$
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
  -- Net customer activity (charge plus every refund/dispute adjustment, less
  -- any refund returned outside Stripe) against the portal total.  Aggregating
  -- in SQL is what makes this complete: the previous JavaScript version pulled
  -- both ledgers through PostgREST in one unbounded request and would silently
  -- drop everything past the row cap.
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
      'offline_refund_cents', f.offline_refund_cents,
      'difference_cents', a.activity_cents - f.offline_refund_cents - round(coalesce(o.total, 0) * 100)::bigint,
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
  join lateral (
    -- Only refunds with no Stripe refund id: anything Stripe processed is
    -- already counted in activity_cents as its own balance transaction.
    select coalesce(sum(round(r.amount * 100)::bigint), 0)::bigint as offline_refund_cents
    from public.webstore_order_refunds r
    where r.order_id = o.id
      and r.stripe_refund_id is null
  ) f on true
  where o.payment_mode = 'paid'
    and o.stripe_balance_transaction_id is not null
    and round(coalesce(o.total, 0) * 100)::bigint <> a.activity_cents - f.offline_refund_cents;
$function$;

revoke all on function public.scan_stripe_reconciliation(integer) from public, anon, authenticated;
grant execute on function public.scan_stripe_reconciliation(integer) to service_role;
