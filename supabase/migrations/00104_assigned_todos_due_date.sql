-- Add an optional due date to assigned tasks so portals can show "what's due today".
ALTER TABLE public.assigned_todos ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE INDEX IF NOT EXISTS idx_assigned_todos_due ON public.assigned_todos(due_date) WHERE status = 'open';
