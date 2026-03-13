-- Add art_files JSONB column to customers for customer-level art library
-- Parent customer art cascades to child accounts in the application layer

ALTER TABLE customers ADD COLUMN IF NOT EXISTS art_files JSONB DEFAULT '[]';
