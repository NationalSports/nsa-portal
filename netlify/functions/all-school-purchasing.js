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
  const pendingByVendor = new Map();
  const activeStores = stores.filter(store => {
    const cfg = purchasingSettings(store);
    return cfg.enabled && cfg.mode !== 'manual';
  });
  for (const store of activeStores) {
    try {
      const orders = await drain(() => admin.from('webstore_orders').select('id,so_id,created_at,status').eq('store_id', store.id).eq('order_source', 'all_school').in('status', ['paid', 'batched']).not('so_id', 'is', null).order('id'));
      const soIds = [...new Set(orders.map(o => o.so_id))];
      if (!dryRun) for (const soId of soIds) {
        const generated=await generateForSoSafe(admin, soId, actor, 'all-school-purchasing');
        if(generated?.ok===false) output.errors.push({store_id:store.id,so_id:soId,error:generated.error});
      }
      const dates = Object.fromEntries(orders.map(o => [o.so_id, o.created_at]));
      for (let i=0;i<soIds.length;i+=100) {
        const needs = await drain(() => admin.from('teamshop_auto_po_needs').select('*').in('so_id',soIds.slice(i,i+100)).eq('skip_reason','all_school_pending').is('dismissed_at',null).is('po_id',null).order('id'));
        for (const need of needs) {
          const cfg = purchasingSettings(store, need.vendor);
          if (!cfg.enabled || cfg.mode === 'manual') continue;
          if (!pendingByVendor.has(need.vendor)) pendingByVendor.set(need.vendor, []);
          pendingByVendor.get(need.vendor).push({...need, store_id:store.id, created_at:dates[need.so_id] || need.created_at});
        }
      }
    } catch (e) { output.errors.push({store_id:store.id,error:e.message}); }
  }
  output.suppliers = [];
  const attempted = new Set();
  for (const [vendor, needs] of pendingByVendor) {
    const report = {vendor}; output.suppliers.push(report);
    try {
      if (!['SanMar','S&S Activewear','Momentec'].includes(vendor)) { report.reason='unsupported_vendor'; continue; }
      const storeId = needs[0].store_id;
      const args = {p_store_id:storeId,p_vendor:vendor,p_need_ids:needs.map(n=>n.id),p_due_reason:'evaluate',p_combine_regular:false,p_no_batch_policy:'separate',p_max_run_cents:100000,p_actor:actor,p_ship_to:warehouseDestination()};
      let pending = needs;
      if (!dryRun) {
        const evaluated = await admin.rpc('plan_all_school_purchase',{...args,p_run_key:'evaluate:shared:'+vendor});
        if (evaluated.error) throw new Error(evaluated.error.message);
        if (!Array.isArray(evaluated.data?.lines)) { report.reason=evaluated.data?.reason || 'evaluation_failed'; continue; }
        const quantities = Object.fromEntries(evaluated.data.lines.map(l=>[l.meta.need_id,l.qty]));
        pending = needs.map(n=>({...n,qty_needed:quantities[n.id] || 0,qty_on_hand:0}));
      }
      // Fixed shared policy: $200 of garment cost or oldest order seven days old.
      // Chunk oldest first within supplier API limits so a large queue still drains.
      const chunks = supplierChunks(pending);
      report.batches=[];
      for (const chunk of chunks) {
        const decision = purchaseDecision({pendingNeeds:chunk,settings:{...purchasingSettings({}),enabled:true,mode:'minimum',minimum_cents:20000,max_wait_days:7,combine_regular:false},now});
        report.batches.push(decision);
        if (!decision.due || dryRun) continue;
        const ids=decision.need_ids.slice().sort((a,b)=>Number(a)-Number(b));
        const digest=crypto.createHash('sha256').update(ids.join(',')).digest('hex').slice(0,24);
        const planned=await admin.rpc('plan_all_school_purchase',{...args,p_need_ids:ids,p_run_key:'allschool:shared:'+vendor+':'+digest,p_due_reason:decision.reason});
        if(planned.error) throw new Error(planned.error.message);
        decision.plan=planned.data;
        const po=planned.data?.purchase_order;
        if(po) { attempted.add(po.id); decision.submission=await dispatchDedicated(admin,po,adapter || require('./_allSchoolVendorApi')); }
      }
    } catch(e) { report.error=e.message; output.errors.push({vendor,error:e.message}); }
  }
  // Recover existing dedicated drafts and old regular-batch allocations. Never
  // retry submitting/unknown requests, and let SQL recheck every source store.
  if (!dryRun) for(const store of activeStores) {
    try {
      const pos=await drain(()=>admin.from('purchase_orders').select('*').eq('all_school_store_id',store.id).eq('status','draft').eq('submission_state','pending').order('id'));
      for(let po of pos) {
        if(attempted.has(po.id)) continue;
        if(po.threshold_eval?.combined_regular) {
          const promoted=await admin.rpc('promote_all_school_regular_purchase',{p_po_id:po.id});
          if(promoted.error) throw new Error(promoted.error.message);
          if(!promoted.data?.promoted) continue;
          po=promoted.data.purchase_order;
        }
        const cfg=purchasingSettings(store,po.vendor);
        if(cfg.enabled && cfg.mode!=='manual') output.suppliers.push({vendor:po.vendor,po_id:po.id,submission:await dispatchDedicated(admin,po,adapter || require('./_allSchoolVendorApi'))});
      }
    } catch(e) { output.errors.push({store_id:store.id,error:e.message}); }
  }
  output.ok = !output.errors.length;
  return output;
}
function supplierChunks(needs) {
  const chunks=[]; let chunk=[], total=0, styles=new Set();
  for(const need of needs.filter(n=>Number(n.qty_needed)>Number(n.qty_on_hand || 0)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at) || Number(a.id)-Number(b.id))) {
    const cost=(Number(need.qty_needed)-Number(need.qty_on_hand || 0))*Number(need.unit_cost_cents);
    if(chunk.length && (chunk.length>=100 || total+cost>100000 || (!styles.has(need.sku) && styles.size>=20))) {chunks.push(chunk);chunk=[];total=0;styles=new Set();}
    chunk.push(need); total+=cost; styles.add(need.sku);
  }
  if(chunk.length) chunks.push(chunk);
  return chunks;
}
module.exports.supplierChunks=supplierChunks;
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
