-- Coach accounts (phase 1): a public-catalog login tied to a portal customer.
-- Coaches sign in via Supabase magic link on /adidas; their account row is
-- matched by verified email (auth.jwt()->>'email'). The linked customer
-- supplies their adidas/UA pricing tier and school colors.
-- Writes are portal/service-role only; a coach can read only their own row.
CREATE TABLE IF NOT EXISTS public.coach_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  auth_user_id UUID UNIQUE,          -- claimed on first login (phase 2)
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

ALTER TABLE public.coach_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY coach_accounts_self_read ON public.coach_accounts
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR lower(email) = lower(coalesce(auth.jwt()->>'email',''))
  );

-- School colors (catalog color-family names, e.g. ["Maroon","Gold"]) used to
-- pre-load the catalog's team-colors filter for that customer's coaches.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS school_colors JSONB;
