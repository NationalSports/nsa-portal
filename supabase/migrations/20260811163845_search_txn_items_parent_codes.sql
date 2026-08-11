-- Transaction-item search, corrected for how NetSuite actually stores items (2026-08-11).
--
-- Supersedes 20260811162913_search_txn_items.sql, which grouped on the raw item code. Reading
-- the archive properly turned up two problems with that: a garment came back once per size,
-- and the highest-volume "items" were not items at all.
--
-- Three things this has to get right about the imported archive (customer_invoice_lines,
-- ~222k lines back to 2021):
--
-- 1. NetSuite stores a matrix garment as one row PER SIZE, named "PARENT : PARENT-SIZE"
--    (e.g. "HT3973 : HT3973-L"). 95,584 of the 95,590 namespaced lines follow that shape.
--    Searching raw item codes would return one hit per size instead of one per garment, so
--    everything here groups on txn_item_code() — the parent — which also collapses the
--    15,025 raw codes to 7,028 real ones.
--
-- 2. The highest-volume codes are not goods, they are charges: Shipping (17,265 txns), Misc
--    (6,068), Emb-NSA (4,754), "Screen : Screen 2" (4,329), plus per-vendor Misc buckets and
--    setup/art/color-change fees. txn_item_is_service() drops them — the search is for things
--    that were ordered, not the fees billed alongside them. It matches on leading service
--    words followed by a separator or end-of-string, so real SKUs that merely start with
--    those letters (SETUP123, COVERT, BELTE) survive.
--
-- 3. A code that never appears on a sales_order is an accounting artifact ("Opening Balance
--    Item AR"), so those are dropped too. That costs almost nothing: only 15 of 7,028 codes
--    are invoice-only, because the SO and invoice imports cover the same span.
--
-- Ranking is exact match, then prefix, then substring, then transaction volume.
--
-- Both search functions are SECURITY INVOKER, so the customer_invoice_lines RLS policy
-- (customer_invoice_lines_staff_all → is_team_member()) still gates every row.

-- ─── Normalizers ───

-- "HT3973 : HT3973-L" → "HT3973";  "ST350" → "ST350"
CREATE OR REPLACE FUNCTION txn_item_code(p_item TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(btrim(split_part(coalesce(p_item, ''), ' : ', 1)), '')
$$;

-- Charge / fee / accounting codes, not goods. Anchored on a whole leading word so a real SKU
-- beginning with the same letters is not caught.
CREATE OR REPLACE FUNCTION txn_item_is_service(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    btrim(coalesce(p_code, '')) = ''
    OR lower(btrim(p_code)) ~ ('^[^a-z0-9]*(' ||
         'shipping|freight|misc|deco|decals|digi|numbers|names|patch|twill|vector|ghost|' ||
         'screen|credit|promo|ob|opening|rush|sample|setup|set|rerun|art|color|colour|' ||
         'emb|embroidery|heat|transfer|size|inv|tbd|no use|not|discount|tax|labor|service' ||
       ')([ ._/-]|$)')
  , TRUE)
$$;

-- Indexed on the parent code so a single item's history is an index probe, not a table walk.
CREATE INDEX IF NOT EXISTS idx_cil_item_code_lower
  ON customer_invoice_lines (lower(txn_item_code(item)));

DROP INDEX IF EXISTS idx_cil_item_lower;

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
    SELECT txn_item_code(l.item) AS item,
           count(DISTINCT l.netsuite_internal_id)::INT AS txn_count,
           count(*)::INT AS line_count,
           sum(coalesce(l.quantity, 0)) AS total_qty,
           sum(coalesce(l.amount, 0)) AS total_amount,
           min(l.transaction_date) AS first_date,
           max(l.transaction_date) AS last_date,
           count(*) FILTER (WHERE l.transaction_type = 'sales_order') AS so_lines
    FROM customer_invoice_lines l
    CROSS JOIN q
    WHERE q.t <> ''
      AND txn_item_code(l.item) IS NOT NULL
      AND NOT txn_item_is_service(txn_item_code(l.item))
      AND lower(txn_item_code(l.item)) LIKE '%' || q.t || '%'
    GROUP BY txn_item_code(l.item)
    HAVING count(*) FILTER (WHERE l.transaction_type = 'sales_order') > 0
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

-- ─── Detail: every archive line for one parent code, all sizes ───
-- Returns raw lines; the client groups them into documents. Capped so a busy style can't pull
-- an unbounded result into the browser.
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
    AND lower(txn_item_code(l.item)) = lower(btrim(p_item))
  ORDER BY l.transaction_date DESC NULLS LAST,
           l.netsuite_internal_id DESC,
           l.line_seq
  LIMIT least(greatest(coalesce(p_limit, 1000), 1), 5000)
$$;

GRANT EXECUTE ON FUNCTION txn_item_code(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION txn_item_is_service(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_txn_items(TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION txn_item_history(TEXT, INT) TO authenticated, service_role;
