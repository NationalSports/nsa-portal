-- Add YM / WM / AM category designation to roster players.
-- Coaches tag each player so the correct SKU (youth / women's / adult) is used
-- for size resolution and inventory lookup.
alter table public.roster_players
  add column if not exists category text default null;
