-- Persist the per-design "production files attached" confirmation flag.
-- Without this column the boolean was stripped on every save (not in the table),
-- so screen-print jobs confirmed via the checkbox kept reappearing on the
-- "Approved / Needs Files" art board after a reload.
ALTER TABLE public.estimate_art_files ADD COLUMN IF NOT EXISTS prod_files_attached BOOLEAN;
ALTER TABLE public.so_art_files ADD COLUMN IF NOT EXISTS prod_files_attached BOOLEAN;
