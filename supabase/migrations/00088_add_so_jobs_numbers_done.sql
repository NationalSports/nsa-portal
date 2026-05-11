-- Add numbers_done column to so_jobs so the production sheet's "tick off
-- numbers" feature can persist per-number completion state. Keys are
-- "<sku>|<size>|<num>" -> true.
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS numbers_done JSONB DEFAULT '{}'::jsonb;
