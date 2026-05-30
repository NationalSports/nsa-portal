-- ============================================================
-- NSA Portal – Make Claude assignable like a CSR
-- Migration: 00099_assigned_todos_bot
--
-- Treats an always-on Claude Code worker (e.g. a Mac mini) as just another
-- team member you can assign tasks to. Reuses the entire existing
-- assigned_todos flow (Assign Task modal, dashboard list, comments,
-- realtime) — you simply pick "Claude" as the assignee.
--
-- Adds:
--   1. A bot team member ("Claude") so it appears in the Assign To dropdown.
--   2. assigned_todos.bot_payload  — structured details the worker needs to
--      act reliably (e.g. the SKUs/sizes/PO# to add to a vendor cart).
--   3. assigned_todos.bot_status   — the worker's own progress, separate from
--      the human-facing `status` (open/closed). Lifecycle:
--        queued       -> assigned to the bot, awaiting pickup
--        in_progress  -> worker is driving the vendor portal
--        needs_review -> cart is filled; STOP before submit, await human OK
--        done         -> human approved / order submitted
--        failed       -> worker hit an unrecoverable error
--
-- The worker authenticates with the service-role key (bypasses RLS) and
-- reports back exactly like a CSR would: by posting todo_comments and
-- updating bot_status. It never submits an order — a human closes the todo.
--
-- Rollback (run via SQL editor if needed):
--   ALTER TABLE public.assigned_todos DROP COLUMN bot_payload;
--   ALTER TABLE public.assigned_todos DROP COLUMN bot_status;
--   DELETE FROM public.team_members WHERE id = 'bot-claude';
-- ============================================================

-- 1. Structured payload + worker progress on the existing todo table.
ALTER TABLE public.assigned_todos ADD COLUMN IF NOT EXISTS bot_payload JSONB;
ALTER TABLE public.assigned_todos ADD COLUMN IF NOT EXISTS bot_status  TEXT;

-- Worker polls for its open, actionable tasks; index that hot path.
CREATE INDEX IF NOT EXISTS idx_assigned_todos_bot
  ON public.assigned_todos(assigned_to, status)
  WHERE bot_payload IS NOT NULL;

-- 2. The bot "team member". role='bot' keeps it out of human-only lists
--    (CSR/rep/warehouse pickers all filter by their specific roles), while
--    the Assign Task modal opts it in explicitly.
INSERT INTO public.team_members (id, name, role, is_active)
VALUES ('bot-claude', 'Claude (Bot)', 'bot', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, is_active = true;
