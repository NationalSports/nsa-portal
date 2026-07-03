-- Migration 072: Atomic PO-number allocation
--
-- PO numbers ("PO 3522 CMSF", "DPO 3521 CMSF", "NSA 3513 OLuST", "TS 3499 AHGV") were minted
-- client-side as max+1 over the orders loaded in that tab. Two sessions minting concurrently — or
-- one session minting against stale data — issued the same numbers to different customers:
--   · 2026-06-29: PO 3476 issued to both CMSF and EBV
--   · 2026-06-30: PO 3521/3522 issued to CMSF, lost in a stale-save overwrite (SO-1333), then
--     re-issued to OLuST the same day — leaving a vendor invoice referencing a PO the portal
--     no longer had.
--
-- Fix: a DB sequence with INCREMENT BY 50. reserve_po_block() returns nextval, which atomically
-- claims a 50-number block [start, start+49] for the calling session — concurrent callers can never
-- overlap by construction. The client seeds its local counter from the block start and increments
-- locally within the block (the editor's existing sync mint flow is unchanged), re-reserving when
-- the block nears exhaustion. Unused numbers in a block are simply skipped; gaps are harmless.
--
-- Seeded above the max numeric core found in so_item_po_lines + sales_orders.deco_pos +
-- estimates.deco_pos, with a +100 margin for numbers held by tabs that are open mid-migration.
-- The [\s-]+ (one-or-more) separator is load-bearing: old-system/NetSuite ids have NO space
-- ("PO8635EXPRESSMM") and run in a higher numeric range — seeding from those would push portal
-- numbers into the old range and cross-match in the Sports Inc bill matcher's po_core comparison.

do $$
declare
  seed bigint;
begin
  select greatest(
    coalesce((select max((regexp_match(po_id, '^(?:D?PO|NSA|TS)[\s-]+(\d{3,6})'))[1]::bigint)
              from so_item_po_lines
              where po_id ~ '^(?:D?PO|NSA|TS)[\s-]+\d{3,6}'), 0),
    coalesce((select max((regexp_match(dp->>'po_id', '^(?:D?PO|NSA|TS)[\s-]+(\d{3,6})'))[1]::bigint)
              from sales_orders so, jsonb_array_elements(coalesce(so.deco_pos, '[]'::jsonb)) dp
              where dp->>'po_id' ~ '^(?:D?PO|NSA|TS)[\s-]+\d{3,6}'), 0),
    coalesce((select max((regexp_match(dp->>'po_id', '^(?:D?PO|NSA|TS)[\s-]+(\d{3,6})'))[1]::bigint)
              from estimates e, jsonb_array_elements(coalesce(e.deco_pos, '[]'::jsonb)) dp
              where dp->>'po_id' ~ '^(?:D?PO|NSA|TS)[\s-]+\d{3,6}'), 0),
    3600
  ) + 100 into seed;

  if not exists (select 1 from pg_class where relkind = 'S' and relname = 'po_number_seq') then
    execute format('create sequence po_number_seq increment by 50 start with %s', seed);
  end if;
end$$;

-- Atomically claim a 50-number block; returns the block's first number.
create or replace function reserve_po_block() returns bigint
language sql security definer set search_path = public as
$$ select nextval('po_number_seq') $$;

grant execute on function reserve_po_block() to anon, authenticated;
