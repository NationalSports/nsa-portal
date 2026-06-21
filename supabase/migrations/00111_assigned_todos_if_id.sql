-- Link an assigned task to a specific Item Fulfillment (IF / pick) in addition to its SO,
-- so warehouse "Pull IF-xxxx" tasks can open the IF directly from the task detail panel.
ALTER TABLE public.assigned_todos ADD COLUMN IF NOT EXISTS if_id TEXT;

CREATE INDEX IF NOT EXISTS idx_assigned_todos_if ON public.assigned_todos(if_id) WHERE status = 'open';
