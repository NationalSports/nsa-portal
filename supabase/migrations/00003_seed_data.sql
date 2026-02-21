-- ============================================================
-- NSA Portal – Seed / Reference Data
-- Migration: 00003_seed_data
-- ============================================================

-- ─── Decoration Types ──────────────────────────────────────

insert into public.decoration_types (name, code) values
  ('Screen Print',   'screen_print'),
  ('Embroidery',     'embroidery'),
  ('Heat Transfer',  'heat_transfer'),
  ('DTF',            'dtf'),
  ('Sublimation',    'sublimation'),
  ('Vinyl',          'vinyl');

-- ─── Price Matrix: Screen Print ────────────────────────────
-- SP qty breaks: 1-11, 12-23, 24-35, 36-47, 48-71, 72-107, 108-143, 144-215, 216-499, 500+
-- Tiers: 1 Color, 2 Color, 3 Color, 4 Color, 5 Color
-- Prices are SELL prices; cost = sell / 1.5 (SP markup = 1.5)

insert into public.price_matrix (decoration_type_id, tier_name, tier_sort, qty_min, qty_max, price_per_piece)
select dt.id, t.tier_name, t.tier_sort, t.qty_min, t.qty_max, t.price
from public.decoration_types dt
cross join (values
  -- 1 Color
  ('1 Color', 1,   1,    11,  5.00),
  ('1 Color', 1,  12,    23,  3.50),
  ('1 Color', 1,  24,    35,  3.20),
  ('1 Color', 1,  36,    47,  2.95),
  ('1 Color', 1,  48,    71,  2.75),
  ('1 Color', 1,  72,   107,  2.50),
  ('1 Color', 1, 108,   143,  2.25),
  ('1 Color', 1, 144,   215,  2.10),
  ('1 Color', 1, 216,   499,  1.90),
  -- 2 Color
  ('2 Color', 2,   1,    11,  6.50),
  ('2 Color', 2,  12,    23,  4.50),
  ('2 Color', 2,  24,    35,  4.25),
  ('2 Color', 2,  36,    47,  3.85),
  ('2 Color', 2,  48,    71,  3.50),
  ('2 Color', 2,  72,   107,  3.20),
  ('2 Color', 2, 108,   143,  3.00),
  ('2 Color', 2, 144,   215,  2.85),
  ('2 Color', 2, 216,   499,  2.75),
  -- 3 Color
  ('3 Color', 3,   1,    11,  8.00),
  ('3 Color', 3,  12,    23,  6.00),
  ('3 Color', 3,  24,    35,  4.75),
  ('3 Color', 3,  36,    47,  4.25),
  ('3 Color', 3,  48,    71,  3.95),
  ('3 Color', 3,  72,   107,  3.70),
  ('3 Color', 3, 108,   143,  3.50),
  ('3 Color', 3, 144,   215,  3.10),
  ('3 Color', 3, 216,   499,  2.90),
  -- 4 Color
  ('4 Color', 4,   1,    11,  9.00),
  ('4 Color', 4,  12,    23,  7.00),
  ('4 Color', 4,  24,    35,  6.00),
  ('4 Color', 4,  36,    47,  5.00),
  ('4 Color', 4,  48,    71,  4.50),
  ('4 Color', 4,  72,   107,  4.00),
  ('4 Color', 4, 108,   143,  3.75),
  ('4 Color', 4, 144,   215,  3.30),
  ('4 Color', 4, 216,   499,  3.10),
  -- 5 Color (large qty only)
  ('5 Color', 5,  24,    35,  8.00),
  ('5 Color', 5,  36,    47,  7.50),
  ('5 Color', 5,  48,    71,  6.00),
  ('5 Color', 5,  72,   107,  5.25),
  ('5 Color', 5, 108,   143,  4.75),
  ('5 Color', 5, 144,   215,  4.25),
  ('5 Color', 5, 216,   499,  4.00),
  ('5 Color', 5, 500, 99999,  3.75)
) as t(tier_name, tier_sort, qty_min, qty_max, price)
where dt.code = 'screen_print';

