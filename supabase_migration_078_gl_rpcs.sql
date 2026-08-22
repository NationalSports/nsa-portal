-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 078: Accounting page aggregation helpers
-- Run this in Supabase SQL Editor. Pairs with migration 077.
-- ═══════════════════════════════════════════════════════════════════
-- The Accounting page groups a whole fiscal year of ledger detail by account.
-- Doing that in the browser would mean shipping every row over the wire just
-- to sum it — the same reason SalesHistory queries Supabase directly instead
-- of loading customer_invoice_lines into React state.
--
-- All four are SECURITY INVOKER (the PostgreSQL default): the caller's RLS
-- still applies, so these do NOT widen access to the admin/GM-gated GL tables.

-- Account-level totals for one fiscal year, shaped so the statement builders
-- in src/lib/netsuiteFinancials.js can consume them exactly like raw entries.
CREATE OR REPLACE FUNCTION gl_account_totals(p_year INTEGER)
RETURNS TABLE (
  account_full_name TEXT,
  account_name      TEXT,
  account_number    TEXT,
  statement_group   TEXT,
  amount            NUMERIC,
  entry_count       BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(e.account_full_name, e.account_name, '(unclassified)') AS account_full_name,
    MIN(e.account_name)     AS account_name,
    MIN(e.account_number)   AS account_number,
    MIN(e.statement_group)  AS statement_group,
    ROUND(SUM(e.amount), 2) AS amount,
    COUNT(*)                AS entry_count
  FROM gl_entries e
  WHERE e.fiscal_year = p_year
  GROUP BY 1
$$;

-- Which years hold ledger data, and whether each balances. net_amount is the
-- sum of debit-minus-credit across the year: zero means the import is a
-- complete period, anything else means rows are missing. The Accounting page
-- shows that verdict next to every year rather than reporting statements built
-- on partial data as though they were final.
CREATE OR REPLACE FUNCTION gl_year_summary()
RETURNS TABLE (
  fiscal_year INTEGER,
  entry_count BIGINT,
  net_amount  NUMERIC,
  min_date    DATE,
  max_date    DATE
)
LANGUAGE sql STABLE AS $$
  SELECT e.fiscal_year, COUNT(*), ROUND(SUM(e.amount), 2), MIN(e.entry_date), MAX(e.entry_date)
  FROM gl_entries e
  GROUP BY e.fiscal_year
  ORDER BY e.fiscal_year DESC
$$;

-- Invoice register rollup by year and document type.
-- with_tax_rows counts the invoices that actually carry a tax figure. As of
-- migration time that is ZERO of 9,082 rows — the saved search that loaded
-- them selected Amount only — so the page can state plainly that no sales-tax
-- split exists rather than rendering SUM(NULL) as a confident $0.00.
CREATE OR REPLACE FUNCTION sales_year_summary()
RETURNS TABLE (
  fiscal_year   INTEGER,
  doc_type      TEXT,
  doc_count     BIGINT,
  subtotal_sum  NUMERIC,
  tax_sum       NUMERIC,
  total_sum     NUMERIC,
  with_tax_rows BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(YEAR FROM i.invoice_date)::INTEGER,
    COALESCE(i.type, 'invoice'),
    COUNT(*),
    ROUND(SUM(i.subtotal), 2),
    ROUND(SUM(i.tax), 2),
    ROUND(SUM(i.total), 2),
    COUNT(*) FILTER (WHERE i.tax IS NOT NULL)
  FROM customer_invoices i
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2
$$;

-- Year/type rollup of the imported NetSuite transaction lines (229k rows).
-- doc_count is DISTINCT transactions, so the page can show that sales orders
-- and invoices are separate documents rather than inviting them to be added
-- together as revenue.
CREATE OR REPLACE FUNCTION txn_line_year_summary()
RETURNS TABLE (
  fiscal_year      INTEGER,
  transaction_type TEXT,
  line_count       BIGINT,
  doc_count        BIGINT,
  amount_sum       NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(YEAR FROM l.transaction_date)::INTEGER,
    l.transaction_type,
    COUNT(*),
    COUNT(DISTINCT l.netsuite_internal_id),
    ROUND(SUM(l.amount), 2)
  FROM customer_invoice_lines l
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2
$$;

GRANT EXECUTE ON FUNCTION gl_account_totals(INTEGER)  TO authenticated;
GRANT EXECUTE ON FUNCTION gl_year_summary()           TO authenticated;
GRANT EXECUTE ON FUNCTION sales_year_summary()        TO authenticated;
GRANT EXECUTE ON FUNCTION txn_line_year_summary()     TO authenticated;
