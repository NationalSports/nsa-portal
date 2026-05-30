-- Link an assigned task to a specific Purchase Order, so the task detail popup
-- can show the PO's items / SKUs / sizes, the drop-ship address, and a direct
-- link to open the PO. The task-assignment UI writes a `po_id` field on PO tasks;
-- without this column the upsert to assigned_todos would be rejected and the task
-- silently dropped (same failure mode as the earlier missing if_id column).
ALTER TABLE public.assigned_todos ADD COLUMN IF NOT EXISTS po_id text;
