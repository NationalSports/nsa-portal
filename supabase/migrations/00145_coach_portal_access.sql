-- Per-customer coach-portal capabilities. Each gates an optional area of the
-- coach portal (?portal=<alpha_tag>) so staff invite specific customers rather
-- than exposing these to everyone. All default false = unchanged for existing
-- accounts (nothing new appears until staff turns it on in the customer's
-- Catalog Access panel).
--   coach_ai_builder   -> "Build your team store" AI builder CTA
--   coach_livelook     -> Live Look live-inventory catalog (/adidas)
--   coach_build_orders -> build & submit orders from the live catalog
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS coach_ai_builder BOOLEAN DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS coach_livelook BOOLEAN DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS coach_build_orders BOOLEAN DEFAULT false;
