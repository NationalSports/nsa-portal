-- Club store individual-order conversion (money-of-record).
--
-- Business change: club webstores (webstores.org_type = 'club') stop routing through
-- the staff "batch" flow (Webstores.js batchOrders). Each club order converts into its
-- OWN Sales Order + jobs automatically the moment it is paid — exactly like Team Shop
-- orders (00196/00199) — while decoration grouping (jobGroupKey) and pulling (this
-- migration's array-capable pullBatchTransfers, client-side) stay grouped across every
-- converted-but-unpulled order. Team stores (org_type 'team'/null) are UNCHANGED:
-- batchOrders/pullBatchTransfers(single so_id) keep working exactly as before.
--
-- This RPC is modeled DIRECTLY on 00199's create_teamshop_sales_order — same guard
-- shape, same id-mint technique, same so_items/so_item_decorations/so_jobs/invoice
-- column sets — with the differences called out below.
--
--   1. GUARDS — mirror 00199's NSA_* convention, but keyed on the STORE not the
--      order: webstores.org_type must be 'club' (NSA_BAD_SOURCE) instead of
--      order_source='teamshop'; status must be 'paid' (NSA_NOT_PAID); so_id replay
--      short-circuit identical; no-items guard identical.
--   2. CUSTOMER — club stores carry their customer on webstores.customer_id (every
--      webstore has always had this column — it is NOT new). Team Shop instead reads
--      webstore_orders.customer_id (00195), because one teamshop store serves many
--      customers; a club store serves exactly one club, so the store IS the customer
--      link. NULL webstores.customer_id -> NSA_BAD_INPUT.
--   3. ITEM/DECO SHAPE — Team Shop's webstore_order_items carry a per-item
--      `decorations` jsonb array (quickorder-quote priced it). Club/storefront order
--      items carry NO such array (webstore-checkout.js priceCart never writes one) —
--      decoration comes from the STORE CATALOG instead, exactly like batchOrders reads
--      it (Webstores.js:2676-2839):
--        * so_items — one line per distinct (product_id, sku), sizes merged the same
--          way (batchOrders' byProduct); unit_sell = collected revenue ÷ units, scaled
--          by this ORDER's own discount ratio (batchOrders' discRatio, degenerate to
--          one order: (subtotal+fundraise-discount)/(subtotal+fundraise)) — the same
--          principle 00199 uses, adapted from "one batch of orders" to "one order".
--        * BUNDLE allocation — bundle child rows carry unit_price 0 (the package price
--          sits on the parent row); batchOrders allocates the parent's collected value
--          across children weighted by each child's master retail_price (a jersey
--          absorbs more than socks), equal-split when weights are unknown. Replicated
--          here via temp tables _club_bundle_parent/_club_bundle_weight.
--        * GARMENT COST — so_items.nsa_cost is stamped from products.nsa_cost, or
--          products.clearance_cost when is_clearance (the costByPid rule at
--          Webstores.js:1184-1195) — batchOrders' own so_items write does NOT apply
--          this (it reads plain nsa_cost via a separate `pinfo` query), so this RPC is
--          intentionally MORE correct than the batch path on this one field; flagged
--          for the reviewer, not a bug fix to batchOrders (out of scope — team-store
--          code is untouched).
--        * LOGO decorations — webstore_products.decorations (the store-builder's
--          placed logos, keyed by product_id) become kind:'art' so_item_decorations
--          rows, same placement->position table batchOrders uses (POS_LABEL/posOf).
--          art_file_id stays NULL — same as 00199's precedent (no so_art_files record
--          is created server-side; staff attach real art through the normal pipeline).
--          `type`/`stitches` are looked up from the store's OWN customer.art_files by
--          art_id when resolvable (screen_print/embroidery), defaulting to
--          screen_print/1-color otherwise — batchOrders' full art-library resolution
--          (own + parent org + every past SO/estimate, color-way matching) is NOT
--          replicated; this is a deliberate scope cut (see rollout notes / final
--          report) that only affects production ROUTING (job deco_type grouping), not
--          money (these decos are always sell 0 / cost 0, same as batchOrders).
--        * TRANSFER-CODE decorations — heat-transfer designs, from BOTH bundle
--          components (webstore_bundle_items.transfer_code) and catalog singles
--          (webstore_products.transfer_codes[]), become kind:'art' rows too
--          (type 'heat_press', transfer_code stamped, art_file_id NULL). COST PARITY:
--          webstore_transfers gained a `unit_cost` column (this migration) — staff set
--          it from their bulk transfer buys (total spend ÷ qty bought). cost_each on
--          these rows = that transfer's unit_cost (coalesced to 0 — a missing cost
--          never blocks conversion, same posture as 00199's teamshop_deco_rates
--          lookup). sell_override/sell_each stay 0 (revenue is already folded into
--          unit_sell). This is the EXACT shape decoPricing.dP's "Team Shop conversion
--          decos (00199)" branch consumes (kind 'art' + no art_file_id + cost_each not
--          null -> cost-of-record, sell 0) — so club transfer cost flows into GP the
--          same way teamshop rate-card cost already does.
--        * NUMBERS/NAMES decorations — batchOrders also emits kind:'numbers'/'names'
--          rows (jersey personalization) with `sell_override: null` and a client-only
--          `sell_suppressed: true` flag. That flag is NOT in _decoCols (src/constants.js)
--          — it never survives the DB round-trip, so on ANY reload dP() (App.js's own
--          copy checks d.sell_suppressed; decoPricing.js's copy does not) can silently
--          RE-ADD a computed numbers/names sell on top of unit_sell (double-counted
--          revenue) for batched club SOs today. This RPC does NOT replicate that latent
--          gap: it writes `sell_override = 0` explicitly (not null), which deco_pricing's
--          'numbers'/'names' branches honor deterministically (sell_override != null ->
--          use it) forever, independent of any in-memory flag. cost stays real (npP()/
--          name cost still applies) — only revenue is suppressed. This is a deliberate,
--          documented correctness choice for the NEW path only; batchOrders itself is
--          untouched (team-store behavior must be provably unchanged).
--   4. JOBS — one so_jobs row per distinct (deco_type, logo_ref), the SAME
--      _ts_job_decos pattern and syncJobs-compatible key shape 00199 documents.
--      Populated from LOGO and TRANSFER art decos only (numbers/names decos do not
--      spawn a job row — 00199 sets the same precedent: only art-kind decos build
--      production jobs). digitizing_needed is always false for club (these are
--      existing customer art-library logos, not coach-uploaded Team Shop logos
--      needing a digitizing vendor route).
--   5. INVOICE — mirrors 00199's invoice block byte-for-byte in structure (id mint,
--      line items off the SO's own so_items, customer payment-terms due date, the
--      batch path's card-settlement clamp: apply min(invoice total, order total
--      collected), status paid/partial/open by the same 0.005 threshold, the same
--      NOT EXISTS(so_id) any-invoice guard). Club orders only ever reach this RPC
--      'paid' (no po_verified equivalent exists for club), so there is no PO branch.
--      Commissions are computed per invoice (CommissionsPage.calcGP walks invoices) —
--      without this, club orders would silently vanish from rep commission statements.
--   6. FUNDRAISE CREDIT — NOT created here. sales_orders._webstore_fundraise IS
--      stamped (this order's fundraise_amt x discount ratio, same as batchOrders) so
--      calcGP nets it out of GP the same way a batched club SO would — but the
--      customer_credits "Fundraiser Dollars" row webstoreCreateSO's addFundraiseCredit
--      writes client-side is NOT written by this RPC. Flagged as a follow-up decision
--      (out of the coordinator's explicit ask for this pass — garment cost / transfer
--      cost / invoice parity); the club is not shorted money, the credit ledger entry
--      just isn't automatic yet.
--
-- Idempotency / guards (NSA_* codes, 00171/00192/00193/00199 conventions):
--   * row lock (FOR UPDATE) on the webstore order;
--   * so_id already set -> {so_id, replayed:true}, no writes;
--   * store org_type must be 'club'    -> NSA_BAD_SOURCE;
--   * status must be 'paid'            -> NSA_NOT_PAID:<status>;
--   * store has no customer_id / order has no items -> NSA_BAD_INPUT;
--   * invoice insert additionally guarded by NOT EXISTS(so_id) (00199's own guard).
--
-- Grants: service_role ONLY (called via the service key from Netlify functions).

-- ── Transfer unit cost (GP parity for heat-transfer decorations) ──────────────
alter table public.webstore_transfers add column if not exists unit_cost numeric;

-- ── Conversion RPC ──────────────────────────────────────────────────────────
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
  -- (logo placements + transfer designs) — identical shape/keying to 00199.
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
      v_so_id, v_job_id, v_job_key, null, '[]'::jsonb, v_job_name, v_job.deco_type, v_positions,
      'needs_art', 'need_to_order', 'hold', v_job_units, 0, null, v_today_txt,
      'ship_customer', coalesce(v_job_items, '[]'::jsonb), true, v_job.digitizing
    );

    insert into job_stage_events (so_id, job_id, event, from_state, to_state, actor, source, payload)
    values (
      v_so_id, v_job_id, 'created', null,
      jsonb_build_object('prod_status', 'hold', 'art_status', 'needs_art'),
      null, 'club',
      jsonb_build_object('webstore_order_id', v_ord.id, 'logo_ref', v_job.logo_ref, 'digitizing_needed', v_job.digitizing)
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

  return jsonb_build_object(
    'so_id', v_so_id, 'replayed', false,
    'items', v_idx, 'jobs', v_jn, 'units', v_total_units,
    'invoice_id', v_inv_id, 'no_rep', v_no_rep);
end $$;

-- Service-role only: Netlify functions call this with the service key.
revoke all on function public.create_club_sales_order(uuid) from public;
revoke all on function public.create_club_sales_order(uuid) from anon;
revoke all on function public.create_club_sales_order(uuid) from authenticated;
grant execute on function public.create_club_sales_order(uuid) to service_role;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop function if exists public.create_club_sales_order(uuid);
--   alter table public.webstore_transfers drop column if exists unit_cost;
--   (Converted orders keep their SOs; to un-convert one order:
--     update webstore_orders set so_id = null, status = 'paid' where id = <id>;
--     then delete the SO through the staff portal, which cascades so_items/
--     so_item_decorations/so_jobs. To un-invoice one conversion:
--       delete from invoice_payments where invoice_id = <'INV-…'>;
--       delete from invoice_items    where invoice_id = <'INV-…'>;
--       delete from invoices         where id = <'INV-…'>;)
