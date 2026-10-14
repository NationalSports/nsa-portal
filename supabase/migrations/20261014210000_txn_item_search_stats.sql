-- Transaction-item search reads a small precomputed list instead of the whole archive.
--
-- search_txn_items (global search's "past items" section) aggregated all ~230k
-- customer_invoice_lines rows on every call, re-deriving the parent item code row by row.
-- On 2026-10-14 a single search for "3s" took 45 s on production; the API gives up at ~8 s, so
-- 53 of 57 searches in one hour ended in an error, and each one still burned the CPU time.
--
-- The archive is a periodic NetSuite import (scripts/merge-netsuite-transactions.py; last
-- touched 2026-10-03), so the per-item totals barely change. They now live in a materialized
-- view — one row per parent item code, ~7,300 rows — and the search filters that.
--
-- Same results by construction: the old query filtered rows by a condition on the item code
-- and then grouped by that same code, which equals grouping everything and then filtering the
-- groups. Same filters (non-null code, not a service/charge code, at least one sales-order
-- line), same totals, same ranking, same signature and columns. in_catalog is still computed
-- live against products.
--
-- Access: the view is NOT readable by anon/authenticated (it summarizes the staff-only
-- archive). search_txn_items now runs as its owner to read it and returns rows only to staff,
-- the same rule as the archive's own policy (customer_invoice_lines_staff_all).
--
-- Freshness: refreshed nightly by pg_cron, and the import script refreshes it at the end of
-- every import.

begin;

-- The service-code test is a regex; running it once per distinct raw item (~15k) instead of once
-- per line (~230k) takes the build from ~47 s to ~10 s on a busy production database. Same rows:
-- a line qualifies exactly when its raw item does (both CTEs are MATERIALIZED so the planner
-- can't push the regex back down onto every line).
create materialized view if not exists public.txn_item_search_stats as
  with raw_items as materialized (
    select distinct item from public.customer_invoice_lines where item is not null
  ), goods as materialized (
    select item as raw_item, txn_item_code(item) as code
      from raw_items
     where txn_item_code(item) is not null
       and not txn_item_is_service(txn_item_code(item))
  )
  select g.code as item,
         lower(g.code) as item_lower,
         count(distinct l.netsuite_internal_id)::int as txn_count,
         count(*)::int as line_count,
         sum(coalesce(l.quantity, 0)) as total_qty,
         sum(coalesce(l.amount, 0)) as total_amount,
         min(l.transaction_date) as first_date,
         max(l.transaction_date) as last_date
    from public.customer_invoice_lines l
    join goods g on g.raw_item = l.item
   group by g.code
  having count(*) filter (where l.transaction_type = 'sales_order') > 0;

-- Unique index: lets the nightly refresh run CONCURRENTLY (searches keep working during it).
create unique index if not exists txn_item_search_stats_item_uidx on public.txn_item_search_stats (item);

revoke all on public.txn_item_search_stats from public, anon, authenticated;

create or replace function public.search_txn_items(p_query text, p_limit integer default 20)
returns table(item text, txn_count integer, line_count integer, total_qty numeric, total_amount numeric,
              first_date date, last_date date, in_catalog boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as t)
  select s.item, s.txn_count, s.line_count, s.total_qty, s.total_amount, s.first_date, s.last_date,
         exists (select 1 from public.products p where p.sku = s.item) as in_catalog
    from public.txn_item_search_stats s
    cross join q
   where q.t <> ''
     and (select public.is_team_member())
     and s.item_lower like '%' || q.t || '%'
   order by case when s.item_lower = q.t then 0
                 when s.item_lower like q.t || '%' then 1
                 else 2 end,
            s.txn_count desc,
            s.item
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.search_txn_items(text, integer) from public, anon;
grant execute on function public.search_txn_items(text, integer) to authenticated, service_role;

-- Nightly refresh, 2:13am Pacific (09:13 UTC). Replaces any earlier job of the same name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh_txn_item_search_stats') then
    perform cron.unschedule('refresh_txn_item_search_stats');
  end if;
  perform cron.schedule('refresh_txn_item_search_stats', '13 9 * * *',
    'refresh materialized view concurrently public.txn_item_search_stats');
end $$;

commit;
