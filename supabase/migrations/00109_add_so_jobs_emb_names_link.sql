-- Link to digitized embroidery name files (kept in Google Drive) so the
-- production team can access them from the job. Editable on embroidery jobs.
ALTER TABLE public.so_jobs ADD COLUMN IF NOT EXISTS emb_names_link TEXT;
