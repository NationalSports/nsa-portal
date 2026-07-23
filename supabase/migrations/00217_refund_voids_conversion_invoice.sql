-- Audit fix (build audit, HIGH): a FULL refund voids the conversion invoice.
--
-- THE BUG: apply_webstore_refund (00164) records the refund + flips the webstore
-- order to 'refunded', but never touches the invoice the conversion created
-- (create_teamshop_sales_order 00196/00199, create_club_sales_order 00207). That
-- invoice stays status='paid', paid=full — and the Commissions page counts every
-- paid/partial invoice (CommissionsPage.js: `if(inv.status!=='paid'&&inv.status!=='partial')return false`),
-- while A/R treats 'void'/'cancelled' as dead. So a refunded order's revenue kept
-- earning commission and sitting in A/R forever.
--
-- THE FIX (product decision: void, alert-only on production): on a FULL refund of
-- a CONVERTED order (so_id set), void the SO's live invoice(s). 'void' is the
-- stack's existing dead-invoice status (rep-ops-digest DEAD_STATUS, followup-sweep
-- terminal), so this drops the invoice from BOTH commissions and A/R. Partial
-- refunds are left alone (the invoice still reflects real collected revenue). This
-- is the ONLY change from the 00164 body (extracted verbatim + the one IF block).
--
-- NUANCE (documented, by design): a commission SNAPSHOT already frozen for this
-- invoice (commission_snapshots — "stops moving once paid") is NOT auto-reversed
-- here; an admin uses the Commissions page "Re-freeze" to pick up the void. The
-- refund also fires a staff alert (stripe-webhook alertStaffOfRefund) so production
-- can be halted by hand — production jobs are deliberately NOT auto-held.
--
-- Idempotent: re-running (Stripe webhook redelivery) dedupes on stripe_refund_id
-- before reaching here, and the invoice UPDATE only touches a still-live invoice.
--
-- Rollback: re-apply the apply_webstore_refund block from 00164_webstore_refunds_audit.sql.

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

  -- ── FULL refund of a CONVERTED order → void the conversion invoice(s). ──
  -- Same threshold as the status flip above. Only fires when the order actually
  -- converted (so_id set) and only voids a still-live invoice. Drops the invoice
  -- from commissions (paid/partial only) and A/R (void is a dead status).
  IF new_refunded >= COALESCE(o.total, 0) - 0.01 AND o.so_id IS NOT NULL THEN
    UPDATE public.invoices
       SET status = 'void',
           memo = COALESCE(memo, '')
                  || E'\n[Auto-voided ' || to_char(now(), 'MM/DD/YYYY')
                  || ': webstore order fully refunded]',
           updated_at = now()
     WHERE so_id = o.so_id
       AND status NOT IN ('void', 'cancelled');
  END IF;

  RETURN jsonb_build_object('ok', true, 'refunded_amt', new_refunded, 'total', COALESCE(o.total, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.apply_webstore_refund(uuid, numeric, text, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_webstore_refund(uuid, numeric, text, text, uuid, text) TO service_role;
