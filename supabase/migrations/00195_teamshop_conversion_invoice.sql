-- Team Shop conversion invoice (Coach Crossover Workstream 5 — money-of-record).
--
-- 00192's create_teamshop_sales_order converts a paid Team Shop order into a
-- Sales Order + jobs but created NO invoices row — so teamshop revenue was
-- invisible to commissions (CommissionsPage.js buildCommLines only reads
-- paid/partial invoices joined to SOs) and to rep A/R (open-invoice digests).
-- The staff webstore batch path proves the intended behavior: App.js
-- createAndSettleWebstoreInvoice (~12238) auto-creates a settled invoice per
-- converted order. This migration CREATE OR REPLACEs the RPC with the 00192
-- body kept byte-for-byte in behavior for everything it already did, plus:
--
--   1. INVOICE — after the SO/items/decos/jobs writes, mint an invoice id and
--      insert an invoices row mirroring createAndSettleWebstoreInvoice:
--        * id mint  — the exact client rule (App.js nextInvId, line 165):
--          'INV-' + (max(first digit run of any existing id via /(\d+)/,
--          floored at 1000) + 1), under pg_advisory_xact_lock — the same
--          technique 00192 uses for SO ids.
--        * columns  — the client inv object ∩ dbEngine's _invCols allowlist
--          (dbEngine.js:1632): id/customer_id/so_id/type 'invoice'/inv_type
--          'full'/date (en-CA YYYY-MM-DD)/due_date (date + customer terms
--          days)/total/paid/status/memo 'Invoice — <so memo>'/tax 0/tax_rate
--          0/tax_exempt true/shipping 0 (teamshop has no team-tab extras —
--          the batch path's tabExtras is 0 here)/line_items jsonb/created_at/
--          updated_at (timestamptz; client writes "now" — we write now()).
--        * line_items — the batch path's shape per SO item: {desc: sku+' '+
--          name+(' — '+color), qty: Σsizes, rate: unit_sell, amount:
--          round(qty*unit_sell,2), _sku,_name,_color}; total = Σ amount.
--          Since 00192 prices unit_sell = collected(garment+deco) ÷ units,
--          the invoice total reconciles to the goods+deco the buyer paid;
--          tax/shipping/processing ride on the store order, not the invoice
--          (tax_exempt true — same reconciliation as the batch path).
--        * items     — invoice_items rows exactly as dbEngine persists the
--          client's items array (sku/name/qty; unit_price is undefined in
--          the client mapping and therefore NULL here too).
--        * payment   — for orders that arrived 'paid' (card via Stripe): the
--          batch path's settlement shape — one invoice_payments row
--          {method 'store', ref 'TEAMSHOP <order number|id>', date
--          MM/DD/YYYY}, amount = min(invoice total, order's card-collected
--          total) — the batch clamp (can only under-apply, never overpay).
--          Invoice status by the client rule: paid ≥ total−0.005 → 'paid',
--          > 0 → 'partial', else 'open'. (cc_fee is NOT written on the
--          payment row: no migration creates that column on
--          invoice_payments and the client's value is 0 on this path.)
--        * PO branch — order status 'po_verified' (arrives in a later
--          workstream; accepted defensively now): invoice 'open', paid 0, no
--          payment row, due date = now() + customer payment-terms days.
--          Terms rule = the client's parseInt((payment_terms||'net30')
--          .replace(/\D/g,''))||30 (App.js:12256). webstore_orders has no
--          payment_method column (traced — none exists), so the branch keys
--          on status alone.
--        * _version  — NOT set: 00180's DEFAULT 1 + trigger own it (same
--          contract as sales_orders._version in 00192). _rep is NOT
--          persisted: it is client-state only (absent from _invCols).
--   2. DECO COST — so_item_decorations.cost_each is populated from
--      teamshop_deco_rates.cost matched by (type, option_key) on active rows
--      (00194; option defaults 'standard' like _teamshopRates.rateFor). A
--      missing rate row or NULL cost falls back to 0 (00192's value) and the
--      conversion still succeeds — cost is staff-completable later via the
--      rates table. TRACED CAVEAT: today's GP math (App.js dP, used by
--      CommissionsPage calcGP) derives cost for kind='art' decos from the
--      SP/EM/DTF matrices via type/colors/stitches/dtf_size and reads
--      cost_each only for kind 'names'/'outside_deco' — so this write is the
--      cost-of-record for staff/future reads, not yet consumed by dP.
--   3. REP GUARD — after loading the customer, a NULL primary_rep_id raises
--      NOTICE 'TEAMSHOP_NO_REP:<customer_id>' (never an exception — the
--      conversion must not block) and the result carries no_rep: true so
--      callers/queues can surface it. (commissionRepId falls back to
--      so.created_by, which is NULL on this server path — no rep would be
--      credited until staff assign one.)
--   4. IDEMPOTENCY — the existing so_id replay short-circuit already returns
--      before any invoice write; the invoice insert is additionally guarded
--      by NOT EXISTS (select 1 from invoices where so_id = ...) — the same
--      any-invoice guard the client path uses (App.js:12240) — so a
--      staff-batched SO or a concurrent writer can never get a second one.
--
-- Result jsonb gains: invoice_id (null if the guard skipped it), no_rep.
-- Replay result is unchanged from 00192 ({so_id, replayed:true}).
--
-- Grants: identical to 00192 (service_role only).

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

      -- Cost of record (00194 rate card): matched by (type, option_key) on
      -- active rows — the same lookup _teamshopRates.rateFor makes (option
      -- defaults 'standard'). NULL rate/cost → 0 (00192's value); a missing
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
  -- (buildJobs/syncJobs entry states for art-less decos).
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
      null,
      '[]'::jsonb,
      v_job_name,
      v_job.deco_type,
      v_positions,
      'needs_art',
      'need_to_order',
      'hold',
      v_job_units,
      0,
      null,
      v_today_txt,
      'ship_customer',
      coalesce(v_job_items, '[]'::jsonb),
      true,
      v_job.digitizing
    );

    -- 00188 event log, same transaction.
    insert into job_stage_events (so_id, job_id, event, from_state, to_state, actor, source, payload)
    values (
      v_so_id, v_job_id, 'created',
      null,
      jsonb_build_object('prod_status', 'hold', 'art_status', 'needs_art'),
      null,
      'teamshop',
      jsonb_build_object(
        'webstore_order_id', v_ord.id,
        'logo_ref', v_job.logo_ref,
        'digitizing_needed', v_job.digitizing)
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

-- Service-role only: Netlify functions call this with the service key; the
-- coach-facing convert_order action re-verifies the coach JWT server-side and
-- this RPC re-guards paid status regardless of caller.
revoke all on function public.create_teamshop_sales_order(uuid) from public;
revoke all on function public.create_teamshop_sales_order(uuid) from anon;
revoke all on function public.create_teamshop_sales_order(uuid) from authenticated;
grant execute on function public.create_teamshop_sales_order(uuid) to service_role;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   Re-apply migration 00192's create or replace function body (this file only
--   replaces the function; no DDL to undo). Invoices already created remain —
--   to un-invoice one conversion:
--     delete from invoice_payments where invoice_id = <'INV-…'>;
--     delete from invoice_items    where invoice_id = <'INV-…'>;
--     delete from invoices         where id = <'INV-…'>;
--   (Or delete the invoice through the staff portal, which cascades children.)
