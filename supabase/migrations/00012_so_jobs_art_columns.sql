-- Add missing art-workflow columns to so_jobs
-- These columns are used by the art request and art dashboard features

ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS art_requests JSONB DEFAULT '[]';
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS art_messages JSONB DEFAULT '[]';
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS assigned_artist TEXT;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS rep_notes TEXT;
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS rejections JSONB DEFAULT '[]';
