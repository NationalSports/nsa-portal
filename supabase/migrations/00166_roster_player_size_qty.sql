-- Per-player override for how many units of a kit item this player needs (e.g. a
-- team where shorts default to 2-per-player, but one player only wants 1). Null
-- means "use the kit item's default qty" (roster_kit_templates items[].qty).
ALTER TABLE public.roster_player_sizes ADD COLUMN IF NOT EXISTS qty integer;
