-- Add art_hidden column to so_jobs so the art dashboard's "Hide from board"
-- toggle persists across reloads. Without this column, the upsert in
-- _dbSaveSO would fail with a schema-cache error and the retry path strips
-- _jobExtraCols (which includes art_hidden), so the value never reaches the DB.
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS art_hidden BOOLEAN DEFAULT false;
