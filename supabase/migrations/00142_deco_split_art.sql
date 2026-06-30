-- Persist Split Art across saves. When a garment line is split between two or
-- more designs (e.g. some shirts get "Friars", the rest "Servite"), each art
-- decoration carries a shared split_group id and its own per-size allocation
-- (split_sizes). syncJobs reads those to emit one production job per design and
-- to price/fulfill each design against only its share of the line.
--
-- Without these columns the two fields were stripped on every save, so the
-- split silently collapsed on reload: the separate designs reverted to full
-- decorations on the whole line, producing one combined job that listed the
-- same process/position once per design and over-charged every piece.
--
-- estimate_item_decorations needs them too: the save_estimate RPC derives its
-- column list from the live schema, so it picks these up automatically once
-- they exist.

ALTER TABLE so_item_decorations ADD COLUMN IF NOT EXISTS split_group text;
ALTER TABLE so_item_decorations ADD COLUMN IF NOT EXISTS split_sizes jsonb;

ALTER TABLE estimate_item_decorations ADD COLUMN IF NOT EXISTS split_group text;
ALTER TABLE estimate_item_decorations ADD COLUMN IF NOT EXISTS split_sizes jsonb;
