// Staff-only Methodic brand workflow.
//
// Methodic requests live beside normal National sales orders. A mock request is
// handed directly to an existing SO art job by appending a normal art_requests
// entry; artists therefore work it from the existing Art Dashboard rather than
// from a second, disconnected mockup system.
const { corsHeaders, verifyUser } = require('./_shared');

const PRICING = new Set(['not_requested', 'requested', 'working', 'quoted', 'approved', 'declined', 'expired']);
const MOCKUP = new Set(['not_requested', 'requested', 'in_art', 'ready_for_rep', 'revisions_requested', 'approved', 'cancelled']);
const SAMPLE = new Set(['not_requested', 'requested', 'confirmed', 'in_production', 'shipped', 'received', 'approved', 'changes_requested', 'waived', 'cancelled']);
const ORDER = new Set(['not_ordered', 'po_needed', 'po_ready', 'ordered', 'confirmed', 'in_production', 'quality_check', 'shipped', 'delivered', 'on_hold', 'cancelled']);
const BILLING = new Set(['not_ready', 'ready', 'queued', 'posted', 'verified', 'error', 'void']);
const PRIORITY = new Set(['low', 'normal', 'high', 'rush']);
const DATE_FIELDS = new Set(['expected_pricing_date', 'quote_expires_on', 'expected_mockup_date', 'expected_sample_date', 'expected_ship_date', 'expected_arrival_date']);
const MONEY_FIELDS = new Set(['quoted_unit_cost_cents', 'quoted_setup_cost_cents']);
const TEXT_LIMITS = {
  title: 160, style_number: 100, garment_description: 300, garment_color: 120,
  request_notes: 4000, blocker: 1000, pricing_notes: 2000,
  sample_tracking_number: 200, sample_tracking_url: 1000,
  purchase_order_number: 120, methodic_order_number: 120,
  carrier: 120, tracking_number: 200, tracking_url: 1000,
  methodic_invoice_number: 120, billing_error: 1000,
};
const UPDATE_FIELDS = new Set([
  ...Object.keys(TEXT_LIMITS), 'art_job_id', 'owner_id', 'priority', 'quantity', 'size_breakdown', 'reference_files',
  'pricing_status', 'mockup_status', 'sample_status', 'order_status', 'billing_status',
  ...DATE_FIELDS, ...MONEY_FIELDS,
]);

const reply = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });
const cleanText = (value, max) => {
  if (value == null) return null;
  const out = String(value).trim();
  return out ? out.slice(0, max) : null;
};
const isDate = (value) => {
  if (value == null || value === '') return true;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
const cleanFiles = (value) => Array.isArray(value)
  ? value.slice(0, 20).map((file) => {
    if (typeof file === 'string') return { url: cleanText(file, 1000) };
    return { url: cleanText(file?.url, 1000), name: cleanText(file?.name, 200) };
  }).filter((file) => file.url && /^https:\/\//i.test(file.url))
  : [];
const cleanSizes = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  Object.entries(value).slice(0, 60).forEach(([size, qty]) => {
    const n = Math.floor(Number(qty));
    if (size && Number.isFinite(n) && n >= 0 && n <= 100000) out[String(size).slice(0, 40)] = n;
  });
  return out;
};
const artStatusToMockup = (status) => {
  if (status === 'waiting_approval') return 'ready_for_rep';
  if (['production_files_needed', 'order_dtf_transfers', 'upload_emb_files', 'art_complete'].includes(status)) return 'approved';
  return ['art_requested', 'art_in_progress'].includes(status) ? 'in_art' : 'requested';
};

function validatePatch(input, { create = false } = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!UPDATE_FIELDS.has(key)) continue;
    if (key in TEXT_LIMITS) patch[key] = cleanText(value, TEXT_LIMITS[key]);
    else if (DATE_FIELDS.has(key)) {
      if (!isDate(value)) throw new Error(`Invalid ${key.replaceAll('_', ' ')}.`);
      patch[key] = value || null;
    } else if (MONEY_FIELDS.has(key)) {
      if (value == null || value === '') patch[key] = null;
      else {
        const cents = Math.round(Number(value));
        if (!Number.isFinite(cents) || cents < 0 || cents > 1000000000) throw new Error(`Invalid ${key.replaceAll('_', ' ')}.`);
        patch[key] = cents;
      }
    } else if (key === 'quantity') {
      const qty = Math.floor(Number(value));
      if (!Number.isFinite(qty) || qty < 0 || qty > 100000) throw new Error('Invalid quantity.');
      patch.quantity = qty;
    } else if (key === 'size_breakdown') patch.size_breakdown = cleanSizes(value);
    else if (key === 'reference_files') patch.reference_files = cleanFiles(value);
    else if (key === 'priority') {
      if (!PRIORITY.has(value)) throw new Error('Invalid priority.');
      patch.priority = value;
    } else if (key === 'pricing_status') {
      if (!PRICING.has(value)) throw new Error('Invalid pricing status.');
      patch.pricing_status = value;
    } else if (key === 'mockup_status') {
      if (!MOCKUP.has(value)) throw new Error('Invalid mockup status.');
      patch.mockup_status = value;
    } else if (key === 'sample_status') {
      if (!SAMPLE.has(value)) throw new Error('Invalid sample status.');
      patch.sample_status = value;
    } else if (key === 'order_status') {
      if (!ORDER.has(value)) throw new Error('Invalid order status.');
      patch.order_status = value;
    } else if (key === 'billing_status') {
      if (!BILLING.has(value)) throw new Error('Invalid billing status.');
      patch.billing_status = value;
    } else if (key === 'art_job_id' || key === 'owner_id') patch[key] = cleanText(value, 120);
  }
  if (create && !patch.title) throw new Error('A request title is required.');
  return patch;
}

