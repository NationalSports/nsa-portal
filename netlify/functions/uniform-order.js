// Authoritative custom-uniform order lifecycle.
//
// Public actions require an unpredictable per-order token. Staff actions require
// a signed-in active team member. All writes use the server-side service role;
// the browser never receives it and never writes an order table directly.
const crypto = require('crypto');
const { corsHeaders, getSupabaseAdmin, verifyUser, pickCols } = require('./_shared');
const { sendCustomerEmail, sendStaffEmail } = require('./_uniformOrderEmail');
const { authoritativeUniformQuote } = require('./_uniformPricing');

const PUBLIC_ORDER_FIELDS = 'id,order_number,public_token,team_name,sport,contact_name,contact_email,total_qty,unit_price,total,public_unit_price,discount_percent,discount_total,pricing_breakdown,fulfillment,production_status,payment_status,proof_version,approved_proof_version,approved_at,locked_at,production_started_at,quality_checked_at,carrier,tracking_number,tracking_url,shipped_at,delivered_at,thumb,back_thumb,parent_order_id,created_at,updated_at';
const STAFF_ORDER_FIELDS = `${PUBLIC_ORDER_FIELDS},customer_id,sales_order_id,converted_at,config,spec,bottom_spec,roster,status,po_number,po_contact,stripe_intent_id,assigned_rep_id,rep_review_notes,last_customer_note`;
const PRODUCTION_STATUSES = new Set(['submitted', 'rep_review', 'proof_ready', 'changes_requested', 'approved', 'production', 'quality_check', 'shipped', 'delivered', 'cancelled']);
const PAYMENT_STATUSES = new Set(['unpaid', 'pending', 'paid', 'po_terms', 'refunded', 'void']);
const CREATE_KEYS = new Set(['team_name', 'sport', 'contact_name', 'contact_email', 'config', 'spec', 'bottom_spec', 'roster', 'total_qty', 'unit_price', 'total', 'public_unit_price', 'discount_percent', 'discount_total', 'pricing_breakdown', 'fulfillment', 'status', 'po_number', 'po_contact', 'stripe_intent_id', 'thumb', 'back_thumb']);

const response = (statusCode, body, extraHeaders = {}) => ({ statusCode, headers: { ...corsHeaders(), ...extraHeaders }, body: JSON.stringify(body) });
const cleanText = (value, max = 200) => String(value == null ? '' : value).trim().slice(0, max);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const clientRef = (value) => cleanText(value, 100) || crypto.randomUUID();

async function verifyCardIntent(body, ref, email, orderTotal) {
  const intentId = cleanText(body.stripe_intent_id, 120);
  if (!intentId) return { rejected: 'A confirmed Stripe payment reference is required.' };
  const secret = process.env.STRIPE_SECRET_KEY;
  // Never lose a paid order because Stripe is temporarily unavailable. The
  // order is recorded as pending, not paid, and staff can reconcile it safely.
  if (!secret) return { paymentStatus: 'pending', verification: 'stripe_not_configured' };
  let intent;
  try {
    const stripe = require('stripe')(secret);
    intent = await stripe.paymentIntents.retrieve(intentId);
  } catch (error) {
    console.error('[uniform-order] Stripe verification:', error.message);
    return { paymentStatus: 'pending', verification: 'stripe_unavailable' };
  }
  const expectedReference = `uniform-${ref}`;
  const expectedSubtotalCents = Math.round(Math.max(0, Number(orderTotal) || 0) * 100);
  const expectedFeeCents = Math.round(expectedSubtotalCents * 0.029);
  const expectedChargeCents = expectedSubtotalCents + expectedFeeCents;
  if (intent.currency !== 'usd' || intent.metadata?.invoice_id !== expectedReference) return { rejected: 'The Stripe payment does not match this uniform order.' };
  if (Math.abs(Number(intent.amount || 0) - expectedChargeCents) > 2) return { rejected: 'The Stripe payment amount does not match this uniform order.' };
  if (intent.receipt_email && String(intent.receipt_email).toLowerCase() !== email) return { rejected: 'The Stripe payment email does not match this order.' };
  if (intent.status === 'succeeded') return { paymentStatus: 'paid', verification: 'stripe_succeeded' };
  if (intent.status === 'processing') return { paymentStatus: 'pending', verification: 'stripe_processing' };
  return { rejected: 'The Stripe payment has not completed.' };
}

