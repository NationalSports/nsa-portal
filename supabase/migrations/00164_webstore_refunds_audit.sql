-- Server-side refund records + atomic apply function.
--
-- Before this, refunds had no audit trail (migration 029 added only an aggregate
-- webstore_orders.refunded_amt column) and the record was written by the browser
-- after the Stripe call — non-atomic, unscoped, and raceable. This adds a per-refund
-- ledger and a single atomic function that caps at the order total, dedupes on the
-- Stripe refund id, and increments refunded_amt under a row lock.

CREATE TABLE IF NOT EXISTS public.webstore_order_refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              uuid NOT NULL REFERENCES public.webstore_orders(id) ON DELETE CASCADE,
  store_id              uuid,
  amount                numeric NOT NULL DEFAULT 0,
  kind                  text NOT NULL DEFAULT 'card',   -- card | credit | dispute
  stripe_refund_id      text UNIQUE,                     -- also dedupes dispute events ('dispute_<id>')
  stripe_pi_id          text,
  actor_team_member_id  uuid,                            -- null for webhook/dashboard-originated
  reason                text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webstore_order_refunds_order_idx ON public.webstore_order_refunds(order_id);

ALTER TABLE public.webstore_order_refunds ENABLE ROW LEVEL SECURITY;

-- Staff may read refund history for the admin UI. All writes go through the
-- service-role function/RPC below (which bypasses RLS), so there is intentionally
-- no authenticated write policy — an authenticated session cannot forge refund rows.
DROP POLICY IF EXISTS webstore_order_refunds_auth_read ON public.webstore_order_refunds;
CREATE POLICY webstore_order_refunds_auth_read ON public.webstore_order_refunds
  FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.webstore_order_refunds FROM anon, authenticated;
REVOKE ALL ON public.webstore_order_refunds FROM anon;

-- Atomic refund application. Locks the order row, enforces the over-refund cap,
-- dedupes on stripe_refund_id (idempotent for client retries and Stripe webhook
-- redelivery), records the ledger row, and increments refunded_amt — flipping the
-- order to 'refunded' only when fully covered. Returns a jsonb result.
CREATE OR REPLACE FUNCTION public.apply_webstore_refund(
  p_order_id          uuid,
  p_amount            numeric,
  p_kind              text,
  p_stripe_refund_id  text,
  p_actor             uuid,
  p_reason            text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o             record;
  new_refunded  numeric;
BEGIN
  SELECT * INTO o FROM public.webstore_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Idempotency: this Stripe refund / dispute event was already recorded.
  IF p_stripe_refund_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.webstore_order_refunds WHERE stripe_refund_id = p_stripe_refund_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
      'refunded_amt', COALESCE(o.refunded_amt, 0), 'total', COALESCE(o.total, 0));
  END IF;

  -- Disputes are recorded for visibility but never move refunded_amt/status.
  IF p_kind = 'dispute' THEN
    INSERT INTO public.webstore_order_refunds(order_id, store_id, amount, kind, stripe_refund_id, stripe_pi_id, actor_team_member_id, reason)
      VALUES (p_order_id, o.store_id, 0, 'dispute', p_stripe_refund_id, o.stripe_pi_id, p_actor, p_reason);
    RETURN jsonb_build_object('ok', true, 'dispute', true,
      'refunded_amt', COALESCE(o.refunded_amt, 0), 'total', COALESCE(o.total, 0));
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  new_refunded := COALESCE(o.refunded_amt, 0) + p_amount;
  IF new_refunded > COALESCE(o.total, 0) + 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'exceeds_total',
      'refunded_amt', COALESCE(o.refunded_amt, 0), 'total', COALESCE(o.total, 0));
  END IF;

  INSERT INTO public.webstore_order_refunds(order_id, store_id, amount, kind, stripe_refund_id, stripe_pi_id, actor_team_member_id, reason)
    VALUES (p_order_id, o.store_id, p_amount, COALESCE(p_kind, 'card'), p_stripe_refund_id, o.stripe_pi_id, p_actor, p_reason);

  UPDATE public.webstore_orders
    SET refunded_amt = new_refunded,
        status = CASE WHEN new_refunded >= COALESCE(total, 0) - 0.01 THEN 'refunded' ELSE status END
    WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'refunded_amt', new_refunded, 'total', COALESCE(o.total, 0));
END;
$$;

-- Only the service role (used by the server-side refund endpoint + Stripe webhook)
-- may run this. Prevents an authenticated browser session from applying refunds directly.
REVOKE ALL ON FUNCTION public.apply_webstore_refund(uuid, numeric, text, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_webstore_refund(uuid, numeric, text, text, uuid, text) TO service_role;