-- ─── Price Matrix: Embroidery ──────────────────────────────
-- Stitch breaks: ≤10K, ≤15K, ≤20K, >20K
-- Qty breaks: ≤6, ≤24, ≤48, >48
-- Sell prices (cost = sell / 1.6)

insert into public.price_matrix (decoration_type_id, tier_name, tier_sort, qty_min, qty_max, price_per_piece)
select dt.id, t.tier_name, t.tier_sort, t.qty_min, t.qty_max, t.price
from public.decoration_types dt
cross join (values
  ('Up to 10K stitches', 1,  1,     6,  8.00),
  ('Up to 10K stitches', 1,  7,    24,  8.50),
  ('Up to 10K stitches', 1, 25,    48,  8.00),
  ('Up to 10K stitches', 1, 49, 99999,  7.50),
  ('Up to 15K stitches', 2,  1,     6,  9.00),
  ('Up to 15K stitches', 2,  7,    24,  8.50),
  ('Up to 15K stitches', 2, 25,    48,  8.00),
  ('Up to 15K stitches', 2, 49, 99999,  8.00),
  ('Up to 20K stitches', 3,  1,     6, 10.00),
  ('Up to 20K stitches', 3,  7,    24,  9.50),
  ('Up to 20K stitches', 3, 25,    48,  9.00),
  ('Up to 20K stitches', 3, 49, 99999,  9.00),
  ('Over 20K stitches',  4,  1,     6, 12.00),
  ('Over 20K stitches',  4,  7,    24, 12.50),
  ('Over 20K stitches',  4, 25,    48, 12.00),
  ('Over 20K stitches',  4, 49, 99999, 10.00)
) as t(tier_name, tier_sort, qty_min, qty_max, price)
where dt.code = 'embroidery';

-- ─── Price Matrix: DTF ─────────────────────────────────────

insert into public.price_matrix (decoration_type_id, tier_name, tier_sort, qty_min, qty_max, price_per_piece)
select dt.id, t.tier_name, t.tier_sort, t.qty_min, t.qty_max, t.price
from public.decoration_types dt
cross join (values
  ('4" Sq & Under',       1, 1, 99999, 4.50),
  ('Front Chest (12"x4")',2, 1, 99999, 7.50)
) as t(tier_name, tier_sort, qty_min, qty_max, price)
where dt.code = 'dtf';

-- ─── Price Matrix: Number Press ────────────────────────────
-- Qty breaks: ≤10, ≤50, >50
-- sell / cost per number

insert into public.price_matrix (decoration_type_id, tier_name, tier_sort, qty_min, qty_max, price_per_piece)
select dt.id, t.tier_name, t.tier_sort, t.qty_min, t.qty_max, t.price
from public.decoration_types dt
cross join (values
  ('Single color',  1,  1,   10, 7.00),
  ('Single color',  1, 11,   50, 6.00),
  ('Single color',  1, 51,99999, 5.00)
) as t(tier_name, tier_sort, qty_min, qty_max, price)
where dt.code = 'heat_transfer';

-- ─── ID Sequence Initialization ────────────────────────────

insert into public.id_sequences (entity, next_val) values
  ('estimates',     2100),
  ('sales_orders',  1050),
  ('invoices',      5010),
  ('pick_lines',    1010),
  ('po_lines',      3010),
  ('batch_pos',     1),
  ('omg_stores',    1010);

-- ─── Demo Users ────────────────────────────────────────────
-- These match the hardcoded REPS in the frontend.
-- auth_id is null until they sign up through Supabase Auth.

insert into public.user_profiles (id, full_name, role, pin) values
  ('00000000-0000-0000-0000-000000000001', 'Steve Peterson', 'admin',      '1234'),
  ('00000000-0000-0000-0000-000000000002', 'Denis',          'gm',         '2345'),
  ('00000000-0000-0000-0000-000000000003', 'Liliana',        'production', '3456'),
  ('00000000-0000-0000-0000-000000000004', 'Laura Chen',     'rep',        '4567'),
  ('00000000-0000-0000-0000-000000000005', 'Mike Torres',    'rep',        '5678');
