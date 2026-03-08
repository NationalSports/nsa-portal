-- ============================================================
-- NSA Portal – Rep-CSR Assignments & Assigned Todos
-- Migration: 00019_rep_csr_assignments_and_todos
--
-- Adds:
--   rep_csr_assignments: default CSR for each rep (can be overridden)
--   assigned_todos: manually created todos with assignment, comments, completion
-- ============================================================

-- 1. Rep-CSR default assignment
CREATE TABLE IF NOT EXISTS public.rep_csr_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rep_id TEXT NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  csr_id TEXT NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(rep_id, csr_id)
);

CREATE INDEX IF NOT EXISTS idx_rep_csr_rep ON public.rep_csr_assignments(rep_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rep_csr_csr ON public.rep_csr_assignments(csr_id) WHERE is_active = true;

-- 2. Assigned todos (manually created, assignable between rep/CSR)
CREATE TABLE IF NOT EXISTS public.assigned_todos (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES public.team_members(id),
  assigned_to TEXT NOT NULL REFERENCES public.team_members(id),
  so_id TEXT,
  customer_id TEXT,
  priority INTEGER DEFAULT 2,
  status TEXT DEFAULT 'open',
  completed_at TIMESTAMPTZ,
  completed_by TEXT REFERENCES public.team_members(id),
  completion_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assigned_todos_assigned ON public.assigned_todos(assigned_to) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_assigned_todos_created ON public.assigned_todos(created_by) WHERE status = 'open';

-- 3. Todo comments (for questions/responses between rep and CSR)
CREATE TABLE IF NOT EXISTS public.todo_comments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  todo_id TEXT NOT NULL REFERENCES public.assigned_todos(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES public.team_members(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_todo_comments_todo ON public.todo_comments(todo_id);
