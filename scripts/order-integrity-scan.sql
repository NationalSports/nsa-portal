-- ============================================================================
-- order-integrity-scan.sql  —  READ-ONLY correctness oracle for order data
-- ============================================================================
-- Purpose: continuously verify the invariants that the sales-order save path,
-- estimate->SO conversion, and deco-PO attach SHOULD uphold, so misfiled/lost
-- data is surfaced in minutes instead of discovered weeks later as a one-off
-- "recover-po-XXXX" incident.
--
-- Safety: every statement here is a SELECT. It never writes. Run it against
-- production read-only, or against a Supabase branch seeded from prod.
--
-- How to use:
--   1. Run SECTION 1 (the summary). It returns ONE row of violation counts.
--   2. For any non-zero count, run the matching drill-down in SECTION 2 to see
--      the offending rows.
--
-- Two classes of check:
--   * HARD  — a true integrity error (orphan, duplicate key, dangling ref). A
--             non-zero count is a bug, full stop.
--   * SOFT  — a "smell" worth a human look, not necessarily wrong (e.g. a deco
--             PO whose qty is far larger than the line it covers). Tune the
--             thresholds to your business before treating these as failures.
--
-- IMPORTANT — the est_qty fallback:
--   "qty-only / custom" line items store their count in so_items.est_qty with an
--   EMPTY sizes map. Any quantity check MUST fall back to est_qty when the size
--   grid is empty, or it will undercount those lines to 0 and raise false
--   alarms. (A detection query that summed only `sizes` is exactly what once
--   flagged a perfectly correct 47-pc deco PO as "covering 0 units".)
-- ============================================================================