async function addEvent(sb, requestId, actorId, eventType, message, metadata = {}) {
  const { error } = await sb.from('methodic_request_events').insert({
    request_id: requestId, actor_id: actorId || null, event_type: eventType,
    message: cleanText(message, 1000), metadata,
  });
  // The request itself remains authoritative. A temporary audit-table problem
  // must not roll back a successful art handoff and leave the SO job orphaned.
  if (error) { console.error('[methodic-workflow] event insert:', error.message); return false; }
  return true;
}

async function handoffToArt(sb, request, actor) {
  if (!request.art_job_id) throw new Error('Choose an art job before requesting a Methodic mockup.');
  const { data: job, error } = await sb.from('so_jobs')
    .select('id,so_id,art_name,art_status,art_requests,assigned_artist,rep_notes')
    .eq('so_id', request.sales_order_id).eq('id', request.art_job_id).maybeSingle();
  if (error) throw error;
  if (!job) throw new Error('The selected art job was not found on this sales order.');

  const requests = Array.isArray(job.art_requests) ? job.art_requests : [];
  const existing = requests.find((item) => item?.source === 'methodic' && item?.methodic_request_id === request.id);
  if (existing) return { artRequestId: existing.id, artStatus: job.art_status, reused: true };

  const now = new Date().toISOString();
  const artRequestId = `AR-${request.request_number}`;
  const instructions = [
    `METHODIC MOCK REQUEST ${request.request_number}`,
    request.style_number ? `Style: ${request.style_number}` : null,
    request.garment_description ? `Garment: ${request.garment_description}` : null,
    request.garment_color ? `Color: ${request.garment_color}` : null,
    request.quantity ? `Quantity: ${request.quantity}` : null,
    request.request_notes || null,
  ].filter(Boolean).join('\n');
  const next = [...requests, {
    id: artRequestId, status: 'requested', instructions,
    created_at: now, created_by: actor.teamMemberId,
    artist: job.assigned_artist || null,
    source: 'methodic', methodic_request_id: request.id,
  }];
  const methodicNote = request.request_notes ? `[${request.request_number}] ${request.request_notes}` : null;
  const patch = { art_requests: next };
  if (methodicNote) patch.rep_notes = [job.rep_notes, methodicNote].filter(Boolean).join('\n').slice(0, 4000);
  if (!job.art_status || job.art_status === 'needs_art') patch.art_status = 'art_requested';
  const { error: updateError } = await sb.from('so_jobs').update(patch)
    .eq('so_id', request.sales_order_id).eq('id', request.art_job_id);
  if (updateError) throw updateError;
  return { artRequestId, artStatus: patch.art_status || job.art_status, reused: false };
}

