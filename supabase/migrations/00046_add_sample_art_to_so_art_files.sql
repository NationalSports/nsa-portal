-- Add sample_art column to so_art_files (used for rep-uploaded sample/reference art)
ALTER TABLE so_art_files
  ADD COLUMN IF NOT EXISTS sample_art JSONB DEFAULT '[]';