-- ============================================================================
-- SECTION 1 — SUMMARY  (run this first)
-- ============================================================================
with deco_pos_expanded as (
  -- one row per deco PO across every SO (deco POs live in sales_orders.deco_pos jsonb)
  select s.id as so_id,
         dp->>'po_id'  as po_id,
         coalesce((dp->>'qty')::numeric, 0) as po_qty,
         (select coalesce(array_agg((e)::int), '{}')
            from jsonb_array_elements_text(coalesce(dp->'item_idxs','[]'::jsonb)) e) as idxs
  from sales_orders s
  cross join lateral jsonb_array_elements(coalesce(s.deco_pos,'[]'::jsonb)) dp
),
item_qty as (
  -- each line's true unit count, WITH the est_qty fallback for qty-only lines
  select i.so_id, i.item_index,
         case when sz.q > 0 then sz.q else coalesce(i.est_qty, 0) end as line_qty
  from so_items i
  cross join lateral (
    select coalesce(sum(case when v.value ~ '^[0-9]+(\.[0-9]+)?$'
                             then v.value::numeric else 0 end), 0) as q
    from jsonb_each_text(coalesce(i.sizes,'{}'::jsonb)) v
  ) sz
),
deco_covered as (
  select d.so_id, d.po_id, d.po_qty,
         coalesce((select sum(iq.line_qty) from item_qty iq
                    where iq.so_id = d.so_id and iq.item_index = any(d.idxs)), 0) as covered_qty,
         (select count(*) from unnest(d.idxs) x
           where not exists (select 1 from so_items i2
                              where i2.so_id = d.so_id and i2.item_index = x)) as missing_idx_count
  from deco_pos_expanded d
)
select
  -- ---- HARD: referential integrity (no orphaned children) ----
  (select count(*) from so_items i              where not exists (select 1 from sales_orders s where s.id = i.so_id))       as orphan_so_items,
  (select count(*) from so_item_decorations d   where not exists (select 1 from so_items i      where i.id = d.so_item_id)) as orphan_decorations,
  (select count(*) from so_item_pick_lines p    where not exists (select 1 from so_items i      where i.id = p.so_item_id)) as orphan_pick_lines,
  (select count(*) from so_item_po_lines po     where not exists (select 1 from so_items i      where i.id = po.so_item_id))as orphan_po_lines,
  (select count(*) from so_jobs j               where not exists (select 1 from sales_orders s where s.id = j.so_id))       as orphan_jobs,
  (select count(*) from so_art_files a          where not exists (select 1 from sales_orders s where s.id = a.so_id))       as orphan_art_files,
  (select count(*) from so_firm_dates f         where not exists (select 1 from sales_orders s where s.id = f.so_id))       as orphan_firm_dates,
  (select count(*) from invoices v       where v.so_id is not null and not exists (select 1 from sales_orders s where s.id = v.so_id)) as orphan_invoices,
  (select count(*) from invoice_items it where not exists (select 1 from invoices v where v.id = it.invoice_id))            as orphan_invoice_items,
  -- ---- HARD: duplicate logical children (transient-dup risk from non-atomic SO save) ----
  (select count(*) from (select so_id, item_index from so_items group by so_id, item_index having count(*) > 1) z)             as dup_item_index,
  (select count(*) from (select so_item_id, deco_index from so_item_decorations group by so_item_id, deco_index having count(*) > 1) z) as dup_deco_index,
  -- ---- HARD: art tied to the WRONG order (or a dangling art ref) ----
  (select count(*) from so_item_decorations d join so_items i on i.id = d.so_item_id
     where coalesce(d.art_file_id,'') <> ''
       and not exists (select 1 from so_art_files a where a.id = d.art_file_id and a.so_id = i.so_id))                       as deco_art_not_on_same_so,
  (select count(*) from so_jobs j
     where coalesce(j.art_file_id,'') <> ''
       and not exists (select 1 from so_art_files a where a.id = j.art_file_id and a.so_id = j.so_id))                       as job_art_not_on_same_so,
  -- ---- HARD: a deco PO points at item indexes that don't exist on its SO ----
  (select count(*) from deco_covered where missing_idx_count > 0)                                                            as decopo_bad_item_idx,
  -- ---- SOFT: a deco PO's qty far exceeds the units on the line(s) it covers (the PO-3077 smell) ----
  (select count(*) from deco_covered where po_qty > greatest(covered_qty * 1.5, covered_qty + 24))                           as decopo_qty_smell,
  -- ---- SOFT: invoice header total doesn't reconcile with its own line items (+ship +tax, allow CC surcharge) ----
  (select count(*) from (
     select v.id, v.total, v.shipping, v.tax, v.cc_fee,
            (select sum((li->>'amount')::numeric) from jsonb_array_elements(coalesce(v.line_items,'[]'::jsonb)) li) as li_sum
     from invoices v where v.deleted_at is null
   ) q where abs(coalesce(total,0) - (coalesce(li_sum,0)+coalesce(shipping,0)+coalesce(tax,0)+coalesce(cc_fee,0))) > 0.50)  as invoice_total_mismatch,
  -- ---- HARD(ish): invoice_items rows with null money columns (the app writes the wrong field names;
  --       invoices.line_items jsonb is the authoritative source — this table should not be read for $) ----
  (select count(*) from invoice_items where total is null or unit_price is null)                                             as invoice_items_null_money
;


-- ============================================================================
-- SECTION 2 — DRILL-DOWNS  (run individually when a summary count is non-zero)
-- ============================================================================

-- 2a. Orphaned children — replace the table/keys as needed
-- select * from so_item_decorations d where not exists (select 1 from so_items i where i.id = d.so_item_id);

-- 2b. Duplicate line indexes (which SO, which index, how many rows)
-- select i.so_id, (s.deleted_at is not null) as so_deleted, i.item_index, count(*) n,
--        array_agg(i.id order by i.id) as row_ids, array_agg(distinct coalesce(i.sku,i.name)) as items
-- from so_items i join sales_orders s on s.id = i.so_id
-- group by i.so_id, (s.deleted_at is not null), i.item_index
-- having count(*) > 1;

