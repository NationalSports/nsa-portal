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
        return ok({ groups: data || [] });
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
            packers: [...byPacker.entries()].map(([who, n]) => ({ who, bags: n })).sort((a, b) => b.bags - a.bags),
            top_shorts: [...bySku.values()].sort((a, b) => b.count - a.count).slice(0, 8),
            by_hour_utc: byHourOfDay,
          },
        });
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