async function createUniformPaymentIntent(order, method) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe is not configured.');
  const stripe = require('stripe')(secret);
  const paymentMethod = method === 'bank' ? 'bank' : 'card';
  const subtotalCents = Math.round(Math.max(0, Number(order.total) || 0) * 100);
  const feeCents = paymentMethod === 'card' ? Math.round(subtotalCents * 0.029) : 0;
  const amount = subtotalCents + feeCents;
  const intent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    payment_method_types: paymentMethod === 'bank' ? ['us_bank_account'] : ['card'],
    metadata: {
      invoice_id: `uniform-${order.id}`,
      uniform_order_id: order.id,
      uniform_order_number: order.order_number || '',
      source: 'uniform_builder',
    },
    receipt_email: order.contact_email,
    description: `NSA custom uniform ${order.order_number || order.id} - ${order.team_name}`,
  }, { idempotencyKey: `uniform-${order.id}-${paymentMethod}-v1` });
  return { intent, paymentMethod, subtotalCents, feeCents, amount };
}

async function recordEvent(sb, orderId, eventType, actorType, actorName, message, metadata = {}) {
  const { error } = await sb.from('uniform_order_events').insert({ order_id: orderId, event_type: eventType, actor_type: actorType, actor_name: actorName || null, message: message || null, metadata });
  if (error) console.error('[uniform-order] event insert:', error.message);
}

async function safeNotify(sb, order, kind, context = {}, staffToo = false) {
  try {
    const customer = await sendCustomerEmail(order, kind, context);
    const staff = staffToo ? await sendStaffEmail(order, kind, context) : null;
    const sent = !!customer?.sent && (!staffToo || !!staff?.sent);
    await recordEvent(sb, order.id, sent ? 'notification_sent' : 'notification_skipped', 'system', null, sent ? `Email sent: ${kind}` : `Email queued but delivery is not configured: ${kind}`, { kind, customer, staff });
  } catch (error) {
    console.error('[uniform-order] notification:', error.message);
    await recordEvent(sb, order.id, 'notification_failed', 'system', null, `Email could not be sent: ${kind}`, { kind, error: cleanText(error.message, 500) });
  }
}

function publicOrder(order) {
  if (!order) return null;
  const { public_token, ...safe } = order;
  return { ...safe, token: public_token };
}

