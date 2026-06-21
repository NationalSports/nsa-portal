-- Free promo items: $0-cost items given as promotions that still require decoration.
-- Unlike the co-op promo program (is_promo), these items are excluded from all
-- financial totals and reports. NSA provides them at no charge to the customer.
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS is_free_promo BOOLEAN DEFAULT false;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS _pre_free_promo_sell NUMERIC;
ALTER TABLE so_items ADD COLUMN IF NOT EXISTS is_free_promo BOOLEAN DEFAULT false;
ALTER TABLE so_items ADD COLUMN IF NOT EXISTS _pre_free_promo_sell NUMERIC;