async function rollbackArtHandoff(sb, request, artRequestId) {
  if (!request?.art_job_id || !artRequestId) return;
  try {
    const { data: job } = await sb.from('so_jobs').select('art_status,art_requests')
      .eq('so_id', request.sales_order_id).eq('id', request.art_job_id).maybeSingle();
    if (!job) return;
    const remaining = (Array.isArray(job.art_requests) ? job.art_requests : []).filter((item) => item?.id !== artRequestId);
    const patch = { art_requests: remaining };
    if (job.art_status === 'art_requested' && !remaining.some((item) => ['requested', 'in_progress'].includes(item?.status))) patch.art_status = 'needs_art';
    await sb.from('so_jobs').update(patch).eq('so_id', request.sales_order_id).eq('id', request.art_job_id);
  } catch (error) { console.error('[methodic-workflow] art rollback:', error.message); }
}

async function listRequests(sb, body) {
  let query = sb.from('methodic_requests').select('*').order('updated_at', { ascending: false }).limit(1000);
  if (body.sales_order_id) query = query.eq('sales_order_id', cleanText(body.sales_order_id, 120));
  const { data, error } = await query;
  if (error) throw error;
  const ids = (data || []).map((row) => row.id);
  let events = [];
  if (ids.length) {
    const result = await sb.from('methodic_request_events').select('*').in('request_id', ids)
      .order('created_at', { ascending: false }).limit(3000);
    if (result.error) throw result.error;
    events = result.data || [];
  }
  return { requests: data || [], events };
}

async function createRequest(sb, body, actor) {
  const soId = cleanText(body.sales_order_id, 120);
  if (!soId) throw new Error('Choose a sales order.');
  const { data: so, error: soError } = await sb.from('sales_orders')
    .select('id,customer_id,created_by,deleted_at').eq('id', soId).maybeSingle();
  if (soError) throw soError;
  if (!so || so.deleted_at) throw new Error('The sales order was not found.');
  const { data: customer, error: customerError } = so.customer_id
    ? await sb.from('customers').select('id,primary_rep_id').eq('id', so.customer_id).maybeSingle()
    : { data: null, error: null };
  if (customerError) throw customerError;

  const patch = validatePatch(body, { create: true });
  const now = new Date().toISOString();
  const wantsPricing = patch.pricing_status === 'requested';
  const wantsMock = patch.mockup_status === 'requested';
  const wantsSample = patch.sample_status === 'requested';
  Object.assign(patch, {
    sales_order_id: so.id,
    customer_id: so.customer_id || null,
    rep_id: customer?.primary_rep_id || so.created_by || actor.teamMemberId,
    created_by: actor.teamMemberId,
    updated_by: actor.teamMemberId,
    pricing_requested_at: wantsPricing ? now : null,
    mockup_requested_at: wantsMock ? now : null,
    sample_requested_at: wantsSample ? now : null,
  });
  if (wantsMock && !patch.art_job_id) throw new Error('Choose an art job for the Methodic mockup request.');

  const { data: created, error } = await sb.from('methodic_requests').insert(patch).select('*').single();
  if (error) throw error;
  let handoffResult = null;
  try {
    if (wantsMock) {
      handoffResult = await handoffToArt(sb, created, actor);
      const nextPatch = {
        art_request_id: handoffResult.artRequestId,
        mockup_status: artStatusToMockup(handoffResult.artStatus),
        updated_by: actor.teamMemberId,
      };
      const saved = await sb.from('methodic_requests').update(nextPatch).eq('id', created.id).select('*').single();
      if (saved.error) throw saved.error;
      Object.assign(created, saved.data);
    }
    await addEvent(sb, created.id, actor.teamMemberId, 'request_created',
      `Methodic request created for ${created.sales_order_id}.`, { pricing: wantsPricing, mockup: wantsMock, sample: wantsSample });
    if (wantsMock) await addEvent(sb, created.id, actor.teamMemberId, 'art_requested',
      `Mockup sent to Art Dashboard job ${created.art_job_id}.`, { art_request_id: created.art_request_id });
    return created;
  } catch (handoffError) {
    if (handoffResult && !handoffResult.reused) await rollbackArtHandoff(sb, created, handoffResult.artRequestId);
    await sb.from('methodic_requests').delete().eq('id', created.id);
    throw handoffError;
  }
}

