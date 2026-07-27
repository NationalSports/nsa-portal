-- estimate_art_files was never given the sample_art column that migration 00046 added to
-- so_art_files, but the client writes ONE art-row shape to both tables (_artCols) and the
-- loader always hydrates a sample_art key. Every estimate art save therefore 400'd with
-- PGRST204 ("Could not find the 'sample_art' column of 'estimate_art_files' in the schema
-- cache") and fell back to a stripped write that silently dropped color_ways, design_id,
-- preview_url, item_mockups, art_sizes, garment_colors, mock_links, web_logos, stitches and
-- prod_files_attached. Estimate art groups came back from the next load as empty shells.
ALTER TABLE public.estimate_art_files
  ADD COLUMN IF NOT EXISTS sample_art JSONB DEFAULT '[]';
