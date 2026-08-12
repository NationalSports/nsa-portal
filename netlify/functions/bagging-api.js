// Bagging Station API — the single server surface the /bagging-station tablet
// talks to (BAGGING_STATION_PLAN.md). All DB access is service-role: the
// bagging RPCs (supabase/migrations/20260812030000_bagging_station.sql) have
// EXECUTE revoked from anon/authenticated, so the browser can't drive them
// directly. Race-sensitive logic (claims, complete, backorder split) lives in
// those RPCs — this function is auth + dispatch, and never moves money
// (refunds stay on stripe-payment's refund_webstore_order path; the
// resolve_short 'refunded' action here only records state afterwards).
//
// Auth, same two trust levels as job-scan:
//   * staff mode — signed-in staff (Supabase JWT via verifyUser);
//   * station mode — unattended tablet presenting PROD_SCAN_TOKEN as
//     x-machine-token (constant-time compare).

const { corsHeaders, getSupabaseAdmin, verifyUser, safeEqualStr } = require('./_shared');
const { sendOrderBagged } = require('./_webstoreEmail');
const { createBagShipLabel } = require('./_baggingShip');

const LIVE = ['pending_payment', 'cancelled', 'refunded']; // excluded statuses

// Learned pack-rate MODEL from the last 30 days: time = secPerBag × bags +
// secPerItem × items. Two parameters, because order mix varies — a bag has
// fixed overhead (claim, label, handling) plus per-item time, so stores with
// 1-item bags and 6-item bags can't share a single per-unit number. Fitted by
// least squares over active 15-minute blocks (each block: a·bags + b·items ≈
// 900s), clamped to sane ranges, defaults (40s/bag + 15s/item) until there are
// 12+ active blocks of history. Cached per warm container for 10 minutes.
// Deliberately data-driven, not an LLM guess.
const RATE_TTL_MS = 10 * 60 * 1000;
let _rateCache = null; // { at, secPerBag, secPerItem, sample, learned }
async function packRate(sb) {
  if (_rateCache && Date.now() - _rateCache.at < RATE_TTL_MS) return _rateCache;
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: evs } = await sb.from('bagging_events')
    .select('order_id, created_at').eq('event', 'complete')
    .gte('created_at', since).limit(10000);
  const completes = evs || [];
  const unitsByOrder = {};
  const ids = [...new Set(completes.map((e) => e.order_id).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: its } = await sb.from('webstore_order_items')
      .select('order_id, qty, bagged_qty').in('order_id', ids.slice(i, i + 200));
    (its || []).forEach((x) => {
      unitsByOrder[x.order_id] = (unitsByOrder[x.order_id] || 0) + Math.min(Number(x.bagged_qty) || 0, Number(x.qty) || 0);
    });
  }
  // Observations: per active 15-min block, bags + items completed in it.
  const buckets = new Map(); // bucketStart -> {bags, items}
  for (const e of completes) {
    const b = Math.floor(Date.parse(e.created_at) / 900000) * 900000;
    const cur = buckets.get(b) || { bags: 0, items: 0 };
    cur.bags += 1; cur.items += unitsByOrder[e.order_id] || 0;
    buckets.set(b, cur);
  }
  let secPerBag = 40; let secPerItem = 15; let learned = false;
  const obs = [...buckets.values()].filter((o) => o.bags > 0);
  if (obs.length >= 12) {
    // Least squares for [a,b] in a·bags + b·items = 900 (normal equations).
    let sxx = 0; let sxy = 0; let syy = 0; let sxT = 0; let syT = 0;
    for (const o of obs) { sxx += o.bags * o.bags; sxy += o.bags * o.items; syy += o.items * o.items; sxT += o.bags * 900; syT += o.items * 900; }
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) > 1e-6) {
      const a = (sxT * syy - syT * sxy) / det;
      const b = (syT * sxx - sxT * sxy) / det;
      // Clamp to sane physical ranges; degenerate fits fall back to defaults.
      if (Number.isFinite(a) && Number.isFinite(b)) {
        secPerBag = Math.min(300, Math.max(5, a));
        secPerItem = Math.min(120, Math.max(3, b));
        learned = true;
      }
    }
  }
  _rateCache = { at: Date.now(), secPerBag, secPerItem, sample: obs.length, learned };
  return _rateCache;
}
// Expected seconds for a workload under the learned model.
const expectedSec = (rate, bags, items) => rate.secPerBag * bags + rate.secPerItem * items;

