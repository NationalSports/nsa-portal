-- Auto-art at conversion (Team Shop "automation trio" #1 — money/persistence path).
--
-- GOAL (owner's target state): staff should only do check-in, physical production,
-- and shipping. When a coach's order re-uses a logo that the art team has ALREADY
-- finished (approved AND production files attached), the job it spawns should NOT
-- be born in 'needs_art' and sit in the art queue waiting for a human to notice
-- there's nothing to do — it should be born 'art_complete', ready to release.
--
-- This migration CREATE OR REPLACEs BOTH conversion RPCs, copying each function's
-- CURRENT body byte-for-byte in behavior (00199's create_teamshop_sales_order and
-- 00204's create_club_sales_order) and adding ONE new decision at the job-birth
-- step. 00204's file itself is NOT modified (it is in-repo/reviewed but unapplied);
-- the club auto-art lives here as a create-or-replace, applied after 00204.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT CHANGES (identical rule in both RPCs, evaluated per so_jobs row):
--
--   A job groups by (deco_type, logo_ref). logo_ref is already normalized by the
--   existing bodies to one of: 'teamshop:<id>' | 'art:<id>' | 'url:<...>' (teamshop)
--   or 'art:<art_id>' | 'xfer:<code>' (club). ONLY 'art:<id>' can carry a coach's
--   customer-art-library identity — and that is the ONE case this migration acts on.
--
--   HONEST MAPPING (why 'art:<id>' is a real customers.art_files id, both stores):
--     * Team Shop: the storefront placement engine (src/teamshop/decoSpec.js
--       buildDecoSpec) writes { art_file_id: logo.id } when the picked logo's
--       source is 'art_library', and { teamshop_logo_id: logo.id } when it is a
--       fresh coach upload ('teamshop'). teamshop-art.js's `list` action builds
--       the art_library entries straight from customers.art_files with
--       id = String(art_files[].id) (sanitizeArtFiles), scoped to the ORDER's own
--       customer (.eq('id', customerId)). So a Team Shop deco carrying art_file_id
--       is, by construction, a customers.art_files id belonging to v_cust — and
--       00199 already turns it into logo_ref 'art:<art_file_id>'. A 'teamshop:<id>'
--       ref is a raw coach upload (teamshop_logos, migration 00194) with no
--       prod_files and no approval status — it can NEVER be production-ready here,
--       so it is correctly left in needs_art (it is also the digitizing route).
--     * Club: 00204 already resolves each store-catalog logo placement against the
--       store customer's own customers.art_files by art_id (webstore_products
--       .decorations[].art_id) and emits logo_ref 'art:<art_id>'. Transfer designs
--       ('xfer:<code>') and numbers/names are not art-library logos and never
--       auto-art.
--     So teamshop CAN auto-art (contrary to a first read of 00199) — the art_file_id
--     branch is the honest join. Both RPCs resolve against the SAME table
--     (customers.art_files of the SO's customer, already loaded as v_cust).
--
--   PRODUCTION-READY predicate (v_auto_art) — the exact art half of
--   businessLogic.isJobReady (src/businessLogic.js:489-509) plus the approval gate
--   that worstArtSt (:350-352) requires before a job may read art_complete. An
--   art_files entry auto-arts its job ONLY when ALL hold:
--     1. status = 'approved'  — the art-library approval state. Without approval,
--        isJobReady/worstArtSt never lets a design reach art_complete; a merely
--        'uploaded'/'needs_approval' logo is not done art.
--     2. production files exist, by isJobReady's three-way test:
--          prod_files_attached = true                       (art team's explicit
--                                                             "seps are attached"),
--          OR prod_files array non-empty,
--          OR (deco_type = 'embroidery' AND a .dst filename appears among files
--              or prod_files) — a .dst IS the embroidery production file.
--   When v_auto_art the job is born:
--     art_file_id = <id>, _art_ids = [<id>], art_name = entry name,
--     art_status = 'art_complete', digitizing_needed = false.
--   Otherwise the job keeps TODAY'S birth EXACTLY (needs_art / '[]' / null art /
--   the original name / the original digitizing flag) — byte-for-byte 00199/00204.
--
--   The 'created' job_stage_event records the outcome: to_state.art_status reflects
--   the birth ('art_complete' vs 'needs_art'), and the payload gains
--   auto_art:<bool> + art_file_id (so the auto-release sweep, trio #2, can scope to
--   "born art_complete via auto-art" and a reviewer can audit every fire).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS SAFE-BY-CONSTRUCTION (no settings flag, unlike trio #2/#3):
--   Auto-art fires ONLY on art that a human art-team member already approved AND
--   attached production files to. It invents nothing: it copies a finished-art
--   pointer onto a new job instead of forcing staff to re-attach the identical art
--   by hand. The failure mode is a FALSE POSITIVE (art marked ready that a person
--   later judges wrong for this order) — and that is fully RECOVERABLE through the
--   normal art-recall flow: staff flip the job's art_status back to needs_art (the
--   same control they use on any job), which returns it to the art queue and, via
--   the 00205 release gate, blocks release until art is re-confirmed. Because the
--   recovery path already exists and the trigger condition is "a person already
--   finished this art," there is no default-off flag to hide behind.
--
--   NOTE on so_art_files: like 00199/00204, this migration creates NO so_art_files
--   row for the auto-arted job (the art lives in customers.art_files; the staff
--   client whole-value-rewrites customers.art_files, and so_art_files is the SO's
--   own copy staff attach through the art pipeline). Consequence: the auto-release
--   sweep's server-side art re-check must pool BOTH so_art_files AND
--   customers.art_files — documented there.
--
-- Grants: unchanged (service_role only, both functions).
-- Rollback: re-apply 00199's create_teamshop_sales_order body and 00204's
--   create_club_sales_order body verbatim (this file only replaces the two
--   functions; no DDL). Jobs already born art_complete stay as-is; recall art on
--   any that were wrong.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1) create_teamshop_sales_order — 00199 body + auto-art at job birth.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.create_teamshop_sales_order(
  p_webstore_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord         webstore_orders;
  v_cust        customers;
  v_store_name  text;
  v_num         bigint;
  v_so_id       text;
  v_memo        text;
  v_now_txt     text;
  v_today_txt   text;
  v_grp         record;
  v_p           record;
  v_deco        jsonb;
  v_deco_cost   numeric;
  v_item_id     int;
  v_idx         int := 0;
  v_di          int;
  v_unit_sell   numeric;
  v_no_deco     boolean;
  v_position    text;
  v_logo_ref    text;
  v_total_units int := 0;
  v_job         record;
  v_jn          int := 0;
  v_job_id      text;
  v_job_key     text;
  v_job_items   jsonb;
  v_job_units   int;
  v_job_name    text;
  v_positions   text;
  v_is_po       boolean;
  v_no_rep      boolean := false;
  v_inv_num     bigint;
  v_inv_id      text;
  v_inv_total   numeric;
  v_applied     numeric;
  v_inv_status  text;
  v_term_days   int;
  v_date_txt    text;
  v_due_txt     text;
  v_line_items  jsonb;
  v_pay_ref     text;
  -- ── Auto-art (00207) ──
  v_auto_art    boolean;
  v_art_id      text;
  v_art_entry   jsonb;
begin
  -- Serialize concurrent conversions of this order (convert_order + webhook may
  -- race): the loser waits here, then sees so_id set and replays.
  select * into v_ord from webstore_orders where id = p_webstore_order_id for update;
  if not found then
    raise exception 'NSA_NOT_FOUND:webstore order';
  end if;

  -- Replay-safe: already converted (by either caller or a staff batch).
  -- Also invoice-safe: the invoice below is written in the SAME transaction
  -- as the SO, so a set so_id means the invoice decision already happened.
  if v_ord.so_id is not null then
    return jsonb_build_object('so_id', v_ord.so_id, 'replayed', true);
  end if;

  if coalesce(v_ord.order_source, '') <> 'teamshop' then
    raise exception 'NSA_BAD_SOURCE:%', coalesce(v_ord.order_source, 'storefront');
  end if;
  -- 'paid' is the exact value webstore-checkout finalize and stripe-webhook
  -- write on the paid signal; 'po_verified' is the staff-verified PO signal
  -- (later workstream — accepted defensively, invoiced open below). Anything
  -- else (pending_payment, cancelled, refunded, …) must not reach production.
  if coalesce(v_ord.status, '') not in ('paid', 'po_verified') then
    raise exception 'NSA_NOT_PAID:%', coalesce(v_ord.status, '(null)');
  end if;
  v_is_po := (v_ord.status = 'po_verified');
  if v_ord.customer_id is null then
    raise exception 'NSA_BAD_INPUT:order has no customer_id';
  end if;
  if not exists (select 1 from webstore_order_items i
                 where i.order_id = v_ord.id
                   and coalesce(i.is_bundle_parent, false) = false) then
    raise exception 'NSA_BAD_INPUT:order has no items';
  end if;

  -- Rep guard (never blocks conversion): commission attribution is
  -- customer.primary_rep_id || so.created_by (businessLogic.commissionRepId)
  -- and created_by is NULL on this server path — surface the gap.
  select * into v_cust from customers where id = v_ord.customer_id;
  if not found or v_cust.primary_rep_id is null then
    v_no_rep := true;
    raise notice 'TEAMSHOP_NO_REP:%', v_ord.customer_id;
  end if;

  select name into v_store_name from webstores where id = v_ord.store_id;

  -- ── SO id mint — the client rule (App.js nextSOId / _syncDbMaxIds / _maxNum):
  -- numeric part = FIRST digit run in the id (String(id).match(/(\d+)/)),
  -- floor 1000, +1 — under an advisory xact lock so two transactions can never
  -- read the same max. (The client floors at 1000 and also considers its local
  -- state; the DB max is authoritative here — same ids by construction.)
  perform pg_advisory_xact_lock(hashtext('nsa_sales_orders_id_mint'));
  select greatest(coalesce(max((regexp_match(id, '(\d+)'))[1]::bigint), 0), 1000) + 1
    into v_num
    from sales_orders;
  v_so_id := 'SO-' || v_num;

  -- created_at/updated_at are TEXT in the client's toLocaleString() shape
  -- ('M/D/YYYY, H:MM:SS AM'); jobs use toLocaleDateString() ('M/D/YYYY').
  v_now_txt   := to_char(now(), 'FMMM/FMDD/YYYY, FMHH12:MI:SS AM');
  v_today_txt := to_char(now(), 'FMMM/FMDD/YYYY');

  -- Per-deco job grouping scratch (dropped at end; recreated per call).
  drop table if exists _ts_job_decos;
  create temporary table _ts_job_decos (
    item_idx  int,
    deco_idx  int,
    sku       text,
    iname     text,
    color     text,
    units     int,
    deco_type text,
    logo_ref  text,
    logo_name text,
    position  text,
    digitizing boolean
  ) on commit drop;

  -- ── sales_orders ── column set = webstoreCreateSO's newSO ∩ real columns
  -- (items/jobs/art_files/firm_dates are child tables; created_by is the staff
  -- user in the client path — there is none here, so it stays NULL).
  -- webstore_batch_no: assigned by the 00177 trigger (webstore_id is not null).
  v_memo := coalesce(v_store_name, 'Team Shop') || ' — order #'
      || coalesce(v_ord.order_number::text, left(v_ord.id::text, 8))
      || case when coalesce(v_ord.buyer_name, '') <> '' then ' — ' || v_ord.buyer_name else '' end;
  insert into sales_orders (
    id, customer_id, memo, status, created_at, updated_at,
    expected_date, production_notes, shipping_type, shipping_value,
    ship_to_id, tax_rate, tax_exempt, _webstore_fundraise, source, webstore_id
  ) values (
    v_so_id,
    v_ord.customer_id,
    v_memo,
    'need_order',
    v_now_txt,
    v_now_txt,
    '',
    'Team Shop: ' || coalesce(v_store_name, 'National Team Shop')
      || e'\nOrder #' || coalesce(v_ord.order_number::text, left(v_ord.id::text, 8))
      || ' · ' || coalesce(v_ord.buyer_name, '')
      || case when coalesce(v_ord.buyer_email, '') <> '' then ' (' || v_ord.buyer_email || ')' else '' end
      || e'\ndelivery: ship to home'
      || case when v_is_po
              then e'\nPurchase order (verified) — invoiced open: $' || to_char(coalesce(v_ord.total, 0), 'FM999999990.00')
              else e'\nPaid by card (Stripe): $' || to_char(coalesce(v_ord.total, 0), 'FM999999990.00')
                   || ' — sales tax collected on the store order.'
         end,
    'flat',
    0,
    'default',
    0,
    true,
    0,
    'webstore',
    v_ord.store_id
  );

  -- ── so_items + so_item_decorations ── one SO line per distinct
  -- (product, color, decoration set); sizes map merged across order lines —
  -- batchOrders' byProduct aggregation. unit_sell = collected ÷ units (garment
  -- sell + per-unit deco sell), deco sells suppressed below, so
  -- SUM(unit_sell × qty) reconciles to the order's goods+deco subtotal.
  for v_grp in
    select g.*,
           (select jsonb_object_agg(s.sz, s.q) from (
              select coalesce(nullif(i2.size, ''), 'OS') as sz,
                     sum(coalesce(i2.qty, 1))::int as q
                from webstore_order_items i2
               where i2.order_id = v_ord.id
                 and coalesce(i2.is_bundle_parent, false) = false
                 and coalesce(i2.product_id, '') = g.k_pid
                 and coalesce(i2.color, '')      = g.k_color
                 and coalesce(i2.decorations, '[]'::jsonb) = g.decorations
               group by 1) s) as sizes
      from (
        select coalesce(i.product_id, '') as k_pid,
               coalesce(i.color, '')      as k_color,
               coalesce(i.decorations, '[]'::jsonb) as decorations,
               min(i.product_id) as product_id,
               min(i.sku)        as sku,
               min(i.name)       as iname,
               min(i.color)      as color,
               sum(coalesce(i.qty, 1))::int as units,
               round(sum((coalesce(i.unit_price, 0) + coalesce(i.unit_deco_price, 0))
                         * coalesce(i.qty, 1))::numeric, 2) as collected
          from webstore_order_items i
         where i.order_id = v_ord.id
           and coalesce(i.is_bundle_parent, false) = false
         group by 1, 2, 3) g
     order by g.sku nulls last, g.k_pid, g.decorations::text
  loop
    -- Product master info — batchOrders' pinfo lookup (name/brand/nsa_cost;
    -- color from the order line first, product master as fallback).
    select p.sku, p.name, p.brand, p.color, p.nsa_cost
      into v_p
      from products p where p.id = v_grp.product_id;

    v_unit_sell := round(v_grp.collected / greatest(v_grp.units, 1), 2);
    v_no_deco   := (jsonb_array_length(v_grp.decorations) = 0);

    insert into so_items (
      so_id, item_index, product_id, sku, name, brand, color,
      nsa_cost, retail_price, unit_sell, sizes, available_sizes, no_deco
    ) values (
      v_so_id,
      v_idx,
      v_grp.product_id,
      coalesce(v_grp.sku, v_p.sku, ''),
      coalesce(v_p.name, v_grp.iname, coalesce(v_grp.sku, 'Item')),
      coalesce(v_p.brand, ''),
      coalesce(v_grp.color, v_p.color, ''),
      coalesce(v_p.nsa_cost, 0),
      v_unit_sell,
      v_unit_sell,
      coalesce(v_grp.sizes, '{}'::jsonb),
      (select coalesce(jsonb_agg(k), '[]'::jsonb)
         from jsonb_object_keys(coalesce(v_grp.sizes, '{}'::jsonb)) k),
      v_no_deco
    ) returning id into v_item_id;

    -- Decorations — decoSpec entries (validated at quote time by cleanDeco +
    -- decoMeta; see quickorder-quote.js). Mapping mirrors batchOrders' art-deco
    -- write plus the dP pricing fields, since there is no art file to carry them.
    v_di := 0;
    for v_deco in select * from jsonb_array_elements(v_grp.decorations)
    loop
      -- Builder placement → canonical SO position (batchOrders' POS_LABEL/posOf).
      v_position := case v_deco->>'placement'
                      when 'left_chest'   then 'Left Chest'
                      when 'full_front'   then 'Front'
                      when 'full_back'    then 'Back'
                      when 'left_sleeve'  then 'Left Sleeve'
                      when 'right_sleeve' then 'Right Sleeve'
                      else case when v_deco->>'side' = 'back' then 'Back' else 'Front' end
                    end;
      -- Logo identity — the same normalization the v2 quote hash uses
      -- (teamshop:<id> | art:<id>), with the raw art_url as a last resort.
      v_logo_ref := case
                      when v_deco ? 'teamshop_logo_id' then 'teamshop:' || (v_deco->>'teamshop_logo_id')
                      when v_deco ? 'art_file_id'      then 'art:'      || (v_deco->>'art_file_id')
                      else 'url:' || coalesce(v_deco->>'art_url', '')
                    end;

      -- Cost of record (00198 rate card): matched by (type, option_key) on
      -- active rows — the same lookup _teamshopRates.rateFor makes (option
      -- defaults 'standard'). NULL rate/cost → 0 (00196's value); a missing
      -- rate must never block conversion.
      select r.cost into v_deco_cost
        from teamshop_deco_rates r
       where r.type = v_deco->>'type'
         and r.option_key = coalesce(nullif(v_deco->>'option', ''), 'standard')
         and r.active;

      insert into so_item_decorations (
        so_item_id, deco_index, kind, position, type,
        colors, underbase, stitches, dtf_size,
        sell_override, sell_each, cost_each,
        web_url, placement, side, color_label
      ) values (
        v_item_id,
        v_di,
        'art',
        v_position,
        v_deco->>'type',
        case when v_deco->>'type' = 'screen_print' then coalesce((v_deco->>'colors')::int, 1) end,
        case when v_deco->>'type' = 'screen_print' then coalesce((v_deco->>'underbase')::boolean, false) else false end,
        case when v_deco->>'type' = 'embroidery'   then (v_deco->>'stitches')::int end,
        case when v_deco->>'type' = 'dtf'          then coalesce((v_deco->>'dtf_size')::int, 0) end,
        0, 0, coalesce(v_deco_cost, 0),
        nullif(v_deco->>'art_url', ''),
        nullif(v_deco->>'placement', ''),
        coalesce(nullif(v_deco->>'side', ''), 'front'),
        'original'
      );

      insert into _ts_job_decos (
        item_idx, deco_idx, sku, iname, color, units,
        deco_type, logo_ref, logo_name, position, digitizing
      ) values (
        v_idx,
        v_di,
        coalesce(v_grp.sku, v_p.sku, '—'),
        coalesce(v_p.name, v_grp.iname, 'Unknown'),
        coalesce(v_grp.color, v_p.color, ''),
        v_grp.units,
        v_deco->>'type',
        v_logo_ref,
        case when v_deco ? 'teamshop_logo_id'
             then (select tl.name from teamshop_logos tl
                    where tl.id::text = (v_deco->>'teamshop_logo_id'))
             end,
        v_position,
        (coalesce(v_deco->>'logo_source', '') = 'teamshop'
         and v_deco->>'type' = 'embroidery')
      );
      v_di := v_di + 1;
    end loop;

    v_total_units := v_total_units + v_grp.units;
    v_idx := v_idx + 1;
  end loop;

  -- Append the unit count to the production notes now that it's known
  -- (mirrors batchOrders' "N units" note line).
  update sales_orders
     set production_notes = production_notes || e'\n' || v_total_units || ' units'
   where id = v_so_id;

  -- ── so_jobs ── one job per distinct (logo ref × deco method), born
  -- prod_status 'hold' / art_status 'needs_art' / item_status 'need_to_order'
  -- (buildJobs/syncJobs entry states for art-less decos) — UNLESS auto-art
  -- resolves the logo to a production-ready customer art-library entry, in which
  -- case it is born art_complete (see this migration's header).
  for v_job in
    select d.deco_type,
           d.logo_ref,
           max(d.logo_name) as logo_name,
           bool_or(d.digitizing) as digitizing,
           string_agg(distinct d.position, ', ' order by d.position) as positions,
           -- syncJobs' signature for a null-art_file_id deco: dt::unassigned@<pos>
           -- sorted + '|'-joined — so the client's key matcher preserves the job.
           string_agg(distinct 'unassigned@' || d.position, '|' order by 'unassigned@' || d.position) as key_parts,
           min(d.position) as first_pos
      from _ts_job_decos d
     group by d.deco_type, d.logo_ref
     order by d.deco_type, d.logo_ref
  loop
    v_jn := v_jn + 1;
    v_job_id  := 'JOB-' || v_num || '-' || lpad(v_jn::text, 2, '0');
    v_job_key := v_job.deco_type || '::' || v_job.key_parts;
    -- 'Unassigned Art (<pos>)' is syncJobs' name for an art-less deco; prefer
    -- the coach's logo name when we can resolve it.
    v_job_name := coalesce(v_job.logo_name, 'Unassigned Art (' || v_job.first_pos || ')');
    v_positions := v_job.positions;

    -- ── Auto-art decision (00207) ── only an 'art:<id>' logo_ref carries a
    -- customer art-library id; look it up in v_cust.art_files and fire only when
    -- the entry is approved AND has production files (isJobReady's art half).
    v_art_id    := case when v_job.logo_ref like 'art:%' then substring(v_job.logo_ref from 5) else null end;
    v_art_entry := null;
    if v_art_id is not null then
      select je.value into v_art_entry
        from jsonb_array_elements(coalesce(v_cust.art_files, '[]'::jsonb)) je
       where je.value->>'id' = v_art_id
       limit 1;
    end if;
    v_auto_art := v_art_entry is not null
      and coalesce(v_art_entry->>'status', '') = 'approved'
      and (
        (v_art_entry->>'prod_files_attached')::boolean is true
        or jsonb_array_length(coalesce(v_art_entry->'prod_files', '[]'::jsonb)) > 0
        or (
          coalesce(v_art_entry->>'deco_type', '') = 'embroidery'
          and exists (
            select 1
              from jsonb_array_elements(
                     coalesce(v_art_entry->'files', '[]'::jsonb)
                     || coalesce(v_art_entry->'prod_files', '[]'::jsonb)) f
             where lower(coalesce(
                     case when jsonb_typeof(f) = 'string' then f #>> '{}'
                          else coalesce(f->>'name', f->>'url') end, '')) like '%.dst'
          )
        )
      );

    -- buildJobs' per-item entry shape: {item_idx, deco_idx, deco_idxs, sku,
    -- name, color, units, fulfilled}.
    select jsonb_agg(jsonb_build_object(
             'item_idx',  t.item_idx,
             'deco_idx',  t.d0,
             'deco_idxs', t.dis,
             'sku',       t.sku,
             'name',      t.iname,
             'color',     t.color,
             'units',     t.units,
             'fulfilled', 0
           ) order by t.item_idx),
           coalesce(sum(t.units), 0)
      into v_job_items, v_job_units
      from (
        select d.item_idx,
               min(d.deco_idx) as d0,
               jsonb_agg(d.deco_idx order by d.deco_idx) as dis,
               min(d.sku)   as sku,
               min(d.iname) as iname,
               min(d.color) as color,
               min(d.units) as units
          from _ts_job_decos d
         where d.deco_type = v_job.deco_type and d.logo_ref = v_job.logo_ref
         group by d.item_idx) t;

    insert into so_jobs (
      so_id, id, key, art_file_id, _art_ids, art_name, deco_type, positions,
      art_status, item_status, prod_status, total_units, fulfilled_units,
      split_from, created_at, ship_method, items, _auto, digitizing_needed
    ) values (
      v_so_id,
      v_job_id,
      v_job_key,
      case when v_auto_art then v_art_id else null end,
      case when v_auto_art then jsonb_build_array(v_art_id) else '[]'::jsonb end,
      case when v_auto_art then coalesce(v_art_entry->>'name', v_job_name) else v_job_name end,
      v_job.deco_type,
      v_positions,
      case when v_auto_art then 'art_complete' else 'needs_art' end,
      'need_to_order',
      'hold',
      v_job_units,
      0,
      null,
      v_today_txt,
      'ship_customer',
      coalesce(v_job_items, '[]'::jsonb),
      true,
      case when v_auto_art then false else v_job.digitizing end
    );

    -- 00192 event log, same transaction.
    insert into job_stage_events (so_id, job_id, event, from_state, to_state, actor, source, payload)
    values (
      v_so_id, v_job_id, 'created',
      null,
      jsonb_build_object('prod_status', 'hold',
                         'art_status', case when v_auto_art then 'art_complete' else 'needs_art' end),
      null,
      'teamshop',
      jsonb_build_object(
        'webstore_order_id', v_ord.id,
        'logo_ref', v_job.logo_ref,
        'digitizing_needed', case when v_auto_art then false else v_job.digitizing end,
        'auto_art', v_auto_art,
        'art_file_id', case when v_auto_art then v_art_id else null end)
    );
  end loop;

  -- ── Link the order ── same write batchOrders makes after onCreateSO.
  update webstore_orders
     set so_id = v_so_id, status = 'batched'
   where id = v_ord.id;

  -- ── Invoice ── the money-of-record row commissions and A/R read; mirrors
  -- App.js createAndSettleWebstoreInvoice. Guarded by the same any-invoice
  -- check the client makes (App.js:12240) so this can never double-invoice.
  if not exists (select 1 from invoices where so_id = v_so_id) then
    -- INV id mint — the exact client rule (App.js nextInvId, line 165), same
    -- advisory-lock technique as the SO mint above.
    perform pg_advisory_xact_lock(hashtext('nsa_invoices_id_mint'));
    select greatest(coalesce(max((regexp_match(id, '(\d+)'))[1]::bigint), 0), 1000) + 1
      into v_inv_num
      from invoices;
    v_inv_id := 'INV-' || v_inv_num;

    -- Line items from the SO lines just written — the batch path's shape:
    -- {desc, qty, rate, amount, _sku, _name, _color}; total = Σ amount.
    select coalesce(jsonb_agg(jsonb_build_object(
             'desc',   li.descr,
             'qty',    li.qty,
             'rate',   li.rate,
             'amount', li.amount,
             '_sku',   li.sku,
             '_name',  li.name,
             '_color', li.color
           ) order by li.item_index), '[]'::jsonb),
           coalesce(round(sum(li.amount)::numeric, 2), 0)
      into v_line_items, v_inv_total
      from (
        select it.item_index, it.sku, it.name, it.color,
               it.sku || ' ' || it.name
                 || case when coalesce(it.color, '') <> '' then ' — ' || it.color else '' end as descr,
               q.qty,
               it.unit_sell as rate,
               round((q.qty * it.unit_sell)::numeric, 2) as amount
          from so_items it
          cross join lateral (
            select coalesce(sum(v.value::numeric), 0)::int as qty
              from jsonb_each_text(coalesce(it.sizes, '{}'::jsonb)) v
          ) q
         where it.so_id = v_so_id
           and q.qty > 0
      ) li;

    -- Customer terms — the client rule (App.js:12256):
    -- parseInt((payment_terms||'net30').replace(/\D/g,'')) || 30.
    v_term_days := nullif(regexp_replace(coalesce(v_cust.payment_terms, ''), '\D', '', 'g'), '')::int;
    if v_term_days is null or v_term_days = 0 then
      v_term_days := 30;
    end if;
    v_date_txt := to_char(now(), 'YYYY-MM-DD');
    v_due_txt  := to_char(now() + make_interval(days => v_term_days), 'YYYY-MM-DD');

    -- Settlement branch. Card ('paid'): the batch clamp — apply the smaller of
    -- the invoice total and what the store order actually collected, so a data
    -- surprise can only under-apply (visible partial), never overpay.
    -- PO ('po_verified'): born open, nothing applied.
    if v_is_po then
      v_applied := 0;
    else
      v_applied := round(least(v_inv_total, greatest(coalesce(v_ord.total, 0), 0))::numeric, 2);
    end if;
    v_inv_status := case when v_applied >= v_inv_total - 0.005 then 'paid'
                         when v_applied > 0 then 'partial'
                         else 'open' end;

    insert into invoices (
      id, customer_id, so_id, type, inv_type, date, due_date,
      total, paid, status, memo, tax, tax_rate, tax_exempt, shipping,
      line_items, created_at, updated_at
    ) values (
      v_inv_id,
      v_ord.customer_id,
      v_so_id,
      'invoice',
      'full',
      v_date_txt,
      v_due_txt,
      v_inv_total,
      v_applied,
      v_inv_status,
      'Invoice — ' || v_memo,
      0,
      0,
      true,
      0,
      v_line_items,
      now(),
      now()
    );

    -- invoice_items — exactly the rows dbEngine persists from the client's
    -- items array (sku/name/qty; unit_price is undefined there → NULL here).
    insert into invoice_items (invoice_id, sku, name, qty)
    select v_inv_id, it.sku, it.name,
           (select coalesce(sum(v.value::numeric), 0)::int
              from jsonb_each_text(coalesce(it.sizes, '{}'::jsonb)) v)
      from so_items it
     where it.so_id = v_so_id
     order by it.item_index;

    -- Settlement payment row — the batch path's shape ({method:'store',
    -- ref:'TEAMSHOP <order number|id>', date MM/DD/YYYY}); ref is stable so a
    -- retry/idempotent path can recognize it, like 'WEB <so id>' on batches.
    if v_applied > 0 then
      v_pay_ref := 'TEAMSHOP ' || coalesce(v_ord.order_number::text, v_ord.id::text);
      insert into invoice_payments (invoice_id, amount, method, ref, date)
      values (v_inv_id, v_applied, 'store', v_pay_ref, to_char(now(), 'MM/DD/YYYY'));
    end if;
  end if;

  return jsonb_build_object(
    'so_id', v_so_id, 'replayed', false,
    'items', v_idx, 'jobs', v_jn, 'units', v_total_units,
    'invoice_id', v_inv_id, 'no_rep', v_no_rep);
end $$;

revoke all on function public.create_teamshop_sales_order(uuid) from public;
revoke all on function public.create_teamshop_sales_order(uuid) from anon;
revoke all on function public.create_teamshop_sales_order(uuid) from authenticated;
grant execute on function public.create_teamshop_sales_order(uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2) create_club_sales_order — 00204 body + the SAME auto-art at job birth.
--    ('xfer:<code>' transfer designs and numbers/names never carry an art-library
--    id, so only 'art:<art_id>' logo jobs can auto-art — identical rule/predicate.)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.create_club_sales_order(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord         webstore_orders;
  v_store       webstores;
  v_cust        customers;
  v_num         bigint;
  v_so_id       text;
  v_memo        text;
  v_now_txt     text;
  v_today_txt   text;
  v_garment_gross numeric;
  v_disc        numeric;
  v_disc_ratio  numeric;
  v_fundraise_cost numeric;
  v_grp         record;
  v_p           record;
  v_wp          record;
  v_deco        jsonb;
  v_art         record;
  v_bi_num      boolean;
  v_bi_name     boolean;
  v_takes_num   boolean;
  v_takes_name  boolean;
  v_xfer_codes  text[];
  v_xfer_code   text;
  v_transfer    record;
  v_has_num     boolean;
  v_has_name    boolean;
  v_deco_count  int;
  v_item_id     int;
  v_idx         int := 0;
  v_di          int;
  v_unit_sell   numeric;
  v_no_deco     boolean;
  v_position    text;
  v_logo_ref    text;
  v_logo_name   text;
  v_deco_type   text;
  v_stitches    int;
  v_total_units int := 0;
  v_job         record;
  v_jn          int := 0;
  v_job_id      text;
  v_job_key     text;
  v_job_items   jsonb;
  v_job_units   int;
  v_job_name    text;
  v_positions   text;
  v_no_rep      boolean := false;
  v_inv_num     bigint;
  v_inv_id      text;
  v_inv_total   numeric;
  v_applied     numeric;
  v_inv_status  text;
  v_term_days   int;
  v_date_txt    text;
  v_due_txt     text;
  v_line_items  jsonb;
  v_pay_ref     text;
  -- ── Auto-art (00207) ──
  v_auto_art    boolean;
  v_art_id      text;
  v_art_entry   jsonb;
begin
  -- Serialize concurrent conversions of this order (checkout finalize + webhook may
  -- race): the loser waits here, then sees so_id set and replays.
  select * into v_ord from webstore_orders where id = p_order_id for update;
  if not found then
    raise exception 'NSA_NOT_FOUND:webstore order';
  end if;

  if v_ord.so_id is not null then
    return jsonb_build_object('so_id', v_ord.so_id, 'replayed', true);
  end if;

  select * into v_store from webstores where id = v_ord.store_id;
  if not found then
    raise exception 'NSA_NOT_FOUND:webstore';
  end if;
  if coalesce(v_store.org_type, '') <> 'club' then
    raise exception 'NSA_BAD_SOURCE:%', coalesce(v_store.org_type, 'team');
  end if;
  -- 'paid' is the exact value webstore-checkout finalize and stripe-webhook write on
  -- the paid signal. Club stores have no PO-verified equivalent — anything else
  -- (pending_payment, unpaid, cancelled, refunded, …) must not reach production.
  if coalesce(v_ord.status, '') <> 'paid' then
    raise exception 'NSA_NOT_PAID:%', coalesce(v_ord.status, '(null)');
  end if;
  if v_store.customer_id is null then
    raise exception 'NSA_BAD_INPUT:store has no customer_id';
  end if;
  if not exists (select 1 from webstore_order_items i
                 where i.order_id = v_ord.id
                   and coalesce(i.is_bundle_parent, false) = false) then
    raise exception 'NSA_BAD_INPUT:order has no items';
  end if;

  -- Rep guard (never blocks conversion) — same posture as 00199.
  select * into v_cust from customers where id = v_store.customer_id;
  if not found or v_cust.primary_rep_id is null then
    v_no_rep := true;
    raise notice 'CLUB_NO_REP:%', v_store.customer_id;
  end if;

  -- ── SO id mint — identical technique to 00199 (advisory lock + first-digit-run max).
  perform pg_advisory_xact_lock(hashtext('nsa_sales_orders_id_mint'));
  select greatest(coalesce(max((regexp_match(id, '(\d+)'))[1]::bigint), 0), 1000) + 1
    into v_num
    from sales_orders;
  v_so_id := 'SO-' || v_num;

  v_now_txt   := to_char(now(), 'FMMM/FMDD/YYYY, FMHH12:MI:SS AM');
  v_today_txt := to_char(now(), 'FMMM/FMDD/YYYY');

  -- This order's own discount ratio (batchOrders' discRatio degenerated from "a batch
  -- of orders" to "one order"): garmentGross = subtotal+fundraise collected on the
  -- garments; totalDiscount clamped so it can never exceed garmentGross.
  v_garment_gross := coalesce(v_ord.subtotal, 0) + coalesce(v_ord.fundraise_amt, 0);
  v_disc := least(coalesce(v_ord.discount_amt, 0), greatest(v_garment_gross, 0));
  v_disc_ratio := case when v_garment_gross > 0
                        then greatest(0, (v_garment_gross - v_disc) / v_garment_gross)
                        else 1 end;
  v_fundraise_cost := round((coalesce(v_ord.fundraise_amt, 0) * v_disc_ratio)::numeric, 2);

  v_memo := coalesce(v_store.name, 'Club Store') || ' — order #'
      || coalesce(v_ord.order_number::text, left(v_ord.id::text, 8))
      || case when coalesce(v_ord.buyer_name, '') <> '' then ' — ' || v_ord.buyer_name else '' end;

  -- ── sales_orders ── column set = webstoreCreateSO's newSO ∩ real columns, same as
  -- 00199. webstore_batch_no is assigned by the 00177 trigger (webstore_id not null).
  insert into sales_orders (
    id, customer_id, memo, status, created_at, updated_at,
    expected_date, production_notes, shipping_type, shipping_value,
    ship_to_id, tax_rate, tax_exempt, _webstore_fundraise, source, webstore_id
  ) values (
    v_so_id,
    v_store.customer_id,
    v_memo,
    'need_order',
    v_now_txt,
    v_now_txt,
    '',
    'Club store: ' || coalesce(v_store.name, 'Club Store')
      || e'\nOrder #' || coalesce(v_ord.order_number::text, left(v_ord.id::text, 8))
      || ' · ' || coalesce(v_ord.buyer_name, '')
      || case when coalesce(v_ord.buyer_email, '') <> '' then ' (' || v_ord.buyer_email || ')' else '' end
      || e'\ndelivery: ' || case when v_store.delivery_mode = 'deliver_club' then 'deliver to club' else 'ship to home' end
      || e'\nPaid by card (Stripe): $' || to_char(coalesce(v_ord.total, 0), 'FM999999990.00')
      || ' — sales tax collected on the store order.',
    'flat',
    0,
    'default',
    0,
    true,
    v_fundraise_cost,
    'webstore',
    v_ord.store_id
  );

  -- ── Bundle allocation scratch — the package price sits on the bundle PARENT row
  -- (unit_price+unit_fundraise); components are stored at $0. batchOrders allocates
  -- the parent's collected value across its components weighted by each component's
  -- master retail_price (a jersey absorbs more than socks), equal-split when weights
  -- are unknown.
  drop table if exists _club_bundle_parent;
  create temporary table _club_bundle_parent (bpid uuid, parent_val numeric) on commit drop;
  insert into _club_bundle_parent
  select i.bundle_product_id,
         round(sum((coalesce(i.unit_price, 0) + coalesce(i.unit_fundraise, 0)) * coalesce(i.qty, 1))::numeric, 2)
    from webstore_order_items i
   where i.order_id = v_ord.id and coalesce(i.is_bundle_parent, false) = true and i.bundle_product_id is not null
   group by i.bundle_product_id;

  drop table if exists _club_bundle_weight;
  create temporary table _club_bundle_weight (bpid uuid, wsum numeric, n int) on commit drop;
  insert into _club_bundle_weight
  select i.bundle_product_id, coalesce(sum(coalesce(p.retail_price, 0)), 0), count(*)
    from webstore_order_items i
    left join products p on p.id = i.product_id
   where i.order_id = v_ord.id and coalesce(i.is_bundle_parent, false) = false and i.bundle_product_id is not null
   group by i.bundle_product_id;

  -- ── Per-line scratch (non-parent lines only) with bundle-allocated collected $.
  drop table if exists _club_lines;
  create temporary table _club_lines (
    item_id uuid, product_id text, sku text, size text, qty int,
    player_name text, player_number text, collected numeric
  ) on commit drop;
  insert into _club_lines
  select i.id, i.product_id, i.sku, i.size, coalesce(i.qty, 1), i.player_name, i.player_number,
    case
      when i.bundle_product_id is not null then
        coalesce(
          case when bw.wsum > 0
               then round((bp.parent_val * coalesce(p.retail_price, 0) / bw.wsum)::numeric, 2)
               else round((bp.parent_val / greatest(coalesce(bw.n, 1), 1))::numeric, 2)
          end, 0)
      else round(((coalesce(i.unit_price, 0) + coalesce(i.unit_fundraise, 0)) * coalesce(i.qty, 1))::numeric, 2)
    end
    from webstore_order_items i
    left join products p on p.id = i.product_id
    left join _club_bundle_parent bp on bp.bpid = i.bundle_product_id
    left join _club_bundle_weight bw on bw.bpid = i.bundle_product_id
   where i.order_id = v_ord.id and coalesce(i.is_bundle_parent, false) = false;

  -- Per-deco job grouping scratch (dropped at end; recreated per call) — same shape
  -- and purpose as 00199's _ts_job_decos.
  drop table if exists _ts_job_decos;
  create temporary table _ts_job_decos (
    item_idx  int,
    deco_idx  int,
    sku       text,
    iname     text,
    color     text,
    units     int,
    deco_type text,
    logo_ref  text,
    logo_name text,
    position  text,
    digitizing boolean
  ) on commit drop;

  -- ── so_items + so_item_decorations ── one SO line per distinct (product_id, sku);
  -- sizes + numbers/names rosters merged across order lines (batchOrders' byProduct
  -- aggregation, adapted to one order). unit_sell = collected ÷ units, scaled by this
  -- order's discount ratio.
  for v_grp in
    select g.*,
      (select jsonb_object_agg(s.sz, s.q) from (
         select coalesce(nullif(l2.size, ''), 'OS') as sz, sum(l2.qty)::int as q
           from _club_lines l2
          where coalesce(l2.product_id, '') = g.k_pid and coalesce(l2.sku, '') = g.k_sku
          group by 1) s) as sizes,
      (select jsonb_object_agg(s.sz, s.arr) from (
         select coalesce(nullif(l3.size, ''), 'OS') as sz,
                jsonb_agg(coalesce(l3.player_number, '') order by l3.item_id, gs.n) as arr
           from _club_lines l3
           cross join lateral generate_series(1, greatest(l3.qty, 1)) as gs(n)
          where coalesce(l3.product_id, '') = g.k_pid and coalesce(l3.sku, '') = g.k_sku
          group by 1) s) as numbers_roster,
      (select jsonb_object_agg(s.sz, s.arr) from (
         select coalesce(nullif(l4.size, ''), 'OS') as sz,
                jsonb_agg(coalesce(l4.player_name, '') order by l4.item_id, gs.n) as arr
           from _club_lines l4
           cross join lateral generate_series(1, greatest(l4.qty, 1)) as gs(n)
          where coalesce(l4.product_id, '') = g.k_pid and coalesce(l4.sku, '') = g.k_sku
          group by 1) s) as names_roster
      from (
        select coalesce(l.product_id, '') as k_pid, coalesce(l.sku, '') as k_sku,
               min(l.product_id) as product_id, min(l.sku) as sku,
               sum(l.qty)::int as units, round(sum(l.collected)::numeric, 2) as collected
          from _club_lines l
         group by 1, 2
      ) g
     order by g.sku nulls last, g.k_pid
  loop
    -- Product master info — GARMENT COST PARITY: clearance-aware, the costByPid rule
    -- (Webstores.js:1184-1195): is_clearance + clearance_cost set -> clearance_cost,
    -- else nsa_cost.
    select p.sku, p.name, p.brand, p.color,
           case when p.is_clearance and p.clearance_cost is not null then p.clearance_cost else p.nsa_cost end as cost_basis
      into v_p
      from products p where p.id = v_grp.product_id;

    -- Store catalog row for this product (logo placements + personalization + transfer
    -- codes) — one webstore_products row per product_id per store by construction
    -- (color variants are separate product_ids).
    select * into v_wp from webstore_products
     where store_id = v_ord.store_id and product_id = v_grp.product_id
     order by id limit 1;

    -- Bundle-component personalization/transfer config (webstore_bundle_items) unions
    -- with the catalog row's — batchOrders' personalize map ORs both sources.
    select bool_or(coalesce(takes_number, false)), bool_or(coalesce(takes_name, false))
      into v_bi_num, v_bi_name
      from webstore_bundle_items where product_id = v_grp.product_id;
    v_takes_num  := coalesce(v_wp.takes_number, false) or coalesce(v_bi_num, false);
    v_takes_name := coalesce(v_wp.takes_name, false) or coalesce(v_bi_name, false);

    select array_agg(distinct code) into v_xfer_codes
      from (
        select unnest(coalesce(v_wp.transfer_codes, '{}'::text[])) as code
        union all
        select transfer_code from webstore_bundle_items
         where product_id = v_grp.product_id and coalesce(transfer_code, '') <> ''
      ) t
     where coalesce(code, '') <> '';

    v_has_num  := v_takes_num and exists (
      select 1 from jsonb_each(coalesce(v_grp.numbers_roster, '{}'::jsonb)) kv,
           jsonb_array_elements_text(kv.value) e where trim(e) <> '');
    v_has_name := v_takes_name and exists (
      select 1 from jsonb_each(coalesce(v_grp.names_roster, '{}'::jsonb)) kv,
           jsonb_array_elements_text(kv.value) e where trim(e) <> '');

    v_deco_count := jsonb_array_length(coalesce(v_wp.decorations, '[]'::jsonb))
      + coalesce(array_length(v_xfer_codes, 1), 0)
      + (case when v_has_num then 1 else 0 end)
      + (case when v_has_name then 1 else 0 end);
    v_no_deco := (v_deco_count = 0);

    v_unit_sell := round((v_grp.collected / greatest(v_grp.units, 1) * v_disc_ratio)::numeric, 2);

    insert into so_items (
      so_id, item_index, product_id, sku, name, brand, color,
      nsa_cost, retail_price, unit_sell, sizes, available_sizes, no_deco
    ) values (
      v_so_id,
      v_idx,
      v_grp.product_id,
      coalesce(v_grp.sku, v_p.sku, ''),
      coalesce(v_p.name, coalesce(v_grp.sku, 'Item')),
      coalesce(v_p.brand, ''),
      coalesce(v_p.color, ''),
      coalesce(v_p.cost_basis, 0),
      v_unit_sell,
      v_unit_sell,
      coalesce(v_grp.sizes, '{}'::jsonb),
      (select coalesce(jsonb_agg(k), '[]'::jsonb)
         from jsonb_object_keys(coalesce(v_grp.sizes, '{}'::jsonb)) k),
      v_no_deco
    ) returning id into v_item_id;

    v_di := 0;

    -- Logo placements (webstore_products.decorations — the store builder's placed
    -- logos). art_file_id stays NULL (00199's precedent — no so_art_files record is
    -- created server-side). type/stitches resolved from the store's OWN
    -- customer.art_files by art_id when possible; defaults screen_print/no-stitches
    -- otherwise (see migration header — full art-library resolution is not
    -- replicated; production routing only, never money — these decos are sell 0 /
    -- cost 0 same as batchOrders).
    for v_deco in select * from jsonb_array_elements(coalesce(v_wp.decorations, '[]'::jsonb))
    loop
      v_position := case v_deco->>'placement'
                      when 'left_chest'   then 'Left Chest'
                      when 'full_front'   then 'Front'
                      when 'full_back'    then 'Back'
                      when 'left_sleeve'  then 'Left Sleeve'
                      when 'right_sleeve' then 'Right Sleeve'
                      else case when v_deco->>'side' = 'back' then 'Back' else 'Front' end
                    end;
      select af->>'deco_type' as deco_type, nullif(af->>'stitches', '')::int as stitches, af->>'name' as art_name
        into v_art
        from jsonb_array_elements(coalesce(v_cust.art_files, '[]'::jsonb)) af
       where af->>'id' = (v_deco->>'art_id')
       limit 1;
      v_deco_type := coalesce(nullif(v_art.deco_type, ''), 'screen_print');
      v_stitches  := case when v_deco_type = 'embroidery' then v_art.stitches end;
      v_logo_ref  := case when v_deco ? 'art_id' then 'art:' || (v_deco->>'art_id')
                          else 'url:' || coalesce(v_deco->>'art_url', '') end;
      v_logo_name := v_art.art_name;

      insert into so_item_decorations (
        so_item_id, deco_index, kind, position, type,
        colors, underbase, stitches, dtf_size,
        sell_override, sell_each, cost_each,
        web_url, placement, side, color_label
      ) values (
        v_item_id, v_di, 'art', v_position, v_deco_type,
        case when v_deco_type = 'screen_print' then 1 end,
        false,
        v_stitches,
        case when v_deco_type in ('dtf', 'heat_press') then 0 end,
        0, 0, 0,
        nullif(v_deco->>'art_url', ''),
        nullif(v_deco->>'placement', ''),
        coalesce(nullif(v_deco->>'side', ''), 'front'),
        coalesce(nullif(v_deco->>'color_label', ''), 'original')
      );

      insert into _ts_job_decos (item_idx, deco_idx, sku, iname, color, units, deco_type, logo_ref, logo_name, position, digitizing)
      values (v_idx, v_di, coalesce(v_grp.sku, v_p.sku, '—'), coalesce(v_p.name, v_grp.sku, 'Unknown'),
              coalesce(v_p.color, ''), v_grp.units, v_deco_type, v_logo_ref, v_logo_name, v_position, false);
      v_di := v_di + 1;
    end loop;

    -- Transfer-code decorations (heat-transfer designs). COST PARITY: cost_each comes
    -- from webstore_transfers.unit_cost (coalesced to 0 — a missing cost never blocks
    -- conversion), the exact shape decoPricing.dP's "Team Shop conversion decos"
    -- branch (kind 'art' + no art_file_id + cost_each not null) consumes.
    if v_xfer_codes is not null then
      foreach v_xfer_code in array v_xfer_codes loop
        select * into v_transfer from webstore_transfers
         where store_id = v_ord.store_id and code = v_xfer_code limit 1;

        insert into so_item_decorations (
          so_item_id, deco_index, kind, position, type,
          sell_override, sell_each, cost_each,
          placement, side, color_label, transfer_code
        ) values (
          v_item_id, v_di, 'art', 'Front', 'heat_press',
          0, 0, coalesce(v_transfer.unit_cost, 0),
          'full_front', 'front', 'original', v_xfer_code
        );

        insert into _ts_job_decos (item_idx, deco_idx, sku, iname, color, units, deco_type, logo_ref, logo_name, position, digitizing)
        values (v_idx, v_di, coalesce(v_grp.sku, v_p.sku, '—'), coalesce(v_p.name, v_grp.sku, 'Unknown'),
                coalesce(v_p.color, ''), v_grp.units, 'heat_press', 'xfer:' || v_xfer_code,
                coalesce(v_transfer.label, v_xfer_code), 'Front', false);
        v_di := v_di + 1;
      end loop;
    end if;

    -- Numbers/names personalization. sell_override = 0 (NOT null) — see migration
    -- header: this deterministically suppresses double-counted revenue on every future
    -- read, unlike batchOrders' client-only sell_suppressed flag which doesn't survive
    -- the DB round-trip. Cost stays real (dP's numbers/names branches always compute a
    -- real production cost regardless of sell_override). No job row — art-kind decos
    -- only build so_jobs (00199's precedent).
    if v_has_num then
      insert into so_item_decorations (
        so_item_id, deco_index, kind, position, num_method, num_size, two_color,
        sell_override, sell_each, roster
      ) values (
        v_item_id, v_di, 'numbers', 'Back', 'screen_print', '6"', false,
        0, 0, v_grp.numbers_roster
      );
      v_di := v_di + 1;
    end if;
    if v_has_name then
      insert into so_item_decorations (
        so_item_id, deco_index, kind, position,
        sell_override, sell_each, cost_each, names
      ) values (
        v_item_id, v_di, 'names', 'Back Center',
        0, 6, 3, v_grp.names_roster
      );
      v_di := v_di + 1;
    end if;

    v_total_units := v_total_units + v_grp.units;
    v_idx := v_idx + 1;
  end loop;

  update sales_orders
     set production_notes = production_notes || e'\n' || v_total_units || ' units'
   where id = v_so_id;

  -- ── so_jobs ── one job per distinct (deco_type, logo_ref) among ART-kind decos
  -- (logo placements + transfer designs) — identical shape/keying to 00199. Auto-art
  -- (00207) fires only on 'art:<art_id>' logo jobs whose customer art-library entry
  -- is production-ready (transfer 'xfer:' jobs never carry an art-library id).
  for v_job in
    select d.deco_type, d.logo_ref, max(d.logo_name) as logo_name, bool_or(d.digitizing) as digitizing,
           string_agg(distinct d.position, ', ' order by d.position) as positions,
           string_agg(distinct 'unassigned@' || d.position, '|' order by 'unassigned@' || d.position) as key_parts,
           min(d.position) as first_pos
      from _ts_job_decos d
     group by d.deco_type, d.logo_ref
     order by d.deco_type, d.logo_ref
  loop
    v_jn := v_jn + 1;
    v_job_id  := 'JOB-' || v_num || '-' || lpad(v_jn::text, 2, '0');
    v_job_key := v_job.deco_type || '::' || v_job.key_parts;
    v_job_name := coalesce(v_job.logo_name, 'Unassigned Art (' || v_job.first_pos || ')');
    v_positions := v_job.positions;

    -- ── Auto-art decision (00207) ── same predicate as create_teamshop_sales_order.
    v_art_id    := case when v_job.logo_ref like 'art:%' then substring(v_job.logo_ref from 5) else null end;
    v_art_entry := null;
    if v_art_id is not null then
      select je.value into v_art_entry
        from jsonb_array_elements(coalesce(v_cust.art_files, '[]'::jsonb)) je
       where je.value->>'id' = v_art_id
       limit 1;
    end if;
    v_auto_art := v_art_entry is not null
      and coalesce(v_art_entry->>'status', '') = 'approved'
      and (
        (v_art_entry->>'prod_files_attached')::boolean is true
        or jsonb_array_length(coalesce(v_art_entry->'prod_files', '[]'::jsonb)) > 0
        or (
          coalesce(v_art_entry->>'deco_type', '') = 'embroidery'
          and exists (
            select 1
              from jsonb_array_elements(
                     coalesce(v_art_entry->'files', '[]'::jsonb)
                     || coalesce(v_art_entry->'prod_files', '[]'::jsonb)) f
             where lower(coalesce(
                     case when jsonb_typeof(f) = 'string' then f #>> '{}'
                          else coalesce(f->>'name', f->>'url') end, '')) like '%.dst'
          )
        )
      );

    select jsonb_agg(jsonb_build_object(
             'item_idx', t.item_idx, 'deco_idx', t.d0, 'deco_idxs', t.dis,
             'sku', t.sku, 'name', t.iname, 'color', t.color, 'units', t.units, 'fulfilled', 0
           ) order by t.item_idx),
           coalesce(sum(t.units), 0)
      into v_job_items, v_job_units
      from (
        select d.item_idx, min(d.deco_idx) as d0, jsonb_agg(d.deco_idx order by d.deco_idx) as dis,
               min(d.sku) as sku, min(d.iname) as iname, min(d.color) as color, min(d.units) as units
          from _ts_job_decos d
         where d.deco_type = v_job.deco_type and d.logo_ref = v_job.logo_ref
         group by d.item_idx) t;

    insert into so_jobs (
      so_id, id, key, art_file_id, _art_ids, art_name, deco_type, positions,
      art_status, item_status, prod_status, total_units, fulfilled_units,
      split_from, created_at, ship_method, items, _auto, digitizing_needed
    ) values (
      v_so_id, v_job_id, v_job_key,
      case when v_auto_art then v_art_id else null end,
      case when v_auto_art then jsonb_build_array(v_art_id) else '[]'::jsonb end,
      case when v_auto_art then coalesce(v_art_entry->>'name', v_job_name) else v_job_name end,
      v_job.deco_type, v_positions,
      case when v_auto_art then 'art_complete' else 'needs_art' end,
      'need_to_order', 'hold', v_job_units, 0, null, v_today_txt,
      'ship_customer', coalesce(v_job_items, '[]'::jsonb), true,
      case when v_auto_art then false else v_job.digitizing end
    );

    insert into job_stage_events (so_id, job_id, event, from_state, to_state, actor, source, payload)
    values (
      v_so_id, v_job_id, 'created', null,
      jsonb_build_object('prod_status', 'hold',
                         'art_status', case when v_auto_art then 'art_complete' else 'needs_art' end),
      null, 'club',
      jsonb_build_object('webstore_order_id', v_ord.id, 'logo_ref', v_job.logo_ref,
                         'digitizing_needed', case when v_auto_art then false else v_job.digitizing end,
                         'auto_art', v_auto_art,
                         'art_file_id', case when v_auto_art then v_art_id else null end)
    );
  end loop;

  -- ── Link the order ── same write batchOrders/00199 make after SO creation.
  update webstore_orders
     set so_id = v_so_id, status = 'batched'
   where id = v_ord.id;

  -- ── Invoice ── mirrors 00199's invoice block; no PO branch (club orders only reach
  -- here 'paid'). Guarded by the same any-invoice check so a concurrent writer or a
  -- future staff action can never double-invoice.
  if not exists (select 1 from invoices where so_id = v_so_id) then
    perform pg_advisory_xact_lock(hashtext('nsa_invoices_id_mint'));
    select greatest(coalesce(max((regexp_match(id, '(\d+)'))[1]::bigint), 0), 1000) + 1
      into v_inv_num
      from invoices;
    v_inv_id := 'INV-' || v_inv_num;

    select coalesce(jsonb_agg(jsonb_build_object(
             'desc', li.descr, 'qty', li.qty, 'rate', li.rate, 'amount', li.amount,
             '_sku', li.sku, '_name', li.name, '_color', li.color
           ) order by li.item_index), '[]'::jsonb),
           coalesce(round(sum(li.amount)::numeric, 2), 0)
      into v_line_items, v_inv_total
      from (
        select it.item_index, it.sku, it.name, it.color,
               it.sku || ' ' || it.name
                 || case when coalesce(it.color, '') <> '' then ' — ' || it.color else '' end as descr,
               q.qty, it.unit_sell as rate, round((q.qty * it.unit_sell)::numeric, 2) as amount
          from so_items it
          cross join lateral (
            select coalesce(sum(v.value::numeric), 0)::int as qty
              from jsonb_each_text(coalesce(it.sizes, '{}'::jsonb)) v
          ) q
         where it.so_id = v_so_id and q.qty > 0
      ) li;

    v_term_days := nullif(regexp_replace(coalesce(v_cust.payment_terms, ''), '\D', '', 'g'), '')::int;
    if v_term_days is null or v_term_days = 0 then
      v_term_days := 30;
    end if;
    v_date_txt := to_char(now(), 'YYYY-MM-DD');
    v_due_txt  := to_char(now() + make_interval(days => v_term_days), 'YYYY-MM-DD');

    -- Card-settlement clamp (00199's batch-path rule): apply the smaller of the
    -- invoice total and what the store order actually collected.
    v_applied := round(least(v_inv_total, greatest(coalesce(v_ord.total, 0), 0))::numeric, 2);
    v_inv_status := case when v_applied >= v_inv_total - 0.005 then 'paid'
                         when v_applied > 0 then 'partial'
                         else 'open' end;

    insert into invoices (
      id, customer_id, so_id, type, inv_type, date, due_date,
      total, paid, status, memo, tax, tax_rate, tax_exempt, shipping,
      line_items, created_at, updated_at
    ) values (
      v_inv_id, v_store.customer_id, v_so_id, 'invoice', 'full', v_date_txt, v_due_txt,
      v_inv_total, v_applied, v_inv_status, 'Invoice — ' || v_memo, 0, 0, true, 0,
      v_line_items, now(), now()
    );

    insert into invoice_items (invoice_id, sku, name, qty)
    select v_inv_id, it.sku, it.name,
           (select coalesce(sum(v.value::numeric), 0)::int
              from jsonb_each_text(coalesce(it.sizes, '{}'::jsonb)) v)
      from so_items it
     where it.so_id = v_so_id
     order by it.item_index;

    if v_applied > 0 then
      v_pay_ref := 'CLUB ' || coalesce(v_ord.order_number::text, v_ord.id::text);
      insert into invoice_payments (invoice_id, amount, method, ref, date)
      values (v_inv_id, v_applied, 'store', v_pay_ref, to_char(now(), 'MM/DD/YYYY'));
    end if;
  end if;

  -- ── Fundraise credit ── the club's "Fundraiser Dollars" ledger row (00204 header #6).
  -- Same id convention as App.js addFundraiseCredit with dedupKey 'so_'+soId, so a
  -- staff-side re-credit attempt for this SO would also dedupe against this row.
  if v_fundraise_cost > 0 then
    insert into customer_credits (id, customer_id, amount, used, is_fundraise, source, created_by, created_at)
    values (
      'cr_fund_so_' || v_so_id,
      v_store.customer_id,
      v_fundraise_cost,
      0,
      true,
      'Webstore fundraising — ' || coalesce(v_store.name, 'Club Store') || ' · ' || v_so_id,
      'System (club conversion)',
      now()
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'so_id', v_so_id, 'replayed', false,
    'items', v_idx, 'jobs', v_jn, 'units', v_total_units,
    'invoice_id', v_inv_id, 'no_rep', v_no_rep);
end $$;

revoke all on function public.create_club_sales_order(uuid) from public;
revoke all on function public.create_club_sales_order(uuid) from anon;
revoke all on function public.create_club_sales_order(uuid) from authenticated;
grant execute on function public.create_club_sales_order(uuid) to service_role;
