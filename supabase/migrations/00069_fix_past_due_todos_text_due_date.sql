-- Fix create_past_due_invoice_todos for invoices.due_date being TEXT.
--
-- The original 00068 migration assumed due_date was a DATE. In production
-- it's TEXT (stored as 'YYYY-MM-DD'), so the `due_date < ...::date`
-- comparison threw "operator does not exist: text < date" and the function
-- never created any todos.
--
-- This redefines the function with an explicit `::date` cast plus a regex
-- guard against malformed strings. The cron schedule and the `source`
-- dedup column from 00068 are unchanged.

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
                 ' (' || i.id || ', due ' || i.due_date || ')',
        E'\n'
        ORDER BY '  • ' || c.name || ' — $' ||
                 to_char(i.total - COALESCE(i.paid, 0), 'FM999,999,999.00') ||
                 ' (' || i.id || ', due ' || i.due_date || ')'
      )                                          AS line_summary
    FROM public.invoices i
    LEFT JOIN public.sales_orders so ON so.id = i.so_id
    LEFT JOIN public.customers   c  ON c.id  = i.customer_id
    WHERE i.due_date IS NOT NULL
      AND i.due_date <> ''
      AND i.due_date ~ '^\d{4}-\d{2}-\d{2}'
      AND i.due_date::date < (now() AT TIME ZONE 'UTC')::date
      AND COALESCE(i.status, 'open') NOT IN ('paid', 'void', 'cancelled')
      AND COALESCE(i.paid, 0) < COALESCE(i.total, 0)
    GROUP BY COALESCE(so.created_by, c.primary_rep_id)
  LOOP
    IF rep_record.rep_id IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE id = rep_record.rep_id) THEN
      CONTINUE;
    END IF;

    src_key := 'past_due_weekly:' || rep_record.rep_id || ':' || week_key;

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
      rep_record.rep_id,
      rep_record.rep_id,
      1,
      'open',
      src_key
    );

    todo_count := todo_count + 1;
  END LOOP;

  RETURN todo_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_past_due_invoice_todos() TO authenticated, service_role;