async function updateRequest(sb, body, actor) {
  const id = cleanText(body.id, 80);
  if (!id) throw new Error('Request id is required.');
  const { data: current, error: currentError } = await sb.from('methodic_requests').select('*').eq('id', id).maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new Error('Methodic request not found.');
  const patch = validatePatch(body);
  patch.updated_by = actor.teamMemberId;
  const now = new Date().toISOString();
  if (patch.pricing_status === 'requested' && current.pricing_status !== 'requested') patch.pricing_requested_at = now;
  if (patch.pricing_status === 'quoted' && current.pricing_status !== 'quoted') patch.quoted_at = now;
  if (patch.mockup_status === 'requested' && current.mockup_status !== 'requested') patch.mockup_requested_at = now;
  if (patch.sample_status === 'requested' && current.sample_status !== 'requested') patch.sample_requested_at = now;
  if (patch.sample_status === 'received' && current.sample_status !== 'received') patch.sample_received_at = now;
  if (patch.order_status === 'ordered' && current.order_status !== 'ordered') patch.ordered_at = now;
  if (patch.order_status === 'shipped' && current.order_status !== 'shipped') patch.shipped_at = now;
  if (patch.order_status === 'delivered' && current.order_status !== 'delivered') patch.delivered_at = now;

  const artJobChanged = Object.prototype.hasOwnProperty.call(patch, 'art_job_id') && patch.art_job_id !== current.art_job_id;
  if (artJobChanged && current.art_request_id) {
    patch.mockup_status = 'requested';
    patch.mockup_requested_at = now;
    patch.art_request_id = null;
  }
  let handoff = null;
  const merged = { ...current, ...patch };
  if (merged.pricing_status === 'quoted' && merged.quoted_unit_cost_cents == null) throw new Error('Enter the quoted unit cost before marking pricing quoted.');
  const sampleStillOpen = !['not_requested', 'approved', 'waived', 'cancelled'].includes(merged.sample_status);
  if (['ordered', 'confirmed', 'in_production', 'quality_check', 'shipped', 'delivered'].includes(merged.order_status) && sampleStillOpen) {
    throw new Error('Approve or waive the requested sample before ordering production.');
  }
  if (['ordered', 'confirmed', 'in_production', 'quality_check', 'shipped', 'delivered'].includes(merged.order_status) && !merged.purchase_order_number) {
    throw new Error('Add the National purchase order number before marking the Methodic order placed.');
  }
  if (['shipped', 'delivered'].includes(merged.order_status) && !merged.tracking_number && !merged.tracking_url) {
    throw new Error('Add shipment tracking before marking the Methodic order shipped.');
  }
  const shouldHandoff = merged.mockup_status === 'requested' && (!current.art_request_id || current.art_job_id !== merged.art_job_id);
  if (shouldHandoff) {
    handoff = await handoffToArt(sb, merged, actor);
    patch.art_request_id = handoff.artRequestId;
    patch.mockup_status = artStatusToMockup(handoff.artStatus);
  }
  const { data: saved, error } = await sb.from('methodic_requests').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  const changed = Object.keys(patch).filter((key) => key !== 'updated_by');
  await addEvent(sb, id, actor.teamMemberId, 'request_updated',
    `Updated ${changed.map((key) => key.replaceAll('_', ' ')).join(', ')}.`, { changed });
  if (handoff && !handoff.reused) await addEvent(sb, id, actor.teamMemberId, 'art_requested',
    `Mockup sent to Art Dashboard job ${saved.art_job_id}.`, { art_request_id: saved.art_request_id });
  return saved;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed.' });
  const actor = await verifyUser(event);
  if (!actor.ok) return reply(actor.status, { ok: false, error: actor.error });
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { ok: false, error: 'Invalid JSON.' }); }
  try {
    if (body.action === 'list') return reply(200, { ok: true, ...await listRequests(actor.admin, body) });
    if (body.action === 'create') return reply(200, { ok: true, request: await createRequest(actor.admin, body, actor) });
    if (body.action === 'update') return reply(200, { ok: true, request: await updateRequest(actor.admin, body, actor) });
    return reply(400, { ok: false, error: 'Unknown action.' });
  } catch (error) {
    console.error('[methodic-workflow]', error);
    const badInput = /required|invalid|choose|not found|enter|approve|waive|add the/i.test(error.message || '');
    return reply(badInput ? 400 : 500, { ok: false, error: error.message || 'Methodic workflow failed.' });
  }
};

exports._test = { validatePatch, cleanFiles, cleanSizes, artStatusToMockup, handoffToArt, rollbackArtHandoff };
