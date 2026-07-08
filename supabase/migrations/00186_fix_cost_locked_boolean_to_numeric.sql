-- _cost_locked was hand-created as BOOLEAN DEFAULT false in the live DB, but the app writes the
-- locked decoration cost (a number) and migration 00035 declared it NUMERIC — the boolean column
-- made ADD COLUMN IF NOT EXISTS a no-op. Once 5e0711b started sending the field (2026-07-08),
-- every estimate/SO save with decorations failed: invalid input syntax for type boolean: "4.8".
-- All existing values were just the column default (false) — no real data — so convert via NULL.
-- Applied to the live DB 2026-07-08 as fix_cost_locked_boolean_to_numeric.
ALTER TABLE public.estimate_item_decorations ALTER COLUMN _cost_locked DROP DEFAULT;
ALTER TABLE public.estimate_item_decorations ALTER COLUMN _cost_locked TYPE numeric USING NULL;
ALTER TABLE public.so_item_decorations ALTER COLUMN _cost_locked DROP DEFAULT;
ALTER TABLE public.so_item_decorations ALTER COLUMN _cost_locked TYPE numeric USING NULL;
NOTIFY pgrst, 'reload schema';
