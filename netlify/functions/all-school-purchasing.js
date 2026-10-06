// Disabled stores are inert. Claims, allocations and external submission states
// live in PostgreSQL; never append an LWW app_state batch directly from JS.
const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin, verifyUser } = require('./_shared');
const { shipFromLocation } = require('../../src/lib/shipFrom');
const { purchasingSettings, purchaseDecision } = require('./_allSchoolPurchasing');
const { generateForSoSafe } = require('./teamshop-auto-po');

async function drain(build) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await build().range(offset, offset + 999);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}
function warehouseDestination() {
  const w = shipFromLocation('warehouse');
  return { companyName: w.company || w.name, address1: w.street1, address2: w.street2 || '', city: w.city, region: w.state, postalCode: w.zip, country: 'US' };
}
async function dispatchDedicated(admin, po, adapter) {
  if (!po || po.submission_state !== 'pending' || po.status !== 'draft') return { submitted: false, reason: 'not_pending' };
  const vendorSetting = await admin.from('teamshop_auto_po_settings').select('auto_submit_enabled').eq('vendor', po.vendor).maybeSingle();
  if (vendorSetting.error || vendorSetting.data?.auto_submit_enabled !== true) return { submitted: false, reason: 'vendor_disabled' };
  const linesResult = await admin.from('purchase_order_lines').select('*').eq('po_id', po.id).order('id');
  if (linesResult.error) throw new Error('Could not read purchase allocations: ' + linesResult.error.message);
  const resolved = await adapter.resolveVendorPurchaseOrder({ purchaseOrder: po, lines: linesResult.data || [], shipTo: po.ship_to });
  if (!resolved.ok) return { submitted: false, reason: 'held', error: resolved.error };
  const token = crypto.randomUUID();
  const claim = await admin.rpc('claim_all_school_po_submission', { p_po_id: po.id, p_token: token });
  if (claim.error) throw new Error('Submission claim failed: ' + claim.error.message);
  if (!claim.data?.claimed) return { submitted: false, reason: 'already_claimed' };
  let result;
  try { result = await adapter.submitResolvedVendorPurchaseOrder({ purchaseOrder: claim.data.purchase_order, resolved }); }
  catch (e) { result = { ok: false, state: 'unknown', error: e.message || String(e) }; }
  const state = result.ok ? 'submitted' : (result.state === 'held' ? 'held' : 'unknown');
  const recorded = await admin.rpc('record_all_school_po_submission', {
    p_po_id: po.id, p_token: token, p_state: state,
    p_api_order_id: result.api_order_id ? String(result.api_order_id) : null,
    p_error: result.error || null, p_vendor_lines: result.vendor_lines || resolved.vendor_lines || [],
  });
  if (recorded.error || !recorded.data?.ok) return { submitted: !!result.ok, reason: 'recording_failed', state: 'unknown', error: recorded.error?.message || recorded.data?.reason, po_id: po.id };
  return { submitted: !!result.ok, state, po_id: po.id, api_order_id: result.api_order_id || null, error: result.error || null };
}
async function sweepAllSchoolPurchasing(admin, { dryRun = false, now = new Date().toISOString(), actor = 'all-school-schedule', adapter } = {}) {
  const stores = await drain(() => admin.from('webstores').select('id,name,org_type,all_school_settings').eq('org_type', 'all_school').order('id'));
  const output = { ok: true, dry_run: dryRun, stores: [], errors: [] };
  for (const store of stores) {
    try {
      const settings = purchasingSettings(store);
      if (!settings.enabled || settings.mode === 'manual') { output.stores.push({ store_id: store.id, reason: settings.enabled ? 'manual' : 'disabled' }); continue; }
      const orders = await drain(() => admin.from('webstore_orders').select('id,so_id,created_at,status').eq('store_id', store.id).eq('order_source', 'all_school').in('status', ['paid', 'batched']).not('so_id', 'is', null).order('id'));
      const soIds = [...new Set(orders.map(o => o.so_id))];
      if (!dryRun) for (const soId of soIds) {
        const generation = await generateForSoSafe(admin, soId, actor, 'all-school-purchasing');
        if (generation?.ok === false) output.errors.push({ store_id: store.id, so_id: soId, error: generation.error });
      }
      const dateBySo = Object.fromEntries(orders.map(o => [o.so_id, o.created_at]));
      const needs = [];
      for (let i = 0; i < soIds.length; i += 100) needs.push(...await drain(() => admin.from('teamshop_auto_po_needs').select('*').in('so_id', soIds.slice(i, i + 100)).eq('skip_reason', 'all_school_pending').is('dismissed_at', null).is('po_id', null).order('id')));
      const vendors = [...new Set(needs.map(n => n.vendor).filter(Boolean))];
      const decisions = [];
      for (const vendor of vendors) {
        const cfg = purchasingSettings(store, vendor);
        let pending = needs.filter(n => n.vendor === vendor).map(n => ({ ...n, created_at: dateBySo[n.so_id] || n.created_at }));
        if (!dryRun && cfg.enabled && ['SanMar', 'S&S Activewear'].includes(vendor)) {
          // Reserve stock before evaluating $200. The SQL plan below repeats
          // the allocation under locks before it creates any actual PO.
          const evaluated = await admin.rpc('plan_all_school_purchase', { p_store_id: store.id, p_vendor: vendor,
            p_run_key: 'evaluate:' + store.id + ':' + vendor, p_need_ids: pending.map(n => n.id), p_due_reason: 'evaluate',
            p_combine_regular: false, p_no_batch_policy: cfg.no_batch_policy, p_max_run_cents: cfg.max_run_cents,
            p_actor: actor, p_ship_to: warehouseDestination() });
          if (evaluated.error) throw new Error(evaluated.error.message);
          if (!Array.isArray(evaluated.data?.lines)) { decisions.push({ vendor, due: false, reason: evaluated.data?.reason || 'evaluation_failed' }); continue; }
          const qtyById = Object.fromEntries(evaluated.data.lines.map(l => [l.meta.need_id, l.qty]));
          pending = pending.map(n => ({ ...n, qty_needed: qtyById[n.id] || 0, qty_on_hand: 0 }));
        }
        const decision = purchaseDecision({ pendingNeeds: pending, settings: cfg, now });
        if (!['SanMar', 'S&S Activewear'].includes(vendor)) { decisions.push({ vendor, ...decision, due: false, reason: 'unsupported_vendor' }); continue; }
        const report = { vendor, ...decision };
        decisions.push(report);
        if (!decision.due || dryRun) continue;
        const ids = decision.need_ids.slice().sort((a, b) => Number(a) - Number(b));
        const digest = crypto.createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 24);
        const planned = await admin.rpc('plan_all_school_purchase', {
          p_store_id: store.id, p_vendor: vendor, p_run_key: 'allschool:' + store.id + ':' + vendor + ':' + digest,
          p_need_ids: ids, p_due_reason: decision.reason, p_combine_regular: decision.combine_regular === true,
          p_no_batch_policy: cfg.no_batch_policy, p_max_run_cents: cfg.max_run_cents, p_actor: actor, p_ship_to: warehouseDestination(),
        });
        if (planned.error) { report.error = planned.error.message; output.errors.push({ store_id: store.id, vendor, error: report.error }); continue; }
        report.plan = planned.data;
        const po = planned.data?.purchase_order;
        if (po && !planned.data.combined_regular && po.threshold_eval?.combined_regular !== true) {
          const api = adapter || require('./_allSchoolVendorApi');
          report.submission = await dispatchDedicated(admin, po, api);
        }
      }
      // Retry only resolution-held *pending* dedicated drafts. A submitting or
      // unknown result is never sent again automatically, even after a crash.
      if (!dryRun) {
        const pendingPos = await admin.from('purchase_orders').select('*').eq('all_school_store_id', store.id).eq('status', 'draft').eq('submission_state', 'pending').order('created_at').limit(25);
        if (pendingPos.error) throw new Error(pendingPos.error.message);
        for (let po of pendingPos.data || []) {
          if (decisions.some(d => d.plan?.purchase_order?.id === po.id && d.submission)) continue;
          const cfg = purchasingSettings(store, po.vendor);
          if (cfg.enabled && cfg.mode !== 'manual' && po.threshold_eval?.combined_regular === true) {
            const promoted = await admin.rpc('promote_all_school_regular_purchase', { p_po_id: po.id });
            if (promoted.error) throw new Error('Maximum-wait promotion failed: ' + promoted.error.message);
            if (!promoted.data?.promoted) continue;
            po = promoted.data.purchase_order;
          }
          if (cfg.enabled && cfg.mode !== 'manual') decisions.push({ vendor: po.vendor, po_id: po.id, submission: await dispatchDedicated(admin, po, adapter || require('./_allSchoolVendorApi')) });
        }
      }
      output.stores.push({ store_id: store.id, decisions });
    } catch (e) { output.errors.push({ store_id: store.id, error: e.message || String(e) }); }
  }
  output.ok = !output.errors.length;
  return output;
}
exports.handler = async event => {
  const headers = corsHeaders();
  if (event?.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  let actor = 'all-school-schedule', dryRun = false;
  if (event?.httpMethod) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST required' }) };
    const auth = await verifyUser(event);
    if (!auth.ok) return { statusCode: auth.status || 401, headers, body: JSON.stringify({ error: auth.error || 'Unauthorized' }) };
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
    if (!['preview', 'sweep'].includes(body.action)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Use preview or sweep' }) };
    actor = auth.teamMemberId || 'staff'; dryRun = body.action === 'preview';
  }
  try { return { statusCode: 200, headers, body: JSON.stringify(await sweepAllSchoolPurchasing(getSupabaseAdmin(), { actor, dryRun })) }; }
  catch (e) { return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message || String(e) }) }; }
};
module.exports.sweepAllSchoolPurchasing = sweepAllSchoolPurchasing;
module.exports.dispatchDedicated = dispatchDedicated;
module.exports.warehouseDestination = warehouseDestination;
