-- e2e/pipeline/drive.sql
--
-- Applies the REAL migrations 00191 -> 00212 (unmodified) on top of
-- e2e/pipeline/seed.sql's stub schema, then drives and ASSERTS the full
-- Team Shop / Club order pipeline. Every assertion RAISEs EXCEPTION on
-- failure, and `\set ON_ERROR_STOP on` makes any error (assertion or
-- otherwise) abort the script with a non-zero psql exit code.
--
-- Run via run.sh, which invokes this AFTER seed.sql against a fresh DB. This
-- file assumes it is executed with psql's CWD such that `\ir` (relative to
-- THIS SCRIPT's own location, not the caller's CWD) resolves to
-- supabase/migrations/ two directories up.
\set ON_ERROR_STOP on
\pset pager off

-- ═════════════════════════════════════════════════════════════════════════
-- Assertion helpers (test-harness-only; dropped at the end of this file).
-- NOTE: psql's `:'var'` substitution does NOT reach inside `$$...$$` bodies
-- (verified empirically while building this harness — a DO block quoting a
-- psql variable fails with a syntax error). _e2e_assert_raises sidesteps
-- that by building the call as dynamic SQL text via format(%L) OUTSIDE any
-- dollar-quoted body, then EXECUTE-ing it inside the function.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public._e2e_assert_true(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'ASSERTION FAILED: %', msg;
  end if;
end $$;

create or replace function public._e2e_assert_eq(actual anyelement, expected anyelement, msg text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % (expected [%] got [%])', msg, expected, actual;
  end if;
end $$;

-- Asserts that executing p_sql raises an error whose SQLERRM starts with
-- p_expected_prefix (regex-anchored). Fails loudly if the call either
-- succeeds or raises the wrong error.
create or replace function public._e2e_assert_raises(p_sql text, p_expected_prefix text, p_msg text) returns void
language plpgsql as $$
declare
  v_called_ok boolean := false;
begin
  begin
    execute p_sql;
    v_called_ok := true;
  exception
    when others then
      if sqlerrm !~ ('^' || p_expected_prefix) then
        raise exception 'ASSERTION FAILED: % (expected error starting with "%", got: %)', p_msg, p_expected_prefix, sqlerrm;
      end if;
      raise notice 'OK (%): %', p_msg, sqlerrm;
  end;
  if v_called_ok then
    raise exception 'ASSERTION FAILED: % (expected an error starting with "%", but the call succeeded)', p_msg, p_expected_prefix;
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 1: Applying real migrations 00191 -> 00212 (unmodified)'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
\ir ../../supabase/migrations/00191_artwork_storage_staff_write.sql
\ir ../../supabase/migrations/00192_job_stage_machine.sql
\ir ../../supabase/migrations/00193_purchase_orders.sql
\ir ../../supabase/migrations/00194_teamshop_logos.sql
\ir ../../supabase/migrations/00195_teamshop_orders.sql
\ir ../../supabase/migrations/00196_create_teamshop_sales_order.sql
\ir ../../supabase/migrations/00197_teamshop_handoff.sql
\ir ../../supabase/migrations/00198_teamshop_deco_rates.sql
\ir ../../supabase/migrations/00199_teamshop_conversion_invoice.sql
\ir ../../supabase/migrations/00200_teamshop_po_allowed.sql
\ir ../../supabase/migrations/00201_teamshop_po_orders.sql
\ir ../../supabase/migrations/00202_teamshop_auto_po.sql
\ir ../../supabase/migrations/00203_teamshop_delivery_timelines.sql
\ir ../../supabase/migrations/00204_club_store_conversion.sql
\ir ../../supabase/migrations/00205_release_gate.sql
\ir ../../supabase/migrations/00206_pull_transfers_txn.sql
\ir ../../supabase/migrations/00207_auto_art.sql
\ir ../../supabase/migrations/00208_teamshop_auto_release.sql
\ir ../../supabase/migrations/00209_teamshop_auto_po_needs_dismiss.sql
\ir ../../supabase/migrations/00210_so_jobs_notes.sql
\ir ../../supabase/migrations/00211_teamshop_dtf_auto_po.sql
\ir ../../supabase/migrations/00212_so_jobs_dtf_prints_status.sql
\echo '--- all 22 migrations applied cleanly ---'

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 2: Seeding order A (Team Shop) rows — needs 00194/00195'
\echo '================================================================'
-- Deferred from seed.sql on purpose: order_source/coach_id/customer_id
-- (webstore_orders) and decorations/unit_deco_price (webstore_order_items)
-- are added by migration 00195; teamshop_logos is created by 00194. Both
-- must exist before these rows can be inserted — see seed.sql's header.
-- ═════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- The coach's own logo upload (raw, un-approved) — this is what item 2's
-- DTF decoration references; per 00207's header a 'teamshop:<id>' ref can
-- NEVER auto-art, so this job stays needs_art (our release-gate target).
insert into teamshop_logos (id, customer_id, coach_id, name, url) values
  ('d1111111-0000-0000-0000-000000000001', 'CUST-TS', 'a1111111-1111-1111-1111-111111111111',
   'Tigers Alt Logo (coach upload)', 'https://cdn.example/tigers-alt.png');

insert into webstore_orders (id, store_id, status, buyer_name, buyer_email, total)
select 'a2222222-0000-0000-0000-000000000001', id, 'paid', 'Jane Coach', 'jane@tigersfc.example', 108.00
  from webstores where slug = 'nationalteamshop';
update webstore_orders
   set order_source = 'teamshop', coach_id = 'a1111111-1111-1111-1111-111111111111',
       customer_id = 'CUST-TS', quote_hash = 'qh-order-a'
 where id = 'a2222222-0000-0000-0000-000000000001';

-- Item 1: 3 tees (2M+1L), embroidery deco carrying art_file_id — resolves to
-- CUST-TS.art_files[0], which is production-ready -> auto-art fires.
-- Item 2: 1 hoodie, DTF deco carrying teamshop_logo_id (raw coach upload) —
-- never auto-arts -> job stays needs_art (our release-gate target below).
insert into webstore_order_items (order_id, product_id, sku, name, color, size, qty, unit_price, decorations, unit_deco_price) values
  ('a2222222-0000-0000-0000-000000000001', 'P-TEE-TS', 'PC54TS', 'Core Cotton Tee', 'Black', 'M', 2, 16.00,
   '[{"type":"embroidery","placement":"left_chest","stitches":5000,"art_file_id":"art-tigers-1","art_url":"https://cdn.example/tigers-crest.png"}]'::jsonb, 8.00),
  ('a2222222-0000-0000-0000-000000000001', 'P-TEE-TS', 'PC54TS', 'Core Cotton Tee', 'Black', 'L', 1, 16.00,
   '[{"type":"embroidery","placement":"left_chest","stitches":5000,"art_file_id":"art-tigers-1","art_url":"https://cdn.example/tigers-crest.png"}]'::jsonb, 8.00),
  ('a2222222-0000-0000-0000-000000000001', 'P-HOOD-TS', 'PC78HTS', 'Core Fleece Hoodie', 'Black', 'M', 1, 30.00,
   '[{"type":"dtf","placement":"full_back","dtf_size":10,"logo_source":"teamshop","teamshop_logo_id":"d1111111-0000-0000-0000-000000000001","art_url":"https://cdn.example/tigers-alt.png"}]'::jsonb, 6.00);

-- Guard fixture: a Team Shop order that never got paid (NSA_NOT_PAID target).
insert into webstore_orders (id, store_id, status, buyer_name, total)
select 'a2222222-0000-0000-0000-000000000099', id, 'pending_payment', 'Not Paid Guy', 20
  from webstores where slug = 'nationalteamshop';
update webstore_orders set order_source = 'teamshop', customer_id = 'CUST-TS'
 where id = 'a2222222-0000-0000-0000-000000000099';
insert into webstore_order_items (order_id, product_id, sku, name, size, qty, unit_price)
values ('a2222222-0000-0000-0000-000000000099', 'P-TEE-TS', 'PC54TS', 'Core Cotton Tee', 'M', 1, 16.00);

\echo '--- order A rows + guard fixture seeded ---'

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 3: Stamping order B transfer unit_cost — needs 00204'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
update webstore_transfers set unit_cost = 1.85 where code = 'RIDGE24';
select public._e2e_assert_eq((select unit_cost from webstore_transfers where code='RIDGE24'), 1.85::numeric,
  '00204 added webstore_transfers.unit_cost');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 4: CONVERT — create_teamshop_sales_order / create_club_sales_order'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════

\echo '--- order A: convert ---'
-- NOTE: no_rep is captured WITHOUT a ::boolean cast on purpose — jsonb ->>
-- on a JSON boolean already yields text 'true'/'false' (safe to substitute
-- bare later); casting to native boolean first would make psql capture
-- Postgres's own 't'/'f' wire format instead, which is not a valid bare SQL
-- literal on substitution (verified empirically while building this file).
select r->>'so_id' as ts_so_id, r->>'invoice_id' as ts_inv_id,
       r->>'no_rep' as ts_no_rep, (r->>'jobs')::int as ts_jobs,
       (r->>'items')::int as ts_items, (r->>'units')::int as ts_units
  from (select create_teamshop_sales_order('a2222222-0000-0000-0000-000000000001'::uuid) as r) s \gset

select public._e2e_assert_true(:'ts_so_id' like 'SO-%', 'order A so_id looks like SO-<n>');
select public._e2e_assert_eq(:ts_jobs, 2, 'order A should birth 2 jobs (embroidery + dtf)');
select public._e2e_assert_eq(:ts_items, 2, 'order A should have 2 so_items (tee group + hoodie group)');
select public._e2e_assert_eq(:ts_units, 4, 'order A should total 4 units (3 tee + 1 hoodie)');
select public._e2e_assert_eq(:ts_no_rep, false, 'CUST-TS has a rep — no_rep must be false');

\echo '--- order A: so_items (unit_sell / nsa_cost / sizes) ---'
select item_index, sku, unit_sell, nsa_cost, sizes from so_items where so_id = :'ts_so_id' order by item_index;
select public._e2e_assert_eq((select unit_sell from so_items where so_id=:'ts_so_id' and sku='PC54TS'), 24.00::numeric,
  'tee unit_sell = (16 garment + 8 embroidery deco) / unit');
select public._e2e_assert_eq((select nsa_cost from so_items where so_id=:'ts_so_id' and sku='PC54TS'), 3.50::numeric,
  'tee nsa_cost = products.nsa_cost');
select public._e2e_assert_eq((select sizes from so_items where so_id=:'ts_so_id' and sku='PC54TS'), '{"M":2,"L":1}'::jsonb,
  'tee sizes merged across the M and L order lines');
select public._e2e_assert_eq((select unit_sell from so_items where so_id=:'ts_so_id' and sku='PC78HTS'), 36.00::numeric,
  'hoodie unit_sell = (30 garment + 6 dtf deco) / unit');
select public._e2e_assert_eq((select nsa_cost from so_items where so_id=:'ts_so_id' and sku='PC78HTS'), 12.00::numeric,
  'hoodie nsa_cost = products.nsa_cost');

\echo '--- order A: so_item_decorations ---'
select d.kind, d.type, d.position, d.stitches, d.dtf_size, d.cost_each from so_item_decorations d
  join so_items i on i.id=d.so_item_id where i.so_id=:'ts_so_id' order by i.item_index;
select public._e2e_assert_eq((select count(*) from so_item_decorations d join so_items i on i.id=d.so_item_id where i.so_id=:'ts_so_id')::int, 2,
  'one decoration row per so_item (embroidery on the tee, dtf on the hoodie)');
select public._e2e_assert_eq(
  (select d.position from so_item_decorations d join so_items i on i.id=d.so_item_id where i.so_id=:'ts_so_id' and d.type='embroidery'),
  'Left Chest', 'embroidery deco placement mapped left_chest -> Left Chest');
select public._e2e_assert_eq(
  (select d.stitches from so_item_decorations d join so_items i on i.id=d.so_item_id where i.so_id=:'ts_so_id' and d.type='embroidery'),
  5000, 'embroidery deco stitches carried through from the quote');
select public._e2e_assert_eq(
  (select d.position from so_item_decorations d join so_items i on i.id=d.so_item_id where i.so_id=:'ts_so_id' and d.type='dtf'),
  'Back', 'dtf deco placement mapped full_back -> Back');
select public._e2e_assert_eq(
  (select d.dtf_size from so_item_decorations d join so_items i on i.id=d.so_item_id where i.so_id=:'ts_so_id' and d.type='dtf'),
  10, 'dtf deco dtf_size carried through from the quote');

\echo '--- order A: so_jobs — auto-art fires for the embroidery job only ---'
select id, deco_type, art_file_id, art_status, item_status, prod_status, digitizing_needed from so_jobs where so_id=:'ts_so_id' order by deco_type;
select public._e2e_assert_eq((select art_status from so_jobs where so_id=:'ts_so_id' and deco_type='embroidery'), 'art_complete',
  'embroidery job born art_complete via auto-art (art_file_id logo resolves to a production-ready customer.art_files entry)');
select public._e2e_assert_eq((select art_file_id from so_jobs where so_id=:'ts_so_id' and deco_type='embroidery'), 'art-tigers-1',
  'embroidery job art_file_id set to the resolved art-library id');
select public._e2e_assert_eq((select digitizing_needed from so_jobs where so_id=:'ts_so_id' and deco_type='embroidery'), false,
  'auto-art forces digitizing_needed false');
select public._e2e_assert_eq((select art_status from so_jobs where so_id=:'ts_so_id' and deco_type='dtf'), 'needs_art',
  'dtf job (raw coach upload via teamshop_logo_id) never auto-arts — stays needs_art');
select public._e2e_assert_eq((select item_status from so_jobs where so_id=:'ts_so_id' and deco_type='embroidery'), 'need_to_order',
  'auto-art only completes the ART half of readiness — item_status still needs the normal stock flow (00205 design intent)');

\echo '--- order A: job_stage_events created payload carries auto_art ---'
select j.deco_type, e.event, e.payload->>'auto_art' as auto_art, e.payload->>'art_file_id' as art_file_id
  from job_stage_events e join so_jobs j on j.so_id=e.so_id and j.id=e.job_id
 where e.so_id=:'ts_so_id' and e.event='created' order by j.deco_type;
select public._e2e_assert_eq((select count(*) from job_stage_events where so_id=:'ts_so_id' and event='created')::int, 2,
  'one created event per job');
select public._e2e_assert_eq(
  (select (e.payload->>'auto_art')::boolean from job_stage_events e join so_jobs j on j.so_id=e.so_id and j.id=e.job_id
     where e.so_id=:'ts_so_id' and e.event='created' and j.deco_type='embroidery'),
  true, 'embroidery created-event payload.auto_art = true');
select public._e2e_assert_eq(
  (select (e.payload->>'auto_art')::boolean from job_stage_events e join so_jobs j on j.so_id=e.so_id and j.id=e.job_id
     where e.so_id=:'ts_so_id' and e.event='created' and j.deco_type='dtf'),
  false, 'dtf created-event payload.auto_art = false');

\echo '--- order A: invoice created + settled ---'
select id, total, paid, status, so_id from invoices where so_id=:'ts_so_id';
select public._e2e_assert_true(:'ts_inv_id' like 'INV-%', 'order A invoice_id looks like INV-<n>');
select public._e2e_assert_eq((select status from invoices where id=:'ts_inv_id'), 'paid', 'order A invoice settles fully (card == invoice total)');
select public._e2e_assert_eq((select total from invoices where id=:'ts_inv_id'), 108.00::numeric, 'order A invoice total = Sum(unit_sell x qty)');
select public._e2e_assert_eq((select paid from invoices where id=:'ts_inv_id'), 108.00::numeric, 'order A invoice paid in full');
select public._e2e_assert_eq((select so_id from invoices where id=:'ts_inv_id'), :'ts_so_id', 'invoice.so_id links back to the SO');

\echo '--- order A: guard — an unpaid order is refused ---'
select public._e2e_assert_raises(
  format('select create_teamshop_sales_order(%L::uuid)', 'a2222222-0000-0000-0000-000000000099'),
  'NSA_NOT_PAID', 'unpaid Team Shop order is refused');

\echo '--- order B: convert ---'
select r->>'so_id' as club_so_id, r->>'invoice_id' as club_inv_id,
       r->>'no_rep' as club_no_rep, (r->>'jobs')::int as club_jobs,
       (r->>'items')::int as club_items, (r->>'units')::int as club_units
  from (select create_club_sales_order('c4444444-0000-0000-0000-000000000001'::uuid) as r) s \gset

select public._e2e_assert_true(:'club_so_id' like 'SO-%', 'order B so_id looks like SO-<n>');
select public._e2e_assert_eq(:club_jobs, 2, 'order B should birth 2 jobs (embroidery logo + heat_press transfer)');
select public._e2e_assert_eq(:club_items, 3, 'order B should have 3 so_items (tee / hoodie / sock)');
select public._e2e_assert_eq(:club_units, 5, 'order B should total 5 units');
select public._e2e_assert_eq(:club_no_rep, false, 'CUST-CLUB has a rep — no_rep must be false');

\echo '--- order B: so_items (disc_ratio = (143-14.3)/143 = 0.9) ---'
select item_index, sku, unit_sell, nsa_cost, sizes from so_items where so_id=:'club_so_id' order by item_index;
select public._e2e_assert_eq((select unit_sell from so_items where so_id=:'club_so_id' and sku='T100'), 19.80::numeric, 'tee unit_sell (disc_ratio applied)');
select public._e2e_assert_eq((select nsa_cost from so_items where so_id=:'club_so_id' and sku='T100'), 6.00::numeric, 'tee nsa_cost = products.nsa_cost');
select public._e2e_assert_eq((select unit_sell from so_items where so_id=:'club_so_id' and sku='H200'), 44.55::numeric, 'hoodie unit_sell (disc_ratio applied)');
select public._e2e_assert_eq((select nsa_cost from so_items where so_id=:'club_so_id' and sku='H200'), 11.50::numeric, 'hoodie nsa_cost = clearance_cost (is_clearance=true)');
select public._e2e_assert_eq((select unit_sell from so_items where so_id=:'club_so_id' and sku='S300'), 24.75::numeric, 'bundle sock unit_sell (weighted allocation x disc_ratio)');

\echo '--- order B: so_item_decorations (logo + transfer + numbers + names) ---'
select d.kind, d.type, d.position, d.transfer_code, d.cost_each from so_item_decorations d
  join so_items i on i.id=d.so_item_id where i.so_id=:'club_so_id' order by i.item_index, d.deco_index;
select public._e2e_assert_eq((select count(*) from so_item_decorations d join so_items i on i.id=d.so_item_id where i.so_id=:'club_so_id' and d.type='heat_press')::int,
  2, 'two heat_press transfer rows: one from the tee catalog code, one from the sock bundle_item code');
select public._e2e_assert_eq((select cost_each from so_item_decorations d join so_items i on i.id=d.so_item_id
     where i.so_id=:'club_so_id' and d.type='heat_press' limit 1), 1.85::numeric,
  'transfer cost_each = webstore_transfers.unit_cost');

\echo '--- order B: so_jobs — auto-art fires for the embroidery/logo job only ---'
select id, deco_type, art_file_id, art_status, item_status, prod_status from so_jobs where so_id=:'club_so_id' order by deco_type;
select public._e2e_assert_eq((select art_status from so_jobs where so_id=:'club_so_id' and deco_type='embroidery'), 'art_complete', 'club logo job born art_complete via auto-art');
select public._e2e_assert_eq((select art_file_id from so_jobs where so_id=:'club_so_id' and deco_type='embroidery'), 'art-ridge-crest', 'club logo job resolved to the art-library id');
select public._e2e_assert_eq((select art_status from so_jobs where so_id=:'club_so_id' and deco_type='heat_press'), 'needs_art', 'transfer job never auto-arts (xfer: ref carries no art-library id)');

\echo '--- order B: invoice + fundraise credit ---'
select id, total, paid, status from invoices where so_id=:'club_so_id';
select public._e2e_assert_eq((select status from invoices where id=:'club_inv_id'), 'paid', 'order B invoice settles fully');
select public._e2e_assert_eq((select total from invoices where id=:'club_inv_id'), 128.70::numeric, 'order B invoice total');
select public._e2e_assert_eq((select paid from invoices where id=:'club_inv_id'), 128.70::numeric, 'order B invoice paid in full');
select public._e2e_assert_eq((select so_id from invoices where id=:'club_inv_id'), :'club_so_id', 'invoice.so_id links back to the SO');
select amount, is_fundraise from customer_credits where id = 'cr_fund_so_' || :'club_so_id';
select public._e2e_assert_eq((select amount from customer_credits where id='cr_fund_so_'||:'club_so_id'), 11.70::numeric,
  'club fundraise credit = fundraise_amt(13) x disc_ratio(0.9)');
select public._e2e_assert_eq((select is_fundraise from customer_credits where id='cr_fund_so_'||:'club_so_id'), true, 'fundraise credit flagged is_fundraise');

\echo '--- order B: guards — unpaid club order / paid TEAM-store order refused ---'
select public._e2e_assert_raises(
  format('select create_club_sales_order(%L::uuid)', 'c4444444-0000-0000-0000-000000000002'),
  'NSA_NOT_PAID', 'unpaid club order is refused');
select public._e2e_assert_raises(
  format('select create_club_sales_order(%L::uuid)', 'c4444444-0000-0000-0000-000000000003'),
  'NSA_BAD_SOURCE', 'paid order on a non-club (team) store is refused');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 5: REPLAY SAFETY'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
select (select count(*) from sales_orders)::int as so_before, (select count(*) from invoices)::int as inv_before,
       (select count(*) from so_jobs)::int as jobs_before, (select count(*) from customer_credits)::int as cred_before \gset pre_replay_

select (create_teamshop_sales_order('a2222222-0000-0000-0000-000000000001'::uuid))->>'replayed' as ts_replayed \gset
select public._e2e_assert_eq(:ts_replayed, true, 'order A replay returns replayed:true');

select (create_club_sales_order('c4444444-0000-0000-0000-000000000001'::uuid))->>'replayed' as club_replayed \gset
select public._e2e_assert_eq(:club_replayed, true, 'order B replay returns replayed:true');

select public._e2e_assert_eq((select count(*) from sales_orders)::int, :pre_replay_so_before, 'no duplicate SO after replay');
select public._e2e_assert_eq((select count(*) from invoices)::int, :pre_replay_inv_before, 'no duplicate invoice after replay');
select public._e2e_assert_eq((select count(*) from so_jobs)::int, :pre_replay_jobs_before, 'no duplicate jobs after replay');
select public._e2e_assert_eq((select count(*) from customer_credits)::int, :pre_replay_cred_before, 'no duplicate fundraise credit after replay');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 6: COMMISSION VISIBILITY — invoice -> SO link (calcGP walks invoices->SO)'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
select i.id as invoice_id, i.so_id, i.status, i.total, s.customer_id
  from invoices i join sales_orders s on s.id = i.so_id
 where i.id in (:'ts_inv_id', :'club_inv_id');
select public._e2e_assert_true(
  (select count(*) from invoices i join sales_orders s on s.id=i.so_id where i.id=:'ts_inv_id') = 1,
  'order A invoice resolves to exactly one SO via invoices.so_id (the join calcGP performs)');
select public._e2e_assert_true(
  (select count(*) from invoices i join sales_orders s on s.id=i.so_id where i.id=:'club_inv_id') = 1,
  'order B invoice resolves to exactly one SO via invoices.so_id');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 7: READINESS + RELEASE GATE (00205)'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
select id as ts_dtf_job from so_jobs where so_id=:'ts_so_id' and deco_type='dtf' \gset
select id as club_xfer_job from so_jobs where so_id=:'club_so_id' and deco_type='heat_press' \gset

\echo '--- not ready: release on a needs_art / need_to_order job -> NSA_NOT_READY ---'
select public._e2e_assert_raises(
  format('select advance_job_stage(%L, %L, %L, %L)', :'ts_so_id', :'ts_dtf_job', 'release', 'staff-1'),
  'NSA_NOT_READY', 'order A dtf job is not ready (needs_art + need_to_order)');

\echo '--- mark art complete + item in-hand -> release succeeds ---'
update so_jobs set art_status='art_complete', item_status='items_received', art_file_id=coalesce(art_file_id,'manual-art-1')
 where so_id=:'ts_so_id' and id=:'ts_dtf_job';

select (advance_job_stage(:'ts_so_id', :'ts_dtf_job', 'release', 'staff-1'))->>'ok' as release_ok \gset
select public._e2e_assert_eq(:release_ok, true, 'release succeeds once art+stock are ready');
select public._e2e_assert_eq((select prod_status from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job'), 'staging', 'job moved hold -> staging');

\echo '--- override path: release a not-ready job with p_override -> succeeds, payload audited ---'
select public._e2e_assert_eq((select art_status from so_jobs where so_id=:'club_so_id' and id=:'club_xfer_job'), 'needs_art',
  'sanity: the club transfer job is genuinely not ready before the override');
select (advance_job_stage(:'club_so_id', :'club_xfer_job', 'release', 'staff-2', null, '{}'::jsonb, true, 'staff confirmed transfers on hand'))->>'ok' as override_ok \gset
select public._e2e_assert_eq(:override_ok, true, 'override bypasses the readiness gate');
select public._e2e_assert_eq((select prod_status from so_jobs where so_id=:'club_so_id' and id=:'club_xfer_job'), 'staging', 'overridden job moved hold -> staging too');
select payload from job_stage_events where so_id=:'club_so_id' and job_id=:'club_xfer_job' and event='release' order by id desc limit 1;
select public._e2e_assert_eq(
  (select payload from job_stage_events where so_id=:'club_so_id' and job_id=:'club_xfer_job' and event='release' order by id desc limit 1),
  '{"reason": "staff confirmed transfers on hand", "override": true}'::jsonb,
  'override event payload is audited exactly (override:true, reason recorded)');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 8: STAGE MACHINE — release -> start_run -> decorated -> packed'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
select (advance_job_stage(:'ts_so_id', :'ts_dtf_job', 'start_run', 'staff-1'))->>'ok' as start_ok \gset
select public._e2e_assert_eq(:start_ok, true, 'start_run succeeds');
select public._e2e_assert_eq((select prod_status from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job'), 'in_process', 'staging -> in_process');

select (advance_job_stage(:'ts_so_id', :'ts_dtf_job', 'decorated', 'staff-1'))->>'ok' as dec_ok \gset
select public._e2e_assert_eq(:dec_ok, true, 'decorated succeeds');
select prod_status, decorated_at is not null as has_decorated_at, completed_at is not null as has_completed_at
  from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job';
select public._e2e_assert_eq((select prod_status from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job'), 'completed', 'in_process -> completed');
select public._e2e_assert_true((select decorated_at is not null from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job'), 'decorated_at stamped');
select public._e2e_assert_true((select completed_at is not null from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job'), 'completed_at stamped (mirrors applyJobMove)');

select (advance_job_stage(:'ts_so_id', :'ts_dtf_job', 'packed', 'staff-1'))->>'ok' as packed_ok \gset
select public._e2e_assert_eq(:packed_ok, true, 'packed succeeds');
select public._e2e_assert_eq((select prod_status from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job'), 'completed', 'packed keeps prod_status completed (no move — just stamps packed_at)');
select public._e2e_assert_true((select packed_at is not null from so_jobs where so_id=:'ts_so_id' and id=:'ts_dtf_job'), 'packed_at stamped');

select public._e2e_assert_eq(
  (select count(*) from job_stage_events where so_id=:'ts_so_id' and job_id=:'ts_dtf_job' and event in ('release','start_run','decorated','packed'))::int,
  4, 'one job_stage_events row per stage-machine step');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 9: TRANSFER PULL (00206) — atomic decrement, no lost update'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
select store_id from webstore_orders where id='c4444444-0000-0000-0000-000000000001' \gset club_store_
select on_hand as xfer_before from webstore_transfers where code='RIDGE24' \gset

select (pull_webstore_transfers(:'club_store_store_id', array[:'club_so_id'], '[{"code":"RIDGE24","qty":12}]'::jsonb))->>'decremented' as pull1_decremented \gset
select public._e2e_assert_eq(:pull1_decremented, 1, 'first pull decremented exactly one transfer row');
select public._e2e_assert_eq((select on_hand from webstore_transfers where code='RIDGE24'), (:xfer_before - 12), 'on_hand decremented by the pulled qty (100 -> 88)');
select public._e2e_assert_true((select transfers_pulled from webstore_orders where id='c4444444-0000-0000-0000-000000000001'), 'transfers_pulled stamped true');
select public._e2e_assert_true((select transfers_pulled_at is not null from webstore_orders where id='c4444444-0000-0000-0000-000000000001'), 'transfers_pulled_at stamped');

-- Second call MUST accumulate on top of the first (88 -> 83), never lose the
-- first pull's decrement — this is 00206's entire reason for existing.
select (pull_webstore_transfers(:'club_store_store_id', array[:'club_so_id'], '[{"code":"RIDGE24","qty":5}]'::jsonb))->>'decremented' as pull2_decremented \gset
select public._e2e_assert_eq(:pull2_decremented, 1, 'second pull also decremented exactly one row');
select public._e2e_assert_eq((select on_hand from webstore_transfers where code='RIDGE24'), (:xfer_before - 12 - 5), 'second pull ACCUMULATES on the live row (88 -> 83) — no lost update');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 10: SHIPPED BRIDGE (migration 037) — SO shipped -> line_status'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
select count(*) as n from webstore_order_items where order_id='a2222222-0000-0000-0000-000000000001' \gset ts_lines_
select public._e2e_assert_true(:ts_lines_n > 0, 'order A has webstore_order_items rows to advance');
select public._e2e_assert_true(
  (select bool_and(coalesce(line_status,'pending') <> 'shipped') from webstore_order_items where order_id='a2222222-0000-0000-0000-000000000001'),
  'sanity: order A lines are NOT shipped yet, before the trigger fires');

update sales_orders set _shipped = true where id = :'ts_so_id';

select line_status, count(*) from webstore_order_items where order_id='a2222222-0000-0000-0000-000000000001' group by 1;
select public._e2e_assert_true(
  (select bool_and(line_status = 'shipped') from webstore_order_items where order_id='a2222222-0000-0000-0000-000000000001'),
  'webstore_sync_status trigger (migration 037) advanced every order-A line to shipped');

-- Bonus: MONOTONIC means it never downgrades — an earlier-stage SO write
-- must not revert an already-shipped line.
update sales_orders set status = 'in_production' where id = :'ts_so_id';
select public._e2e_assert_true(
  (select bool_and(line_status = 'shipped') from webstore_order_items where order_id='a2222222-0000-0000-0000-000000000001'),
  'trigger is monotonic: an earlier-stage status update never downgrades an already-shipped line');

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 11: DTF LANE (00211/00212) — sibling-table isolation + threshold'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
select public._e2e_assert_true(
  not exists (select 1 from information_schema.columns where table_name='teamshop_auto_po_needs' and column_name='job_id'),
  'structural: teamshop_auto_po_needs has no job_id column at all — DTF and garment needs are genuinely separate tables (00211 design rationale)');

-- Simulate that the garment auto-PO engine already evaluated order A
-- (JS-side, netlify/functions/teamshop-auto-po.js — not exercised by this
-- SQL harness; see teamshopAutoPo.test.js) and recorded a real garment need.
insert into teamshop_auto_po_needs (so_id, so_item_id, product_id, sku, size, qty_ordered, qty_on_hand, qty_needed, vendor)
select :'ts_so_id', it.id, it.product_id, it.sku, 'M', 1, 0, 1, 'SanMar'
  from so_items it where it.so_id=:'ts_so_id' and it.sku='PC54TS';

select count(*) as n from teamshop_auto_po_needs where so_id=:'ts_so_id' \gset garment_needs_
select public._e2e_assert_eq(:garment_needs_n, 1, 'one garment need on record for order A before any DTF activity');

-- Record the real DTF job's print need, plus two synthetic ones from other
-- (hypothetical) orders so the pending pool can meaningfully cross a
-- threshold below.
insert into teamshop_dtf_print_needs (so_id, job_id, qty, status)
select so_id, id, total_units, 'pending' from so_jobs where so_id=:'ts_so_id' and deco_type='dtf';
insert into teamshop_dtf_print_needs (so_id, job_id, qty, status) values
  ('SO-9001', 'JOB-9001-01', 5, 'pending'),
  ('SO-9002', 'JOB-9002-01', 6, 'pending');

\echo '--- sibling-table isolation: DTF needs never leak into / disturb teamshop_auto_po_needs ---'
select public._e2e_assert_eq((select count(*) from teamshop_auto_po_needs where so_id=:'ts_so_id')::int, :garment_needs_n,
  'garment needs for order A are untouched by the DTF insert (same-so_id, different table, no cross-write)');
select public._e2e_assert_eq((select count(*) from teamshop_auto_po_needs where so_id in ('SO-9001','SO-9002'))::int, 0,
  'the DTF-only synthetic orders never appear in teamshop_auto_po_needs -- garment ordering is not suppressed by DTF need rows');

\echo '--- threshold / backstop condition (dtfBatchDecision is JS; unit-tested separately) ---'
update teamshop_auto_po_settings set threshold_qty = 10, max_age_days = 7 where deco_type = 'dtf';
select vendor, threshold_qty, max_age_days from teamshop_auto_po_settings where deco_type='dtf';
select sum(qty) as n from teamshop_dtf_print_needs where status='pending' \gset total_pending_
select public._e2e_assert_true(:total_pending_n >= 10,
  'pending DTF print qty has crossed the seeded threshold_qty (10) -- teamshop-auto-po.js''s sweepDtf would batch these into one draft PO on its next run');
\echo 'NOTE: dtfBatchDecision (the pure threshold/backstop gate) and sweepDtf (the'
\echo '  orchestration that actually calls create_purchase_order) are JS, not SQL --'
\echo '  see src/__tests__/teamshopAutoPo.test.js (already covers: threshold trip,'
\echo '  below-threshold, max_age_days backstop, not_configured, no_pending). This'
\echo '  SQL section only proves the DATA those functions read is shaped correctly'
\echo '  and that the sibling-table split (00211''s stated design rationale) holds'
\echo '  for real, against the real teamshop_auto_po_needs/teamshop_dtf_print_needs'
\echo '  tables migrated above -- not a mock.'

-- ═════════════════════════════════════════════════════════════════════════
\echo '================================================================'
\echo 'SECTION 12: SUMMARY'
\echo '================================================================'
-- ═════════════════════════════════════════════════════════════════════════
drop function if exists public._e2e_assert_true(boolean, text);
drop function if exists public._e2e_assert_eq(anyelement, anyelement, text);
drop function if exists public._e2e_assert_raises(text, text, text);

\echo 'ALL ASSERTIONS PASSED'