async function findByToken(sb, orderNumber, token, fields = PUBLIC_ORDER_FIELDS) {
  const number = cleanText(orderNumber, 40);
  const secret = cleanText(token, 80);
  if (!number || !secret) return null;
  const { data, error } = await sb.from('uniform_order_requests').select(fields).eq('order_number', number).eq('public_token', secret).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadPublicStatus(sb, order) {
  const [{ data: proofs, error: proofErr }, { data: events, error: eventErr }] = await Promise.all([
    sb.from('uniform_order_proofs').select('version,front_image,back_image,note,sent_at,customer_decision,customer_note,decided_at,created_at').eq('order_id', order.id).order('version', { ascending: false }),
    sb.from('uniform_order_events').select('event_type,actor_type,message,metadata,created_at').eq('order_id', order.id).order('created_at', { ascending: true }).order('id', { ascending: true }),
  ]);
  if (proofErr) throw proofErr;
  if (eventErr) throw eventErr;
  return { order: publicOrder(order), proofs: proofs || [], events: (events || []).filter((e) => !String(e.event_type || '').startsWith('notification_')) };
}

async function createOrder(sb, body) {
  const ref = clientRef(body.client_ref);
  const email = cleanText(body.contact_email, 200).toLowerCase();
  const name = cleanText(body.contact_name, 120);
  const qty = Math.floor(Number(body.total_qty));
  if (!name || !validEmail(email)) return response(400, { ok: false, error: 'Enter your name and a valid email.' });
  if (!Number.isFinite(qty) || qty < 1 || qty > 1000) return response(400, { ok: false, error: 'Add at least one valid rostered jersey.' });
  if (!['card', 'po', 'manual'].includes(body.fulfillment)) return response(400, { ok: false, error: 'Choose a valid payment option.' });

  // The server owns all money fields. A modified browser can request a quote,
  // but it cannot choose the amount written to the order or accepted by Stripe.
  const authoritative = await authoritativeUniformQuote(sb, { ...body, contact_email: email, total_qty: qty });
  const quote = authoritative.quote;
  const orderTotal = quote.coachTotal;
  let cardVerification = null;
  if (body.fulfillment === 'card') {
    cardVerification = await verifyCardIntent(body, ref, email, orderTotal);
    if (cardVerification.rejected) return response(409, { ok: false, error: cardVerification.rejected });
  }

  const { data: prior, error: priorErr } = await sb.from('uniform_order_requests').select(STAFF_ORDER_FIELDS).eq('client_ref', ref).maybeSingle();
  if (priorErr) throw priorErr;
  if (prior) {
    if (String(prior.contact_email || '').toLowerCase() !== email) return response(409, { ok: false, error: 'This submission reference is already in use.' });
    return response(200, { ok: true, reused: true, ...await loadPublicStatus(sb, prior) });
  }

  const row = pickCols(body, CREATE_KEYS);
  row.client_ref = ref;
  row.contact_name = name;
  row.contact_email = email;
  row.team_name = cleanText(body.team_name, 160) || 'Team';
  row.sport = cleanText(body.sport, 60) || null;
  row.total_qty = qty;
  row.customer_id = authoritative.customer ? authoritative.customer.id : null;
  row.unit_price = quote.coachUnit;
  row.total = orderTotal;
  row.public_unit_price = quote.publicUnit;
  row.discount_percent = quote.discountPercent;
  row.discount_total = quote.savingsTotal;
  row.production_status = 'submitted';
  row.payment_status = body.fulfillment === 'card' ? cardVerification.paymentStatus : body.fulfillment === 'po' ? 'po_terms' : 'unpaid';
  row.status = body.fulfillment === 'card' ? (cardVerification.paymentStatus === 'paid' ? 'paid' : 'pending_payment') : body.fulfillment === 'po' ? 'po_submitted' : 'queued';
  row.config = body.config && typeof body.config === 'object' ? body.config : {};
  row.spec = body.spec && typeof body.spec === 'object' ? body.spec : {};
  row.bottom_spec = body.bottom_spec && typeof body.bottom_spec === 'object' ? body.bottom_spec : null;
  row.roster = Array.isArray(body.roster) ? body.roster.slice(0, 1000) : [];
  row.pricing_breakdown = { ...quote, policySource: 'uniform_settings/pricing_policy', pricedAt: new Date().toISOString() };

  let { data: order, error } = await sb.from('uniform_order_requests').insert(row).select(STAFF_ORDER_FIELDS).single();
  if (error && error.code === '23505') {
    const retry = await sb.from('uniform_order_requests').select(STAFF_ORDER_FIELDS).eq('client_ref', ref).maybeSingle();
    order = retry.data;
    error = retry.error;
  }
  if (error || !order) throw error || new Error('The order was not created.');

  await recordEvent(sb, order.id, 'order_submitted', 'coach', name, 'Order submitted', { fulfillment: order.fulfillment, payment_status: order.payment_status, payment_verification: cardVerification?.verification || null });
  await safeNotify(sb, order, 'confirmation', {}, true);
  return response(201, { ok: true, ...await loadPublicStatus(sb, order) });
}

async function prepareCardOrder(sb, body) {
  const ref = clientRef(body.client_ref);
  const email = cleanText(body.contact_email, 200).toLowerCase();
  const name = cleanText(body.contact_name, 120);
  const qty = Math.floor(Number(body.total_qty));
  if (!name || !validEmail(email)) return response(400, { ok: false, error: 'Enter your name and a valid email.' });
  if (!Number.isFinite(qty) || qty < 1 || qty > 1000) return response(400, { ok: false, error: 'Add at least one valid rostered jersey.' });
  const method = body.method === 'bank' ? 'bank' : 'card';
  const authoritative = await authoritativeUniformQuote(sb, { ...body, contact_email: email, total_qty: qty });
  const quote = authoritative.quote;

  let { data: order, error: findError } = await sb.from('uniform_order_requests').select(STAFF_ORDER_FIELDS).eq('client_ref', ref).maybeSingle();
  if (findError) throw findError;
  if (order && String(order.contact_email || '').toLowerCase() !== email) return response(409, { ok: false, error: 'This checkout reference is already in use.' });
  if (order && order.payment_status === 'paid') return response(409, { ok: false, error: `Order ${order.order_number} is already paid.` });

  if (!order) {
    const row = pickCols(body, CREATE_KEYS);
    Object.assign(row, {
      client_ref: ref,
      contact_name: name,
      contact_email: email,
      team_name: cleanText(body.team_name, 160) || 'Team',
      sport: cleanText(body.sport, 60) || null,
      total_qty: qty,
      customer_id: authoritative.customer ? authoritative.customer.id : null,
      unit_price: quote.coachUnit,
      total: quote.coachTotal,
      public_unit_price: quote.publicUnit,
      discount_percent: quote.discountPercent,
      discount_total: quote.savingsTotal,
      pricing_breakdown: { ...quote, policySource: 'uniform_settings/pricing_policy', pricedAt: new Date().toISOString() },
      fulfillment: 'card',
      production_status: 'submitted',
      payment_status: 'pending',
      status: 'pending_payment',
      config: body.config && typeof body.config === 'object' ? body.config : {},
      spec: body.spec && typeof body.spec === 'object' ? body.spec : {},
      bottom_spec: body.bottom_spec && typeof body.bottom_spec === 'object' ? body.bottom_spec : null,
      roster: Array.isArray(body.roster) ? body.roster.slice(0, 1000) : [],
    });
    const inserted = await sb.from('uniform_order_requests').insert(row).select(STAFF_ORDER_FIELDS).single();
    if (inserted.error) throw inserted.error;
    order = inserted.data;
    await recordEvent(sb, order.id, 'checkout_started', 'coach', name, 'Secure checkout started', { method });
  } else {
    // A retry reuses the permanent order but refreshes its authoritative quote
    // and its latest garment snapshot while it is still unpaid. Once paid, the
    // production record is immutable.
    const updated = await sb.from('uniform_order_requests').update({
      contact_name: name,
      team_name: cleanText(body.team_name, 160) || 'Team',
      sport: cleanText(body.sport, 60) || null,
      total_qty: qty,
      customer_id: authoritative.customer ? authoritative.customer.id : null,
      unit_price: quote.coachUnit, total: quote.coachTotal,
      public_unit_price: quote.publicUnit, discount_percent: quote.discountPercent,
      discount_total: quote.savingsTotal,
      pricing_breakdown: { ...quote, policySource: 'uniform_settings/pricing_policy', pricedAt: new Date().toISOString() },
      config: body.config && typeof body.config === 'object' ? body.config : {},
      spec: body.spec && typeof body.spec === 'object' ? body.spec : {},
      bottom_spec: body.bottom_spec && typeof body.bottom_spec === 'object' ? body.bottom_spec : null,
      roster: Array.isArray(body.roster) ? body.roster.slice(0, 1000) : [],
      thumb: body.thumb || null,
      back_thumb: body.back_thumb || null,
    }).eq('id', order.id).select(STAFF_ORDER_FIELDS).single();
    if (updated.error) throw updated.error;
    order = updated.data;
  }

  const payment = await createUniformPaymentIntent(order, method);
  const pricing = {
    ...(order.pricing_breakdown || {}), paymentMethod: payment.paymentMethod,
    processingFee: payment.feeCents / 100, paymentChargeTotal: payment.amount / 100,
  };
  const saved = await sb.from('uniform_order_requests').update({ stripe_intent_id: payment.intent.id, pricing_breakdown: pricing }).eq('id', order.id).select(STAFF_ORDER_FIELDS).single();
  if (saved.error) throw saved.error;
  return response(200, {
    ok: true,
    order: publicOrder(saved.data),
    clientSecret: payment.intent.client_secret,
    intentId: payment.intent.id,
    subtotal: quote.coachTotal,
    fee: payment.feeCents / 100,
    chargeTotal: payment.amount / 100,
    quote,
  });
}

async function finalizeCardOrder(sb, body) {
  const order = await findByToken(sb, body.order_number, body.token, STAFF_ORDER_FIELDS);
  if (!order) return response(404, { ok: false, error: 'We could not find that checkout.' });
  if (order.payment_status === 'paid') return response(200, { ok: true, reused: true, ...await loadPublicStatus(sb, order) });
  const intentId = cleanText(body.stripe_intent_id, 120);
  if (!intentId || intentId !== order.stripe_intent_id) return response(409, { ok: false, error: 'The payment does not match this uniform order.' });
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return response(503, { ok: false, error: 'Stripe verification is temporarily unavailable.' });
  const intent = await require('stripe')(secret).paymentIntents.retrieve(intentId);
  const expectedCents = Math.round(Number(order.pricing_breakdown?.paymentChargeTotal || 0) * 100);
  if (intent.currency !== 'usd' || intent.metadata?.uniform_order_id !== order.id || Number(intent.amount) !== expectedCents) return response(409, { ok: false, error: 'The Stripe payment does not match this uniform order.' });
  if (!['succeeded', 'processing'].includes(intent.status)) return response(409, { ok: false, error: 'The payment has not completed.' });
  const paymentStatus = intent.status === 'succeeded' ? 'paid' : 'pending';
  const updated = await sb.from('uniform_order_requests').update({
    payment_status: paymentStatus,
    status: paymentStatus === 'paid' ? 'paid' : 'pending_payment',
  }).eq('id', order.id).select(STAFF_ORDER_FIELDS).single();
  if (updated.error) throw updated.error;
  await recordEvent(sb, order.id, paymentStatus === 'paid' ? 'payment_received' : 'payment_processing', 'coach', order.contact_name, paymentStatus === 'paid' ? 'Card payment received' : 'Bank payment is processing', { stripe_intent_id: intent.id });
  await safeNotify(sb, updated.data, 'confirmation', {}, true);
  return response(200, { ok: true, ...await loadPublicStatus(sb, updated.data) });
}

async function customerDecision(sb, body) {
  const order = await findByToken(sb, body.order_number, body.token, STAFF_ORDER_FIELDS);
  if (!order) return response(404, { ok: false, error: 'We could not find that order.' });
  const decision = body.decision === 'approved' ? 'approved' : body.decision === 'changes_requested' ? 'changes_requested' : '';
  if (!decision) return response(400, { ok: false, error: 'Choose approve or request changes.' });
  if (!order.proof_version) return response(409, { ok: false, error: 'A proof has not been published yet.' });
  if (order.locked_at) return response(409, { ok: false, error: 'This order is already locked for production.' });
  const note = cleanText(body.note, 2000);
  if (decision === 'changes_requested' && !note) return response(400, { ok: false, error: 'Tell us what should change.' });
  const now = new Date().toISOString();
  const proofUpdate = { customer_decision: decision, customer_note: note || null, decided_at: now };
  const { error: proofErr } = await sb.from('uniform_order_proofs').update(proofUpdate).eq('order_id', order.id).eq('version', order.proof_version);
  if (proofErr) throw proofErr;
  const orderUpdate = decision === 'approved'
    ? { production_status: 'approved', approved_proof_version: order.proof_version, approved_at: now, approved_by_name: order.contact_name, approved_by_email: order.contact_email, last_customer_note: note || null }
    : { production_status: 'changes_requested', approved_proof_version: null, approved_at: null, approved_by_name: null, approved_by_email: null, last_customer_note: note };
  const { data: updated, error } = await sb.from('uniform_order_requests').update(orderUpdate).eq('id', order.id).select(STAFF_ORDER_FIELDS).single();
  if (error) throw error;
  await recordEvent(sb, order.id, decision === 'approved' ? 'proof_approved' : 'changes_requested', 'coach', order.contact_name, decision === 'approved' ? `Proof version ${order.proof_version} approved` : `Changes requested for proof version ${order.proof_version}`, { version: order.proof_version, note });
  await safeNotify(sb, updated, decision, { note }, true);
  return response(200, { ok: true, ...await loadPublicStatus(sb, updated) });
}

async function reorder(sb, body) {
  const source = await findByToken(sb, body.order_number, body.token, STAFF_ORDER_FIELDS);
  if (!source) return response(404, { ok: false, error: 'We could not find that order.' });
  if (!source.locked_at && source.production_status !== 'delivered') return response(409, { ok: false, error: 'Reorder becomes available after the original order is approved and locked.' });
  const row = pickCols(source, CREATE_KEYS);
  delete row.stripe_intent_id;
  delete row.po_number;
  row.client_ref = clientRef(body.client_ref);
  row.parent_order_id = source.id;
  row.fulfillment = 'manual';
  row.status = 'queued';
  row.production_status = 'submitted';
  row.payment_status = 'unpaid';
  row.contact_name = cleanText(body.contact_name, 120) || source.contact_name;
  row.contact_email = cleanText(body.contact_email, 200).toLowerCase() || source.contact_email;
  const { data: created, error } = await sb.from('uniform_order_requests').insert(row).select(STAFF_ORDER_FIELDS).single();
  if (error) throw error;
  await recordEvent(sb, created.id, 'reorder_created', 'coach', created.contact_name, `Reorder created from ${source.order_number}`, { source_order_id: source.id, source_order_number: source.order_number });
  await safeNotify(sb, created, 'confirmation', { note: `Reorder of ${source.order_number}` }, true);
  return response(201, { ok: true, ...await loadPublicStatus(sb, created) });
}

async function publishProof(sb, body, staff) {
  const id = cleanText(body.order_id, 80);
  const { data: order, error: findErr } = await sb.from('uniform_order_requests').select(STAFF_ORDER_FIELDS).eq('id', id).maybeSingle();
  if (findErr) throw findErr;
  if (!order) return response(404, { ok: false, error: 'Order not found.' });
  if (order.locked_at) return response(409, { ok: false, error: 'The order is locked for production.' });
  const version = Number(order.proof_version || 0) + 1;
  const note = cleanText(body.note, 2000);
  const snapshot = { config: order.config, spec: order.spec, bottom_spec: order.bottom_spec, roster: order.roster, total_qty: order.total_qty, pricing_breakdown: order.pricing_breakdown };
  const now = new Date().toISOString();
  const { error: proofErr } = await sb.from('uniform_order_proofs').insert({ order_id: order.id, version, snapshot, front_image: body.front_image || order.thumb || null, back_image: body.back_image || order.back_thumb || null, note: note || null, created_by: staff.teamMemberId, sent_at: now });
  if (proofErr) throw proofErr;
  const { data: updated, error } = await sb.from('uniform_order_requests').update({ proof_version: version, production_status: 'proof_ready', approved_proof_version: null, approved_at: null }).eq('id', order.id).select(STAFF_ORDER_FIELDS).single();
  if (error) throw error;
  await recordEvent(sb, order.id, 'proof_published', 'staff', staff.teamMemberId, `Proof version ${version} published`, { version, note });
  await safeNotify(sb, updated, 'proof_ready', { note });
  return response(200, { ok: true, order: updated });
}

async function lockOrder(sb, body, staff) {
  const { data: order, error: findErr } = await sb.from('uniform_order_requests').select(STAFF_ORDER_FIELDS).eq('id', cleanText(body.order_id, 80)).maybeSingle();
  if (findErr) throw findErr;
  if (!order) return response(404, { ok: false, error: 'Order not found.' });
  if (order.locked_at) return response(200, { ok: true, order });
  if (!order.approved_at || !order.approved_proof_version || order.approved_proof_version !== order.proof_version) return response(409, { ok: false, error: 'The latest proof must be approved before production can be locked.' });
  const now = new Date().toISOString();
  const { data: updated, error } = await sb.from('uniform_order_requests').update({ locked_at: now, locked_by: staff.teamMemberId }).eq('id', order.id).select(STAFF_ORDER_FIELDS).single();
  if (error) throw error;
  await recordEvent(sb, order.id, 'production_locked', 'staff', staff.teamMemberId, `Approved proof version ${order.proof_version} locked for production`, { version: order.proof_version });
  return response(200, { ok: true, order: updated });
}

async function staffUpdate(sb, body, staff) {
  const { data: order, error: findErr } = await sb.from('uniform_order_requests').select(STAFF_ORDER_FIELDS).eq('id', cleanText(body.order_id, 80)).maybeSingle();
  if (findErr) throw findErr;
  if (!order) return response(404, { ok: false, error: 'Order not found.' });
  const patch = {};
  if (body.production_status != null) {
    if (!PRODUCTION_STATUSES.has(body.production_status)) return response(400, { ok: false, error: 'Invalid production status.' });
    if (body.production_status === 'production' && !order.locked_at) return response(409, { ok: false, error: 'Lock the approved proof before starting production.' });
    if (body.production_status === 'shipped' && !cleanText(body.tracking_number || order.tracking_number, 200)) return response(409, { ok: false, error: 'Add tracking before marking the order shipped.' });
    patch.production_status = body.production_status;
    if (body.production_status === 'production') patch.production_started_at = order.production_started_at || new Date().toISOString();
    if (body.production_status === 'quality_check') patch.quality_checked_at = order.quality_checked_at || new Date().toISOString();
    if (body.production_status === 'shipped') patch.shipped_at = order.shipped_at || new Date().toISOString();
    if (body.production_status === 'delivered') patch.delivered_at = order.delivered_at || new Date().toISOString();
  }
  if (body.payment_status != null) {
    if (!PAYMENT_STATUSES.has(body.payment_status)) return response(400, { ok: false, error: 'Invalid payment status.' });
    patch.payment_status = body.payment_status;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'assigned_rep_id')) patch.assigned_rep_id = body.assigned_rep_id || null;
  if (Object.prototype.hasOwnProperty.call(body, 'rep_review_notes')) patch.rep_review_notes = cleanText(body.rep_review_notes, 4000) || null;
  if (Object.prototype.hasOwnProperty.call(body, 'carrier')) patch.carrier = cleanText(body.carrier, 80) || null;
  if (Object.prototype.hasOwnProperty.call(body, 'tracking_number')) patch.tracking_number = cleanText(body.tracking_number, 200) || null;
  if (Object.prototype.hasOwnProperty.call(body, 'tracking_url')) patch.tracking_url = cleanText(body.tracking_url, 500) || null;
  if (!Object.keys(patch).length) return response(400, { ok: false, error: 'Nothing to update.' });
  const { data: updated, error } = await sb.from('uniform_order_requests').update(patch).eq('id', order.id).select(STAFF_ORDER_FIELDS).single();
  if (error) throw error;
  const productionChanged = patch.production_status && patch.production_status !== order.production_status;
  const paymentChanged = patch.payment_status && patch.payment_status !== order.payment_status;
  if (productionChanged) {
    await recordEvent(sb, order.id, 'production_status_changed', 'staff', staff.teamMemberId, `Production status: ${patch.production_status.replace(/_/g, ' ')}`, { from: order.production_status, to: patch.production_status });
    if (['production', 'quality_check', 'shipped', 'delivered', 'cancelled'].includes(patch.production_status)) await safeNotify(sb, updated, patch.production_status);
  }
  if (paymentChanged) {
    await recordEvent(sb, order.id, 'payment_status_changed', 'staff', staff.teamMemberId, `Payment status: ${patch.payment_status.replace(/_/g, ' ')}`, { from: order.payment_status, to: patch.payment_status });
    await safeNotify(sb, updated, 'payment');
  }
  return response(200, { ok: true, order: updated });
}

