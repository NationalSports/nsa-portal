-- Coach-favorited catalog items (the "star" on a product card). Team-shared like
-- coach_saved_orders: every ACTIVE coach_account on a customer can star/unstar and
-- see the team's favorites. A favorite points at a catalog *style* (st.key in
-- src/storefront/AdidasInventory.js = "NAME|CATEGORY") with a denormalized snapshot
-- (brand/name/category/image) so the account page can render it without re-deriving
-- from the live catalog. Portal staff (team_members) can read every team's.
CREATE TABLE IF NOT EXISTS public.coach_favorite_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_id TEXT NOT NULL,
  created_by_email TEXT,
  style_key TEXT NOT NULL,        -- catalog style identifier (name|category)
  brand TEXT,
  name TEXT,
  category TEXT,
  image_url TEXT,
  UNIQUE (customer_id, style_key) -- one star per style per team; toggling deletes the row
);

ALTER TABLE public.coach_favorite_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_coach_favorite_items_customer
  ON public.coach_favorite_items (customer_id, created_at DESC);

-- Team sharing — identical model to coach_saved_orders (00129): readable/writable
-- by any active coach_account on the same customer (matched by verified email or a
-- claimed auth_user_id). coach_accounts self-read RLS (00112) means the subquery
-- only ever sees the coach's own row, so this resolves to "belongs to my team."
DROP POLICY IF EXISTS coach_favorite_items_team_rw ON public.coach_favorite_items;
CREATE POLICY coach_favorite_items_team_rw ON public.coach_favorite_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.coach_accounts ca
    WHERE ca.customer_id = coach_favorite_items.customer_id
      AND ca.status = 'active'
      AND (ca.auth_user_id = auth.uid()
           OR lower(ca.email) = lower(coalesce(auth.jwt()->>'email', '')))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.coach_accounts ca
    WHERE ca.customer_id = coach_favorite_items.customer_id
      AND ca.status = 'active'
      AND (ca.auth_user_id = auth.uid()
           OR lower(ca.email) = lower(coalesce(auth.jwt()->>'email', '')))
  ));

DROP POLICY IF EXISTS coach_favorite_items_staff_all ON public.coach_favorite_items;
CREATE POLICY coach_favorite_items_staff_all ON public.coach_favorite_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.auth_id = auth.uid() AND COALESCE(tm.is_active, true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.auth_id = auth.uid() AND COALESCE(tm.is_active, true)));
