-- ============================================================
-- PO numbering: stop burning 50 numbers per PO
--
-- Today po_number_seq is INCREMENT BY 50 and reserve_po_block()
-- hands the client a 50-number block on every PO-form open. The
-- client mints one or two numbers from it and drops the rest.
-- Measured over every PO in so_item_po_lines + the deco_pos
-- arrays: 1,527 numbers used out of a 55,608-wide span --
-- 54,081 numbers (97.25%) burned.
--
-- This migration makes the sequence hand out one number at a
-- time, so a number is consumed only when a PO is actually
-- created.
--
-- SAFE TO APPLY BEFORE THE CLIENT SHIPS. reserve_po_block()
-- below still reserves a genuine 50-number block, so a rep with
-- an old tab open keeps behaving exactly as it does today and
-- cannot collide with a session using the new single draw.
-- Remove reserve_po_block() only once no old clients remain.
-- ============================================================


-- ------------------------------------------------------------
-- 1. One number per draw
-- ------------------------------------------------------------
alter sequence po_number_seq increment by 1;


-- ------------------------------------------------------------
-- 1b. Push the sequence above every number ever issued.
--
--     REQUIRED, not housekeeping. The client now treats the
--     drawn number as authoritative and stops taking the max of
--     it and its own local max+1 seed. If the sequence were
--     behind any number already on paperwork, the next draw
--     would re-issue it. Sources: the PO lines, the deco_pos
--     arrays, and po_number_claims (numbers a form displayed but
--     never created -- these run AHEAD of created POs).
-- ------------------------------------------------------------
do $$
declare
  hi bigint;
begin
  with deco as (
    select dp->>'po_id' as pid from (
      select jsonb_array_elements(deco_pos) dp from sales_orders where jsonb_typeof(deco_pos)='array'
      union all
      select jsonb_array_elements(deco_pos) from estimates where jsonb_typeof(deco_pos)='array'
    ) d
  )
  select greatest(
    coalesce((select max(substring(po_id from '(\d{3,})')::bigint) from so_item_po_lines where po_id ~ '\d{3,}'), 0),
    coalesce((select max(substring(pid   from '(\d{3,})')::bigint) from deco             where pid   ~ '\d{3,}'), 0),
    coalesce((select max(n) from po_number_claims), 0),
    coalesce((select last_value from po_number_seq), 0)
  ) into hi;
  perform setval('po_number_seq', hi + 1, false);
end $$;


-- ------------------------------------------------------------
-- 2. The new single draw
--
--    nextval() is atomic: two reps clicking Create at the same
--    instant can never receive the same number, with or without
--    a differing alpha tag on the end.
-- ------------------------------------------------------------
create or replace function reserve_po_number()
returns bigint
language sql
security definer
set search_path to 'public'
as $$ select nextval('po_number_seq') $$;


-- ------------------------------------------------------------
-- 3. Draw several at once, for the create paths that mint a
--    second number in the same click (the NSA blanks PO, and
--    the deco PO that rides along with a product PO).
--
--    Returns the numbers actually drawn, newest last. They are
--    not assumed to be consecutive -- each is its own nextval,
--    which is what keeps concurrent sessions disjoint.
-- ------------------------------------------------------------
create or replace function reserve_po_numbers(cnt int default 1)
returns bigint[]
language sql
security definer
set search_path to 'public'
as $$
  select array_agg(nextval('po_number_seq'))
  from generate_series(1, greatest(coalesce(cnt, 1), 1))
$$;


-- ------------------------------------------------------------
-- 4. Legacy block reservation — kept for tabs opened before the
--    client update lands.
--
--    The sequence no longer strides 50 on its own, so this has
--    to advance it 50 itself. Without this an old tab would draw
--    one number, then locally mint 49 more that nothing reserved
--    — straight into numbers new sessions are drawing.
-- ------------------------------------------------------------
create or replace function reserve_po_block()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  block_start bigint;
begin
  block_start := nextval('po_number_seq');
  perform nextval('po_number_seq') from generate_series(2, 50);
  return block_start;
end;
$$;
