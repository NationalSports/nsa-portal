-- Per-cell override for which size group (Youth/Women's/Adult) governs this
-- player's selection on THIS item — independent of their overall roster
-- category. Handles a player whose build doesn't match one scale uniformly
-- across every item (e.g. a big kid in a Youth jersey but Adult shorts).
-- Null means "use the player's roster category" (today's behavior, unchanged
-- for existing rows).
ALTER TABLE public.roster_player_sizes ADD COLUMN IF NOT EXISTS size_group text;
