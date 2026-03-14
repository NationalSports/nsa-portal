-- Add run_order and run completion tracking columns to so_jobs
-- These support dual-run order for jobs with multiple decoration types (e.g. artwork + numbers)
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS run_order TEXT;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS run1_done BOOLEAN DEFAULT false;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS run2_done BOOLEAN DEFAULT false;
