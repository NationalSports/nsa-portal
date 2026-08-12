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
        try { if (row) await sendOrderBagged(sb, row); }
        catch (e) { console.warn('[bagging] bagged email failed:', e.message || e); }
        return ok({ order: row });
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
