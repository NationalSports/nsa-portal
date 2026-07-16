-- Team Shop Stage 7 (plan decision D4, standard version): server-side idempotent
-- order → production conversion. One SECURITY DEFINER RPC turns a PAID Team Shop
-- webstore_orders row into a Sales Order + production jobs, in ONE transaction.
--
-- Invoked post-payment from two best-effort callers (either may fire first, both
-- may fire — the row lock + so_id replay guard make that safe):
--   * teamshop-checkout.js action `convert_order` (called by CheckoutPage after
--     webstore-checkout finalize succeeds);
--   * stripe-webhook.js on the payment_intent.succeeded path (guarded, logged,
--     never fails webhook processing).
-- The staff Webstores batch flow (Webstores.js batchOrders → App.js
-- webstoreCreateSO) is untouched and remains the manual fallback.
--
-- Every column set below is DERIVED, not invented:
--   * sales_orders row      — mirrors App.js webstoreCreateSO (the SO batchOrders
--     creates): status 'need_order', shipping_type 'flat'/0, ship_to_id 'default',
--     tax_rate 0 + tax_exempt true (tax was collected on the webstore order),
--     _webstore_fundraise 0 (Team Shop has no fundraising), source 'webstore'
--     (so every staff read — pricing.js tax, App.js report filters — treats it
--     exactly like a batched webstore SO), webstore_id = the seeded
--     'nationalteamshop' store (00195). webstore_batch_no is assigned by the
--     00177 trigger on insert, same as the client path. created_at/updated_at are
--     TEXT columns; the client writes new Date().toLocaleString() — we write the
--     same 'M/D/YYYY, H:MM:SS AM' shape so fmtCreatedAt/Date.parse behave identically.
--     _version is NOT set: DEFAULT 1 + the 00049 trigger own it (dbEngine contract).
--   * SO id mint            — the exact client rule (App.js ~164):
--     'SO-' + (max(numeric part of any existing id via /(\d+)/) floored at 1000) + 1,
--     under pg_advisory_xact_lock so two conversions can never mint the same id.
--   * so_items              — batchOrders' soItems shape: one line per distinct
--     (product, color, decoration set), sizes = {size: qty} jsonb map,
--     available_sizes = its keys, unit_sell = retail_price = collected revenue
--     (garment + deco sell) ÷ units, deco sells suppressed on the deco rows —
--     exactly how batchOrders reconciles SO total to what the buyer paid.
--   * so_item_decorations   — batchOrders' art-deco mapping (kind 'art', position
--     via the same POS_LABEL placement→position table, sell_override/sell_each/
--     cost_each 0, web_url/placement/side/color_label from 00169) PLUS the dP
--     pricing fields (colors/underbase/stitches/dtf_size) from the decoSpec,
--     since Team Shop decos carry no so_art_files record for dP to read them from.
--     art_file_id stays NULL (no so_art_files row is created — staff attach real
--     art through the normal art pipeline; buildJobs/syncJobs treat a null
--     art_file_id art deco as 'Unassigned Art', art_status 'needs_art').
--   * so_jobs               — one job per distinct (logo ref × deco method), the
--     field set syncJobs/buildJobs persist: id 'JOB-<n>-NN', key in syncJobs'
--     signature form (deco_type + '::' + sorted 'unassigned@<position>' parts, so
--     the client's job matcher preserves these jobs on the first staff re-sync),
--     art_status 'needs_art' (the entry state for art-less decos in both
--     builders), item_status 'need_to_order', prod_status 'hold' (born on hold —
--     00192 contract), items jsonb in buildJobs' per-item shape, _auto true,
--     ship_method 'ship_customer' (syncJobs' default for non-rep-delivery),
--     created_at date-only text (syncJobs writes toLocaleDateString()).
--     digitizing_needed (new, additive) = true when the job decorates a
--     coach-uploaded logo (logo_source 'teamshop') with embroidery.
--   * job_stage_events      — one 'created' row per job, source 'teamshop', in
--     the SAME transaction (00192's append-only log).
--
-- Idempotency / guards (NSA_* codes, 00171/00192/00193 conventions):
--   * row lock (FOR UPDATE) on the webstore order serializes concurrent callers;
--   * so_id already set → {so_id, replayed:true}, no writes;
--   * order_source must be 'teamshop'  → NSA_BAD_SOURCE;
--   * status must be 'paid' (the exact value webstore-checkout finalize and
--     stripe-webhook write)            → NSA_NOT_PAID:<status>;
--   * no customer / no items           → NSA_BAD_INPUT.
--
-- Grants: service_role ONLY (called via the service key from Netlify functions;
-- the coach-facing convert_order action re-verifies the coach JWT and the RPC
-- re-guards paid status).

-- ── Additive column ─────────────────────────────────────────────────────────
alter table public.so_jobs add column if not exists digitizing_needed boolean;

-- ── Conversion RPC ──────────────────────────────────────────────────────────
create or replace function public.create_teamshop_sales_order(
  p_webstore_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord         webstore_orders;
  v_store_name  text;
  v_num         bigint;
  v_so_id       text;
  v_now_txt     text;
  v_today_txt   text;
  v_grp         record;
  v_p           record;
  v_deco        jsonb;
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
begin
  -- Serialize concurrent conversions of this order (convert_order + webhook may
  -- race): the loser waits here, then sees so_id set and replays.
  select * into v_ord from webstore_orders where id = p_webstore_order_id for update;
  if not found then
    raise exception 'NSA_NOT_FOUND:webstore order';
  end if;

  -- Replay-safe: already converted (by either caller or a staff batch).
  if v_ord.so_id is not null then
    return jsonb_build_object('so_id', v_ord.so_id, 'replayed', true);
  end if;

  if coalesce(v_ord.order_source, '') <> 'teamshop' then
    raise exception 'NSA_BAD_SOURCE:%', coalesce(v_ord.order_source, 'storefront');
  end if;
  -- 'paid' is the exact value webstore-checkout finalize and stripe-webhook
  -- write on the paid signal; anything else (pending_payment, cancelled,
  -- refunded, …) must not reach production.
  if coalesce(v_ord.status, '') <> 'paid' then
    raise exception 'NSA_NOT_PAID:%', coalesce(v_ord.status, '(null)');
  end if;
  if v_ord.customer_id is null then
    raise exception 'NSA_BAD_INPUT:order has no customer_id';
  end if;
  if not exists (select 1 from webstore_order_items i
                 where i.order_id = v_ord.id
                   and coalesce(i.is_bundle_parent, false) = false) then
    raise exception 'NSA_BAD_INPUT:order has no items';
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
  insert into sales_orders (
    id, customer_id, memo, status, created_at, updated_at,
    expected_date, production_notes, shipping_type, shipping_value,
    ship_to_id, tax_rate, tax_exempt, _webstore_fundraise, source, webstore_id
  ) values (
    v_so_id,
    v_ord.customer_id,
    coalesce(v_store_name, 'Team Shop') || ' — order #'
      || coalesce(v_ord.order_number::text, left(v_ord.id::text, 8))
      || case when coalesce(v_ord.buyer_name, '') <> '' then ' — ' || v_ord.buyer_name else '' end,
    'need_order',
    v_now_txt,
    v_now_txt,
    '',
    'Team Shop: ' || coalesce(v_store_name, 'National Team Shop')
      || e'\nOrder #' || coalesce(v_ord.order_number::text, left(v_ord.id::text, 8))
      || ' · ' || coalesce(v_ord.buyer_name, '')
      || case when coalesce(v_ord.buyer_email, '') <> '' then ' (' || v_ord.buyer_email || ')' else '' end
      || e'\ndelivery: ship to home'
      || e'\nPaid by card (Stripe): $' || to_char(coalesce(v_ord.total, 0), 'FM999999990.00')
      || ' — sales tax collected on the store order.',
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
        0, 0, 0,
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

    -- 00192 event log, same transaction.
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

  return jsonb_build_object(
    'so_id', v_so_id, 'replayed', false,
    'items', v_idx, 'jobs', v_jn, 'units', v_total_units);
end $$;

-- Service-role only: Netlify functions call this with the service key; the
-- coach-facing convert_order action re-verifies the coach JWT server-side and
-- this RPC re-guards paid status regardless of caller.
revoke all on function public.create_teamshop_sales_order(uuid) from public;
revoke all on function public.create_teamshop_sales_order(uuid) from anon;
revoke all on function public.create_teamshop_sales_order(uuid) from authenticated;
grant execute on function public.create_teamshop_sales_order(uuid) to service_role;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop function if exists public.create_teamshop_sales_order(uuid);
--   alter table public.so_jobs drop column if exists digitizing_needed;
--   (Converted orders keep their SOs; to un-convert one order:
--     update webstore_orders set so_id = null, status = 'paid' where id = <id>;
--     then delete the SO through the staff portal, which cascades children.)
