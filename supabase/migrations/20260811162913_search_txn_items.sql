-- Global search over transaction items (2026-08-11).
--
-- Global search could only reach items that exist in the products catalog. An item that only
-- ever lived on a transaction — a pre-portal NetSuite line, a one-off/custom line, a style
-- since dropped from the catalog — was unreachable by SKU even though we sold it for years.
-- ST350 alone is 361 transactions and $111k since 2022, with no catalog row.
--
-- search_txn_items groups the imported NetSuite archive (customer_invoice_lines, ~222k lines
-- back to 2021) by item code so the search bar can offer those items as results. It flags the
-- ones the catalog already covers (in_catalog) so the UI can hide them — the Products section
-- already lists those, and their ProductDetail now shows the same archive history.
--
-- Ranking is exact match, then prefix, then substring, then transaction volume.
--
-- Both functions are SECURITY INVOKER, so the customer_invoice_lines RLS policy
-- (customer_invoice_lines_staff_all → is_team_member()) still gates every row.
--
-- NOTE: superseded the same day by 20260811163845_search_txn_items_parent_codes.sql, which
-- collapses NetSuite's per-size matrix rows to the parent SKU and filters out charge codes.
-- Both are kept so a replay reproduces the live migration history exactly.

-- Case-insensitive exact lookup for one item's full history. ILIKE cannot use the existing
-- lower(item) trigram index for an unanchored equality probe, and the planner otherwise walks
-- idx_cil_date and filters (~490ms for a single SKU). This makes it an index probe (~5ms).
CREATE INDEX IF NOT EXISTS idx_cil_item_lower ON customer_invoice_lines (lower(item));

-- ─── Search: distinct archive items matching a query ───
CREATE OR REPLACE FUNCTION search_txn_items(p_query TEXT, p_limit INT DEFAULT 20)
RETURNS TABLE(
  item TEXT,
  txn_count INT,
  line_count INT,
  total_qty NUMERIC,
  total_amount NUMERIC,
  first_date DATE,
  last_date DATE,
  in_catalog BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT lower(btrim(coalesce(p_query, ''))) AS t
  ),
  hits AS (
    SELECT l.item AS item,
           count(DISTINCT l.netsuite_internal_id)::INT AS txn_count,
           count(*)::INT AS line_count,
           sum(coalesce(l.quantity, 0)) AS total_qty,
           sum(coalesce(l.amount, 0)) AS total_amount,
           min(l.transaction_date) AS first_date,
           max(l.transaction_date) AS last_date
    FROM customer_invoice_lines l
    CROSS JOIN q
    WHERE q.t <> ''
      AND l.item IS NOT NULL
      AND btrim(l.item) <> ''
      AND lower(l.item) LIKE '%' || q.t || '%'
    GROUP BY l.item
  )
  SELECT h.item,
         h.txn_count,
         h.line_count,
         h.total_qty,
         h.total_amount,
         h.first_date,
         h.last_date,
         EXISTS (SELECT 1 FROM products p WHERE p.sku = h.item) AS in_catalog
  FROM hits h
  CROSS JOIN q
  ORDER BY CASE
             WHEN lower(h.item) = q.t THEN 0
             WHEN lower(h.item) LIKE q.t || '%' THEN 1
             ELSE 2
           END,
           h.txn_count DESC,
           h.item
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

-- ─── Detail: every archive line for one item code ───
CREATE OR REPLACE FUNCTION txn_item_history(p_item TEXT, p_limit INT DEFAULT 1000)
RETURNS TABLE(
  netsuite_internal_id TEXT,
  line_seq INT,
  transaction_type TEXT,
  document_number TEXT,
  transaction_date DATE,
  status TEXT,
  raw_customer_name TEXT,
  customer_id TEXT,
  item TEXT,
  description TEXT,
  quantity NUMERIC,
  rate NUMERIC,
  amount NUMERIC,
  header_memo TEXT,
  line_memo TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT l.netsuite_internal_id,
         l.line_seq,
         l.transaction_type,
         l.document_number,
         l.transaction_date,
         l.status,
         l.raw_customer_name,
         l.customer_id,
         l.item,
         l.description,
         l.quantity,
         l.rate,
         l.amount,
         l.header_memo,
         l.line_memo
  FROM customer_invoice_lines l
  WHERE btrim(coalesce(p_item, '')) <> ''
    AND lower(l.item) = lower(btrim(p_item))
  ORDER BY l.transaction_date DESC NULLS LAST,
           l.netsuite_internal_id DESC,
           l.line_seq
  LIMIT least(greatest(coalesce(p_limit, 1000), 1), 5000)
$$;

GRANT EXECUTE ON FUNCTION search_txn_items(TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION txn_item_history(TEXT, INT) TO authenticated, service_role;
