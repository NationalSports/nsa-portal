-- Coach-saved catalog orders: named, editable order drafts that signed-in
-- coaches build on the live-look catalog (/adidas, /livelook) and keep for
-- future review. Shared across a team — every ACTIVE coach_account linked to the
-- same customer can see and edit that customer's saved orders. Submitting a saved
-- order still goes through the catalog-order-request function (rep email +
-- catalog_order_requests row); submitting does NOT lock it, so a coach can keep
-- editing and re-submit. Portal staff (team_members) can read every team's.
CREATE TABLE IF NOT EXISTS public.coach_saved_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_id TEXT NOT NULL,                  -- sharing key: the team this order belongs to
  created_by_email TEXT,                      -- coach who first saved it (display only)
  created_by_name TEXT,
  updated_by_email TEXT,                      -- coach who last touched it (display only)
  brand TEXT NOT NULL DEFAULT 'adidas',
  name TEXT NOT NULL DEFAULT 'Untitled order',
  notes TEXT,
  -- Same line shape the catalog cart builds + the catalog-order-request fn reads:
  -- [{sku,brand,name,color,size,qty,price,inbound,decoration}]
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | submitted (stays editable either way)
  submit_count INT NOT NULL DEFAULT 0,
  last_submitted_at TIMESTAMPTZ,
  last_request_id UUID                         -- last catalog_order_requests row from a submit
);

ALTER TABLE public.coach_saved_orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_coach_saved_orders_customer
  ON public.coach_saved_orders (customer_id, updated_at DESC);

-- Keep updated_at fresh on every write (reuses the shared trigger fn from 00039).
DROP TRIGGER IF EXISTS trg_coach_saved_orders_updated ON public.coach_saved_orders;
CREATE TRIGGER trg_coach_saved_orders_updated
  BEFORE UPDATE ON public.coach_saved_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Team sharing: a signed-in coach may read/write every saved order whose
-- customer_id matches an ACTIVE coach_account of theirs (verified email or a
-- claimed auth_user_id). The coach_accounts self-read policy (00112) means the
-- only coach_accounts row this subquery can see is the coach's own, so the
-- predicate resolves to "this order belongs to my team." Covers all of
-- SELECT / INSERT / UPDATE / DELETE.
DROP POLICY IF EXISTS coach_saved_orders_team_rw ON public.coach_saved_orders;
CREATE POLICY coach_saved_orders_team_rw ON public.coach_saved_orders
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.coach_accounts ca
    WHERE ca.customer_id = coach_saved_orders.customer_id
      AND ca.status = 'active'
      AND (ca.auth_user_id = auth.uid()
           OR lower(ca.email) = lower(coalesce(auth.jwt()->>'email', '')))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.coach_accounts ca
    WHERE ca.customer_id = coach_saved_orders.customer_id
      AND ca.status = 'active'
      AND (ca.auth_user_id = auth.uid()
           OR lower(ca.email) = lower(coalesce(auth.jwt()->>'email', '')))
  ));

-- Portal staff can read every team's saved orders (mirrors coach_accounts 00113).
DROP POLICY IF EXISTS coach_saved_orders_staff_all ON public.coach_saved_orders;
CREATE POLICY coach_saved_orders_staff_all ON public.coach_saved_orders
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.auth_id = auth.uid() AND COALESCE(tm.is_active, true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.auth_id = auth.uid() AND COALESCE(tm.is_active, true)));
