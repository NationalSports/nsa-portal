-- Add access column to team_members for per-user page access control
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS access TEXT[] DEFAULT NULL;
