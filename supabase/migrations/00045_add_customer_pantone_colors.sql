-- Add pantone_colors JSONB column to customers table
-- Stores school-specific Pantone colors as [{code, hex, name}]
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS pantone_colors JSONB DEFAULT '[]';
