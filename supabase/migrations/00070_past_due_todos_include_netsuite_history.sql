-- Extend create_past_due_invoice_todos() to scan NetSuite-imported invoices.
--
-- Background: production has ~611 open invoices in customer_invoices (the
-- NetSuite-imported history) and 0 open invoices in the portal-created
-- `invoices` table, so the original 00068/00069 function returned 0 even
-- when reps had real past-due balances.
--
-- This redefines the function to UNION both sources:
--   • public.invoices              (portal-created, has its own due_date + paid)
--   • public.customer_invoices     (NetSuite history, no due_date or paid)
--
-- For NetSuite rows we derive due_date from invoice_date + the customer's
-- payment_terms (net15/net30/net60/prepay), and treat the full `total` as
-- the balance owed (since the imported snapshot doesn't track partial pays).
-- Credit memos (type='credit_memo') are excluded.

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
    WITH past_due AS (
      -- ── Portal-created invoices ─────────────────────────────────────────
      SELECT
        i.id                                       AS inv_id,
        i.customer_id                              AS customer_id,
        COALESCE(so.created_by, c.primary_rep_id)  AS rep_id,
        c.name                                     AS customer_name,
        (i.total - COALESCE(i.paid, 0))            AS balance,
        i.due_date                                 AS due_date_text
      FROM public.invoices i
      LEFT JOIN public.sales_orders so ON so.id = i.so_id
      LEFT JOIN public.customers   c  ON c.id  = i.customer_id
      WHERE i.due_date IS NOT NULL
        AND i.due_date <> ''
        AND i.due_date ~ '^\d{4}-\d{2}-\d{2}'
        AND i.due_date::date < (now() AT TIME ZONE 'UTC')::date
        AND COALESCE(i.status, 'open') NOT IN ('paid', 'void', 'cancelled')
        AND COALESCE(i.paid, 0) < COALESCE(i.total, 0)

      UNION ALL

      -- ── NetSuite-imported history ───────────────────────────────────────
      -- No stored due_date — derive from invoice_date + payment terms.
      SELECT
        ci.id                                      AS inv_id,
        ci.customer_id                             AS customer_id,
        c.primary_rep_id                           AS rep_id,
        COALESCE(c.name, ci.raw_customer_name)     AS customer_name,
        ci.total                                   AS balance,
        (ci.invoice_date + (
          CASE COALESCE(c.payment_terms, 'net30')
            WHEN 'prepay' THEN 0
            WHEN 'net15'  THEN 15
            WHEN 'net30'  THEN 30
            WHEN 'net60'  THEN 60
            ELSE 30
          END
        ))::text                                   AS due_date_text
      FROM public.customer_invoices ci
      LEFT JOIN public.customers c ON c.id = ci.customer_id
      WHERE ci.invoice_date IS NOT NULL
        AND COALESCE(ci.type, 'invoice') = 'invoice'
        AND COALESCE(ci.status, 'open') NOT IN ('paid', 'void', 'cancelled')
        AND ci.total > 0
        AND (ci.invoice_date + (
          CASE COALESCE(c.payment_terms, 'net30')
            WHEN 'prepay' THEN 0
            WHEN 'net15'  THEN 15
            WHEN 'net30'  THEN 30
            WHEN 'net60'  THEN 60
            ELSE 30
          END
        )) < (now() AT TIME ZONE 'UTC')::date
    )
    SELECT
      rep_id,
      COUNT(*)                                    AS inv_count,
      COUNT(DISTINCT customer_id)                 AS cust_count,
      SUM(balance)                                AS total_owed,
      string_agg(
        DISTINCT '  • ' || customer_name || ' — $' ||
                 to_char(balance, 'FM999,999,999.00') ||
                 ' (' || inv_id || ', due ' || due_date_text || ')',
        E'\n'
        ORDER BY '  • ' || customer_name || ' — $' ||
                 to_char(balance, 'FM999,999,999.00') ||
                 ' (' || inv_id || ', due ' || due_date_text || ')'
      )                                           AS line_summary
    FROM past_due
    WHERE rep_id IS NOT NULL
    GROUP BY rep_id
  LOOP
    -- Skip if rep_id doesn't reference a real team_member (FK constraint).
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
