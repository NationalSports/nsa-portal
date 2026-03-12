-- Add update_requests column to estimates for coach feedback/change requests
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS update_requests JSONB DEFAULT '[]';
