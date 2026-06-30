-- ============================================================
-- NSA Portal – Dismissed Todos (server-side persistence)
-- Migration: 00051_dismissed_todos
--
-- Persists dismissed todo keys per user so dismissals survive
-- across browsers, devices, and localStorage clears.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dismissed_todos (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  dismiss_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, dismiss_key)
);

CREATE INDEX IF NOT EXISTS idx_dismissed_todos_user ON public.dismissed_todos(user_id);

-- Also persist dismissed notifications
CREATE TABLE IF NOT EXISTS public.dismissed_notifs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  dismiss_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, dismiss_key)
);

CREATE INDEX IF NOT EXISTS idx_dismissed_notifs_user ON public.dismissed_notifs(user_id);
