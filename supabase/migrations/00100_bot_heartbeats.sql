-- ============================================================
-- NSA Portal – Bot presence / heartbeat
-- Migration: 00100_bot_heartbeats
--
-- Lets the portal show whether the Claude bot (and its Mac mini) is awake and
-- what it's doing. The always-on worker upserts its heartbeat on every poll
-- cycle; the portal treats the bot as "online" if last_seen is recent.
--
-- The queue itself does NOT depend on this — tasks live in assigned_todos and
-- simply wait (bot_status='queued') whenever the bot is down. This table is
-- purely for visibility.
--
-- Rollback (run via SQL editor if needed):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.bot_heartbeats;
--   DROP TABLE public.bot_heartbeats;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bot_heartbeats (
  bot_id          TEXT PRIMARY KEY REFERENCES public.team_members(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'idle',   -- idle | working
  current_task_id TEXT,                            -- assigned_todos.id the worker is on
  host            TEXT,                            -- machine label, e.g. 'macmini-1'
  version         TEXT,                            -- worker version string
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS (mirrors batch_pos in 00002) ───
ALTER TABLE public.bot_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bot_heartbeats_select" ON public.bot_heartbeats;
CREATE POLICY "bot_heartbeats_select" ON public.bot_heartbeats
  FOR SELECT USING (true);

-- Portal users generally don't write this (the worker does, via service role,
-- which bypasses RLS) — but allow office/warehouse writes for manual resets.
DROP POLICY IF EXISTS "bot_heartbeats_write" ON public.bot_heartbeats;
CREATE POLICY "bot_heartbeats_write" ON public.bot_heartbeats
  FOR ALL USING (
    public.is_admin_or_gm()
    OR public.current_user_role() IN ('rep','csr','warehouse')
  );

-- Realtime so the status pill updates live as the worker checks in.
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_heartbeats;
