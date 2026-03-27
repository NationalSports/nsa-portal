-- Add thread_colors JSONB column to customers table
-- Stores school-specific embroidery thread colors as [{name, hex?}]
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS thread_colors JSONB DEFAULT '[]';