async function staffConvert(sb, body, staff) {
  const orderId = cleanText(body.order_id, 80);
  const customerId = cleanText(body.customer_id, 100);
  if (!orderId || !customerId) return response(400, { ok: false, error: 'Choose a customer before conversion.' });
  const { data: salesOrderId, error } = await sb.rpc('convert_uniform_order_to_sales_order', {
    p_order_id: orderId,
    p_customer_id: customerId,
    p_actor: staff.teamMemberId || staff.userId || 'staff',
  });
  if (error) {
    if (/approved and locked/i.test(error.message || '')) return response(409, { ok: false, error: 'Approve and lock the latest proof before creating the sales order.' });
    if (/valid customer/i.test(error.message || '')) return response(400, { ok: false, error: 'Choose a valid customer before conversion.' });
    throw error;
  }
  return response(200, { ok: true, sales_order_id: salesOrderId });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Method not allowed.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return response(400, { ok: false, error: 'Invalid request.' }); }
  let sb;
  try { sb = getSupabaseAdmin(); } catch (error) { return response(503, { ok: false, error: 'Order service is not configured.' }); }

  try {
    if (body.action === 'prepare_card') return await prepareCardOrder(sb, body);
    if (body.action === 'finalize_card') return await finalizeCardOrder(sb, body);
    if (body.action === 'create') return await createOrder(sb, body);
    if (body.action === 'status') {
      const order = await findByToken(sb, body.order_number, body.token);
      return order ? response(200, { ok: true, ...await loadPublicStatus(sb, order) }) : response(404, { ok: false, error: 'We could not find that order.' });
    }
    if (body.action === 'customer_decision') return await customerDecision(sb, body);
    if (body.action === 'reorder') return await reorder(sb, body);

    const staff = await verifyUser(event);
    if (!staff.ok) return response(staff.status || 401, { ok: false, error: staff.error || 'Sign in required.' });
    if (body.action === 'staff_publish_proof') return await publishProof(sb, body, staff);
    if (body.action === 'staff_lock') return await lockOrder(sb, body, staff);
    if (body.action === 'staff_update') return await staffUpdate(sb, body, staff);
    if (body.action === 'staff_convert') return await staffConvert(sb, body, staff);
    return response(400, { ok: false, error: 'Unknown action.' });
  } catch (error) {
    console.error('[uniform-order]', body.action, error);
    return response(500, { ok: false, error: 'We could not complete that order action. Please try again.' });
  }
};

exports._test = { createOrder, prepareCardOrder, finalizeCardOrder, customerDecision, reorder, publishProof, lockOrder, staffUpdate, staffConvert, findByToken, verifyCardIntent };