exports.handler = async (event) => {
  const headers = { ...corsHeaders(), 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-machine-token' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'bad json' }) }; }

  // ── Auth: machine token OR staff JWT ──
  let actor = null;
  const stationToken = process.env.PROD_SCAN_TOKEN;
  const presented = event.headers?.['x-machine-token'];
  if (stationToken && presented && safeEqualStr(presented, stationToken)) {
    actor = 'station:' + String(body.station || 'tablet').slice(0, 40);
  }
  if (!actor) {
    try {
      const v = await verifyUser(event);
      if (v && v.ok) actor = 'staff:' + v.teamMemberId;
    } catch (_) { /* fall through */ }
  }
  if (!actor) return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'Not authorized' }) };

  const sb = getSupabaseAdmin();
  const ok = (data) => ({ statusCode: 200, headers, body: JSON.stringify({ ok: true, ...data }) });
  const fail = (status, error) => ({ statusCode: status, headers, body: JSON.stringify({ ok: false, error }) });
  // RPC errors carry NSA_BAG_* codes the station translates; surface them as 409
  // (state conflict), everything else as 500.
  const rpcFail = (error) => fail(/NSA_BAG_/.test(error.message || '') ? 409 : 500, error.message);

  const orderWithItems = async (orderId) => {
    const { data, error } = await sb.from('webstore_orders')
      .select('*, webstore_order_items(*), webstores(id,name,slug)')
      .eq('id', orderId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  try {
    switch (body.action) {
      case 'list_groups': {
        const { data, error } = await sb.rpc('bagging_list_groups');
        if (error) return rpcFail(error);
        // Enrich each card with remaining units + a learned time estimate so
        // the picker and the dashboards can plan the day's packing labor.
        const rate = await packRate(sb);
        const groups = await Promise.all((data || []).map(async (g) => {
          try {
            const { data: n } = await sb.rpc('bagging_ready_items', { p_kind: g.kind, p_group_id: String(g.group_id) });
            const units = Number(n) || 0;
            const est = expectedSec(rate, Number(g.ready) || 0, units);
            return { ...g, ready_units: units, est_minutes: units ? Math.max(1, Math.round(est / 60)) : 0 };
          } catch { return g; }
        }));
        return ok({ groups, rate: { sec_per_bag: +rate.secPerBag.toFixed(1), sec_per_item: +rate.secPerItem.toFixed(1), learned: rate.learned } });
      }

      case 'group_detail': {
        // kind 'so' | 'store' | 'backorders' (spec: bag group)
        const { kind, group_id: groupId } = body;
        let q = sb.from('webstore_orders')
          .select('*, webstore_order_items(*)')
          .not('status', 'in', `(${LIVE.join(',')})`)
          .order('created_at');
        if (kind === 'so') q = q.eq('so_id', groupId).is('backorder_of', null);
        else if (kind === 'store') q = q.eq('store_id', groupId).is('backorder_of', null);
        else if (kind === 'backorders') q = q.eq('store_id', groupId).not('backorder_of', 'is', null);
        else return fail(400, 'bad kind');
        const { data, error } = await q;
        if (error) return rpcFail(error);
        const { data: prog, error: pErr } = await sb.rpc('bagging_batch_progress', { p_kind: kind, p_group_id: String(groupId) });
        if (pErr) return rpcFail(pErr);
        return ok({ orders: data || [], progress: (prog && prog[0]) || null });
      }

      case 'next_order': {
        const { data, error } = await sb.rpc('bagging_next_order', {
          p_kind: body.kind, p_group_id: String(body.group_id), p_actor: actor,
        });
        if (error) return rpcFail(error);
        const row = data && data[0];
        if (!row) return ok({ order: null }); // group is done (or fully claimed)
        return ok({ order: await orderWithItems(row.id) });
      }

      case 'claim_order': {
        const { error } = await sb.rpc('bagging_claim_order', { p_order_id: body.order_id, p_actor: actor });
        if (error) return rpcFail(error);
        return ok({ order: await orderWithItems(body.order_id) });
      }

      case 'reopen_order': {
        const { error } = await sb.rpc('bagging_reopen_order', { p_order_id: body.order_id, p_actor: actor });
        if (error) return rpcFail(error);
        return ok({ order: await orderWithItems(body.order_id) });
      }

      case 'release_order': {
        const { error } = await sb.rpc('bagging_release_order', { p_order_id: body.order_id, p_actor: actor });
        if (error) return rpcFail(error);
        return ok({});
      }

      case 'check_item': {
        const { data, error } = await sb.rpc('bagging_check_item', {
          p_item_id: body.item_id, p_qty: Number(body.qty) || 0, p_actor: actor,
        });
        if (error) return rpcFail(error);
        return ok({ item: data && data[0] });
      }

      case 'short_item': {
        const { data, error } = await sb.rpc('bagging_short_item', {
          p_item_id: body.item_id, p_short_qty: Number(body.short_qty) || 0,
          p_note: body.note || null, p_actor: actor,
        });
        if (error) return rpcFail(error);
        return ok({ item: data && data[0] });
      }

      case 'complete_order': {
        const { data, error } = await sb.rpc('bagging_complete_order', { p_order_id: body.order_id, p_actor: actor });
        if (error) return rpcFail(error);
        const row = data && data[0];
        // Buyer notification — "your order is packed", honest about backordered
        // and refunded pieces. Best-effort: a Brevo hiccup never fails the bag.
        // Respects webstores.bagged_email_enabled (checked inside).
        try { if (row) await sendOrderBagged(sb, row); }
        catch (e) { console.warn('[bagging] bagged email failed:', e.message || e); }
        // Ship-direct: auto-create the ShipStation label so the packer never
        // touches a desktop (webstores.bagging_auto_label gates it; checked
        // inside). A label failure NEVER fails the bag — the station shows
        // "print from Webstores" instead.
        let ship = null;
        if (row && row.ship_method === 'ship_home') {
          try {
            const { data: its } = await sb.from('webstore_order_items').select('*').eq('order_id', row.id);
            ship = await createBagShipLabel(sb, row, its || []);
          } catch (e) {
            console.warn('[bagging] auto ship label failed for', row.id, ':', e.message || e);
            ship = { error: e.message || 'label failed' };
          }
        }
        return ok({ order: row, ship });
      }

      case 'resolve_short': {
        // resolution 'found' | 'pulled' | 'refunded' — 'refunded' is recorded by
        // the DESKTOP flow only after stripe-payment's refund succeeded (or with
        // a note for OMG orders). Station tokens can't record refunds.
        if (body.resolution === 'refunded' && actor.startsWith('station:')) {
          return fail(403, 'Refunds are resolved at the desk, not the station');
        }
        const { data, error } = await sb.rpc('bagging_resolve_short', {
          p_item_id: body.item_id, p_resolution: body.resolution,
          p_note: body.note || null, p_actor: actor,
        });
        if (error) return rpcFail(error);
        return ok({ item: data && data[0] });
      }

      case 'backorder_short': {
        const { data, error } = await sb.rpc('bagging_backorder_short', {
          p_item_id: body.item_id, p_eta: body.eta || null,
          p_note: body.note || null, p_actor: actor,
        });
        if (error) return rpcFail(error);
        return ok({ child_order_id: data });
      }

      case 'resolve_scan': {
        // ?scan=WO-<order id> from a bag label QR → the order, wherever it is.
        const m = /^WO-([0-9a-f-]{36})$/i.exec(String(body.code || '').trim());
        if (!m) return fail(404, 'Not a bag label code');
        const order = await orderWithItems(m[1]);
        if (!order) return fail(404, 'Order not found');
        return ok({ order });
      }

      case 'stats': {
        // Reporting: computed from the bagging_events audit log over a window.
        // "Per hour" is per ACTIVE hour (hours with at least one completed bag)
        // so lunch breaks and overnight don't dilute the rate.
        const days = Math.max(1, Math.min(90, Number(body.days) || 7));
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data: evs, error } = await sb.from('bagging_events')
          .select('event, actor, order_id, item_id, qty, created_at')
          .in('event', ['complete', 'short', 'label_print'])
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .limit(10000);
        if (error) return rpcFail(error);
        const completes = (evs || []).filter((e) => e.event === 'complete');
        const shortEvs = (evs || []).filter((e) => e.event === 'short' && (Number(e.qty) || 0) > 0);
        // items per completed bag (bagged units at completion time ≈ current bagged_qty)
        const orderIds = [...new Set(completes.map((e) => e.order_id).filter(Boolean))];
        let itemsTotal = 0;
        const chunks = [];
        for (let i = 0; i < orderIds.length; i += 200) chunks.push(orderIds.slice(i, i + 200));
        for (const c of chunks) {
          const { data: its } = await sb.from('webstore_order_items')
            .select('order_id, qty, bagged_qty').in('order_id', c);
          itemsTotal += (its || []).reduce((a, i) => a + Math.min(Number(i.bagged_qty) || 0, Number(i.qty) || 0), 0);
        }
        // top shorted products (from the short events' items)
        const shortItemIds = [...new Set(shortEvs.map((e) => e.item_id).filter(Boolean))];
        const bySku = new Map();
        for (let i = 0; i < shortItemIds.length; i += 200) {
          const { data: its } = await sb.from('webstore_order_items')
            .select('id, sku, name, size, short_qty').in('id', shortItemIds.slice(i, i + 200));
          (its || []).forEach((it) => {
            const key = `${it.sku || ''}|${it.name || ''}`;
            const cur = bySku.get(key) || { sku: it.sku || '', name: it.name || it.sku || 'Item', count: 0 };
            cur.count += Number(it.short_qty) || 1;
            bySku.set(key, cur);
          });
        }
        const hourKey = (iso) => String(iso || '').slice(0, 13); // YYYY-MM-DDTHH
        const activeHours = new Set(completes.map((e) => hourKey(e.created_at))).size;
        // Clean-bag rate: pace alone incentivizes speed over correctness (pro
        // dashboards always pair throughput with an accuracy figure) — the
        // closest honest proxy we have is bags completed without any short.
        const shortOrderIds = new Set(shortEvs.map((e) => e.order_id).filter(Boolean));
        const cleanBags = completes.filter((e) => !shortOrderIds.has(e.order_id)).length;
        const byPacker = new Map();
        completes.forEach((e) => {
          const who = String(e.actor || 'unknown').replace(/^staff:/, 'staff #').replace(/^station:/, '');
          byPacker.set(who, (byPacker.get(who) || 0) + 1);
        });
        const byHourOfDay = Array(24).fill(0);
        completes.forEach((e) => { const h = new Date(e.created_at).getUTCHours(); byHourOfDay[h] += 1; });
        return ok({
          stats: {
            days,
            bags: completes.length,
            items: itemsTotal,
            active_hours: activeHours,
            bags_per_hour: activeHours ? +(completes.length / activeHours).toFixed(1) : 0,
            items_per_hour: activeHours ? +(itemsTotal / activeHours).toFixed(1) : 0,
            avg_items_per_bag: completes.length ? +(itemsTotal / completes.length).toFixed(1) : 0,
            shorts: shortEvs.length,
            clean_rate: completes.length ? +((cleanBags / completes.length) * 100).toFixed(1) : null,
            packers: [...byPacker.entries()].map(([who, n]) => ({ who, bags: n })).sort((a, b) => b.bags - a.bags),
            top_shorts: [...bySku.values()].sort((a, b) => b.count - a.count).slice(0, 8),
            by_hour_utc: byHourOfDay,
          },
        });
      }

      case 'stats_stores': {
        // Per-store drill-down: how long each store's bagging actually took
        // (first→last completed bag) and the pace in 15-minute buckets.
        const days = Math.max(1, Math.min(90, Number(body.days) || 7));
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const { data: evs, error } = await sb.from('bagging_events')
          .select('order_id, created_at').eq('event', 'complete')
          .gte('created_at', since).order('created_at', { ascending: true }).limit(10000);
        if (error) return rpcFail(error);
        const orderIds = [...new Set((evs || []).map((e) => e.order_id).filter(Boolean))];
        const storeByOrder = {};
        for (let i = 0; i < orderIds.length; i += 200) {
          const { data: ords } = await sb.from('webstore_orders')
            .select('id, store_id').in('id', orderIds.slice(i, i + 200));
          (ords || []).forEach((o) => { storeByOrder[o.id] = o.store_id; });
        }
        const storeIds = [...new Set(Object.values(storeByOrder))];
        const nameByStore = {};
        if (storeIds.length) {
          const { data: ws } = await sb.from('webstores').select('id, name').in('id', storeIds);
          (ws || []).forEach((w) => { nameByStore[w.id] = w.name; });
        }
        // Bagged units per order → per store, for actual sec/unit vs expectation.
        const unitsByOrder = {};
        for (let i = 0; i < orderIds.length; i += 200) {
          const { data: its } = await sb.from('webstore_order_items')
            .select('order_id, qty, bagged_qty').in('order_id', orderIds.slice(i, i + 200));
          (its || []).forEach((x) => {
            unitsByOrder[x.order_id] = (unitsByOrder[x.order_id] || 0) + Math.min(Number(x.bagged_qty) || 0, Number(x.qty) || 0);
          });
        }
        // Target = expected efficiency vs the learned two-parameter model
        // (100% = exactly model pace); manager-set via set_target.
        const { data: cfgRows } = await sb.from('bagging_config').select('value').eq('key', 'target_efficiency_pct').limit(1);
        const targetPct = Number(cfgRows && cfgRows[0] && cfgRows[0].value) || 100;
        const fleet = await packRate(sb);
        const BUCKET = 15 * 60 * 1000;
        const perStore = new Map();
        for (const e of (evs || [])) {
          const sid = storeByOrder[e.order_id];
          if (!sid) continue;
          const t = Date.parse(e.created_at);
          const cur = perStore.get(sid) || { store_id: sid, store_name: nameByStore[sid] || 'Store', bags: 0, units: 0, first: t, last: t, buckets: new Map() };
          cur.units += unitsByOrder[e.order_id] || 0;
          cur.bags += 1;
          cur.first = Math.min(cur.first, t);
          cur.last = Math.max(cur.last, t);
          const b = Math.floor(t / BUCKET) * BUCKET;
          cur.buckets.set(b, (cur.buckets.get(b) || 0) + 1);
          perStore.set(sid, cur);
        }
        const stores = [...perStore.values()].map((s) => {
          const activeBuckets = s.buckets.size;
          // Grade against what the MODEL expected for this store's exact mix
          // (bags × overhead + items × per-item), on active time only — so a
          // store of 6-item bags isn't punished next to a store of 1-item bags.
          const actualSec = activeBuckets * 900;
          const expSec = expectedSec(fleet, s.bags, s.units);
          const effPct = actualSec > 0 && expSec > 0 ? Math.round((expSec / actualSec) * 100) : null;
          const activeHrs = activeBuckets / 4;
          return {
            store_id: s.store_id, store_name: s.store_name, bags: s.bags,
            units: s.units,
            orders_per_hr: activeHrs > 0 ? +(s.bags / activeHrs).toFixed(1) : null,
            units_per_hr: activeHrs > 0 ? +(s.units / activeHrs).toFixed(1) : null,
            efficiency_pct: effPct,
            vs_target_pct: effPct != null ? effPct - targetPct : null,
            started_at: new Date(s.first).toISOString(), finished_at: new Date(s.last).toISOString(),
            span_minutes: Math.max(1, Math.round((s.last - s.first) / 60000)),
            // pace over buckets that actually had bagging, so breaks don't dilute
            bags_per_15min: activeBuckets ? +(s.bags / activeBuckets).toFixed(1) : s.bags,
            per15: [...s.buckets.entries()].sort((a, b) => a[0] - b[0])
              .map(([t, n]) => ({ t: new Date(t).toISOString(), n })),
          };
        }).sort((a, b) => b.finished_at.localeCompare(a.finished_at));
        return ok({
          stores,
          target_pct: targetPct,
          model: { sec_per_bag: +fleet.secPerBag.toFixed(1), sec_per_item: +fleet.secPerItem.toFixed(1), learned: fleet.learned },
        });
      }

      case 'set_target': {
        // Manager-set expectation: efficiency vs the learned model, in percent
        // (100 = model pace, 110 = 10% faster than model). Staff only —
        // station tokens can't move the goalposts.
        if (actor.startsWith('station:')) return fail(403, 'Set the target from a staff login');
        const pct = Math.max(50, Math.min(200, Number(body.efficiency_pct) || 0));
        if (!pct) return fail(400, 'bad efficiency_pct');
        const { error } = await sb.from('bagging_config')
          .upsert({ key: 'target_efficiency_pct', value: pct, updated_by: actor, updated_at: new Date().toISOString() });
        if (error) return rpcFail(error);
        return ok({ target_pct: pct });
      }

      case 'log_label_print': {
        await sb.from('bagging_events').insert({
          order_id: body.order_id, actor, event: 'label_print',
        });
        return ok({});
      }

      default:
        return fail(400, 'unknown action');
    }
  } catch (e) {
    return fail(500, e.message || String(e));
  }
};