-- 2c. Decoration art not on the same SO — is it dangling (art deleted) or cross-order?
-- select d.id as deco_id, i.so_id, d.art_file_id,
--        (select a.so_id from so_art_files a where a.id = d.art_file_id) as art_actual_so,
--        exists(select 1 from so_art_files a where a.id = d.art_file_id) as art_exists_anywhere
-- from so_item_decorations d join so_items i on i.id = d.so_item_id
-- where coalesce(d.art_file_id,'') <> ''
--   and not exists (select 1 from so_art_files a where a.id = d.art_file_id and a.so_id = i.so_id);

-- 2d. Job art not on the same SO (same shape as 2c, for so_jobs.art_file_id)
-- select j.id as job_id, j.so_id, j.art_file_id,
--        exists(select 1 from so_art_files a where a.id = j.art_file_id) as art_exists_anywhere
-- from so_jobs j
-- where coalesce(j.art_file_id,'') <> ''
--   and not exists (select 1 from so_art_files a where a.id = j.art_file_id and a.so_id = j.so_id);

-- 2e. Deco-PO smell — qty vs the units it actually covers (uses est_qty fallback)
with deco_pos_expanded as (
  select s.id as so_id, c.name as customer, dp->>'po_id' as po_id,
         coalesce((dp->>'qty')::numeric,0) as po_qty, dp->>'status' as status, dp->>'deco_type' as deco_type,
         dp->>'notes' as notes,
         (select coalesce(array_agg((e)::int),'{}') from jsonb_array_elements_text(coalesce(dp->'item_idxs','[]'::jsonb)) e) as idxs
  from sales_orders s left join customers c on c.id = s.customer_id
  cross join lateral jsonb_array_elements(coalesce(s.deco_pos,'[]'::jsonb)) dp
),
item_qty as (
  select i.so_id, i.item_index,
         case when sz.q > 0 then sz.q else coalesce(i.est_qty,0) end as line_qty
  from so_items i
  cross join lateral (select coalesce(sum(case when v.value ~ '^[0-9]+(\.[0-9]+)?$' then v.value::numeric else 0 end),0) as q
                        from jsonb_each_text(coalesce(i.sizes,'{}'::jsonb)) v) sz
)
select d.so_id, d.customer, d.po_id, d.po_qty,
       coalesce((select sum(iq.line_qty) from item_qty iq where iq.so_id=d.so_id and iq.item_index = any(d.idxs)),0) as covered_qty,
       d.status, d.deco_type, d.notes
from deco_pos_expanded d
where d.po_qty > greatest(
        coalesce((select sum(iq.line_qty) from item_qty iq where iq.so_id=d.so_id and iq.item_index = any(d.idxs)),0) * 1.5,
        coalesce((select sum(iq.line_qty) from item_qty iq where iq.so_id=d.so_id and iq.item_index = any(d.idxs)),0) + 24)
order by d.po_qty desc;

-- 2f. PO-number collisions — the same human "PO number" reused across product PO
--     lines and/or deco POs (e.g. "PO 3077" appearing on multiple orders/types).
-- with all_pos as (
--   select i.so_id, regexp_replace(pl.po_id, '\s+\S+$', '') as base_po, 'product' as kind
--     from so_item_po_lines pl join so_items i on i.id = pl.so_item_id where coalesce(pl.po_id,'') <> ''
--   union all
--   select s.id, regexp_replace(dp->>'po_id','\s+\S+$',''), 'deco'
--     from sales_orders s cross join lateral jsonb_array_elements(coalesce(s.deco_pos,'[]'::jsonb)) dp
--     where coalesce(dp->>'po_id','') <> ''
-- )
-- select base_po, count(distinct so_id) as orders, array_agg(distinct so_id) as sos, array_agg(distinct kind) as kinds
-- from all_pos group by base_po having count(distinct so_id) > 1 order by orders desc;
