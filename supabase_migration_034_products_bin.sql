-- Migration 034: warehouse bin / stock location per product. Blank = unassigned.
DO $$ BEGIN ALTER TABLE products ADD COLUMN bin TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
