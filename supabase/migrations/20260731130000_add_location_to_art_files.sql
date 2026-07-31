-- Art folders can carry a default decoration location (e.g. "Left Chest"). When a folder is
-- attached to a garment, the deco's `position` seeds from this instead of always landing on the
-- generic front-center default. The client writes ONE art-row shape to both tables (_artCols), so
-- the column must exist on both or every save 400s and silently falls back to a stripped write
-- (the sample_art gap, migration 20260727172644).
ALTER TABLE public.estimate_art_files
  ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.so_art_files
  ADD COLUMN IF NOT EXISTS location TEXT;
