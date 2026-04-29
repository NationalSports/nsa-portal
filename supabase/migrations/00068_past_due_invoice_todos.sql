-- Weekly past-due invoice todos for sales reps.
--
-- Every Friday at 14:00 UTC (7am PDT / 8am PST), this scans for invoices
-- that are unpaid and past their due_date and creates one assigned_todo
-- per rep summarizing what's overdue. Reps see the todo in their list and
-- can drill into the Past Due Invoices view to bulk-email customers,
-- assign the chase to their CSR, etc.
--
-- The existing manual Friday-morning email keeps going alongside this —
-- the todo is the in-app prompt, the email is the inbox prompt.

-- ─── Source dedup column on assigned_todos ────────────────────────────────
-- A natural key like "past_due_weekly:<rep_id>:<ISO-week>" lets the cron
-- run idempotently — re-running on the same Friday won't double-create.
ALTER TABLE public.assigned_todos
  ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_assigned_todos_source
  ON public.assigned_todos(source)
  WHERE source IS NOT NULL;

-- ─── Generator function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_past_due_invoice_todos()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rep_record RECORD;
  todo_count INT := 0;
  week_key   TEXT;
  src_key    TEXT;
BEGIN
  -- ISO year+week so a single Friday's run produces one row, even if the
  -- function is invoked twice (manual test + cron).
  week_key := to_char(now() AT TIME ZONE 'UTC', 'IYYY-"W"IW');

  FOR rep_record IN
    SELECT
      COALESCE(so.created_by, c.primary_rep_id) AS rep_id,
      COUNT(DISTINCT i.id)                       AS inv_count,
      COUNT(DISTINCT i.customer_id)              AS cust_count,
      SUM(i.total - COALESCE(i.paid, 0))         AS total_owed,
      string_agg(
        DISTINCT '  • ' || c.name || ' — $' ||
                 to_char(i.total - COALESCE(i.paid, 0), 'FM999,999,999.00') ||
                 ' (' || i.id || ', due ' || i.due_date::text || ')',
        E'\n'
        ORDER BY '  • ' || c.name || ' — $' ||
                 to_char(i.total - COALESCE(i.paid, 0), 'FM999,999,999.00') ||
                 ' (' || i.id || ', due ' || i.due_date::text || ')'
      )                                          AS line_summary
    FROM public.invoices i
    LEFT JOIN public.sales_orders so ON so.id = i.so_id
    LEFT JOIN public.customers   c  ON c.id  = i.customer_id
    WHERE i.due_date IS NOT NULL
      AND i.due_date < (now() AT TIME ZONE 'UTC')::date
      AND COALESCE(i.status, 'open') NOT IN ('paid', 'void', 'cancelled')
      AND COALESCE(i.paid, 0) < COALESCE(i.total, 0)
    GROUP BY COALESCE(so.created_by, c.primary_rep_id)
  LOOP
    -- Skip rows where the rep_id couldn't be resolved or doesn't reference
    -- a real team_member (would violate the FK).
    IF rep_record.rep_id IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE id = rep_record.rep_id) THEN
      CONTINUE;
    END IF;

    src_key := 'past_due_weekly:' || rep_record.rep_id || ':' || week_key;

    -- Idempotency: only one todo per (rep, ISO week).
    IF EXISTS (SELECT 1 FROM public.assigned_todos WHERE source = src_key) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.assigned_todos
      (title, description, created_by, assigned_to, priority, status, source)
    VALUES (
      'Past-due invoices — ' || rep_record.cust_count || ' customer' ||
        CASE WHEN rep_record.cust_count <> 1 THEN 's' ELSE '' END ||
        ', $' || to_char(rep_record.total_owed, 'FM999,999,999.00'),
      'Weekly past-due invoice review (' || rep_record.inv_count || ' invoice' ||
        CASE WHEN rep_record.inv_count <> 1 THEN 's' ELSE '' END || '):' ||
        E'\n\n' || COALESCE(rep_record.line_summary, '') ||
        E'\n\nOpen the Invoices page → Overdue filter to bulk-email customers ' ||
        'or assign the follow-up to your CSR.',
      rep_record.rep_id,   -- created_by: self (no separate "system" user exists)
      rep_record.rep_id,   -- assigned_to: the rep
      1,                   -- high priority
      'open',
      src_key
    );

    todo_count := todo_count + 1;
  END LOOP;

  RETURN todo_count;
END;
$$;

-- Grant execute so authenticated users (and the cron job's service_role) can call it.
GRANT EXECUTE ON FUNCTION public.create_past_due_invoice_todos() TO authenticated, service_role;

-- ─── Friday weekly cron ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  PERFORM cron.unschedule('past-due-invoice-todos-weekly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 14:00 UTC on Fridays = 7am PDT / 6am PST. Most of the year is PDT so this
-- lands on the rep's Friday morning; in winter it'll fire an hour earlier.
SELECT cron.schedule(
  'past-due-invoice-todos-weekly',
  '0 14 * * 5',
  $$
  SELECT public.create_past_due_invoice_todos();
  $$
);
