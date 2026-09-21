// "Your order has shipped" — the coach-facing shipment notice for a sales order.
//
// The rep presses "Email Coach Tracking" on the order's Tracking tab; this
// function builds and sends the email. Content-locked in the same way as
// quote-notify.js: the caller supplies an ORDER ID (plus, optionally, which
// boxes and a delivery estimate) and nothing else. The recipient, the items,
// the mockups, the addresses and the tracking numbers are all read server-side
// from the order, so a crafted payload can't turn this into a mail relay from
// our verified sending domain.
//
// Staff-only on top of that (verifyUser), because it sends customer-facing mail.
//
// Layout lives in _soShipmentEmail.js (pure, unit-tested); this file is the IO.

const { verifyUser } = require('./_shared');
const { buildSoShipmentEmail, buildShipmentLines, carrierLabel } = require('./_soShipmentEmail');

const HEADERS = { 'Content-Type': 'application/json' };
const PORTAL_BASE = 'https://nationalsportsapparel.com/coach';
const NSA_LOGO = process.env.NSA_LOGO_URL || 'https://nationalsportsapparel.com/NEW%20NSA%20Logo%20on%20white.png';

const j = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: JSON.stringify(obj) });

// A box that went to a decorator is an internal transfer, not something the
// coach is waiting on. Only customer fulfillment reaches the email.
const isCustomerShipment = (s) => !!s && s.shipment_scope !== 'deco_transfer' && s.fulfillment !== false;

const unitsIn = (items) => (items || []).reduce((a, it) => a
  + Object.values((it && it.sizes) || {}).reduce((b, q) => b + (Number(q) || 0), 0), 0);

// "Hoodies · 46 pcs" — what's in the box, in the coach's words. One style names
// itself; several are counted.
function contentsSummary(items) {
  const names = [...new Set((items || []).map((it) => String((it && it.name) || (it && it.sku) || '').trim()).filter(Boolean))];
  const units = unitsIn(items);
  const label = names.length === 1 ? names[0] : `${names.length} styles`;
  if (!names.length) return units ? `${units} pcs` : '';
  return `${label} · ${units} pcs`;
}

// The coach greeting. A contact filed as the coach is addressed the way the
// school does it ("Coach Ramirez"); anyone else gets their first name.
function greetingName(contact) {
  const name = String((contact && contact.name) || '').trim();
  if (!name) return '';
  const role = String((contact && contact.role) || '');
  if (/coach/i.test(role)) return 'Coach ' + name.split(/\s+/).pop();
  return name.split(/\s+/)[0];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return j(405, { error: 'POST only' });

  const auth = await verifyUser(event);
  if (!auth.ok) return j(auth.status, { error: auth.error });

  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'Invalid JSON' }); }
  const soId = String(body.soId || '').trim();
  if (!soId) return j(400, { error: 'soId required' });
  const preview = body.preview === true;
  const resend = body.resend === true;
  // Free text the REP typed, never a merge field from elsewhere: a carrier ETA
  // isn't stored on the order. Bounded and HTML-escaped by the builder.
  const etaInput = String(body.eta || '').trim().slice(0, 40);
  const requestedIds = Array.isArray(body.shipmentIds) ? body.shipmentIds.map(String) : null;

  if (!preview && !brevoKey) return j(500, { error: 'BREVO_API_KEY not configured' });

  // verifyUser hands back the service-role client it already built.
  const admin = auth.admin;

  try {
    const { data: so, error: soErr } = await admin.from('sales_orders')
      .select('id,customer_id,ship_to_id,_shipments,_carrier,_ship_date,_tracking_number,_tracking_url,deliver_on_date,sent_history,deleted_at')
      .eq('id', soId).maybeSingle();
    if (soErr) return j(500, { error: soErr.message });
    if (!so || so.deleted_at) return j(404, { error: 'Sales order not found' });

    // ── Which boxes this notice covers ──
    const all = (Array.isArray(so._shipments) ? so._shipments : []).filter(isCustomerShipment);
    // An order shipped before per-box records existed carries its tracking on the
    // order itself; treat that as the single box so those orders can still notify.
    const legacy = (!all.length && so._tracking_number)
      ? [{ id: 'legacy', tracking_number: so._tracking_number, tracking_url: so._tracking_url || '', carrier: so._carrier || '', ship_date: so._ship_date || '', items: [] }]
      : [];
    const pool = all.length ? all : legacy;
    const selected = requestedIds ? pool.filter((s) => requestedIds.includes(String(s.id))) : pool;
    if (!selected.length) return j(409, { error: 'This order has no outbound shipments to notify about yet' });

    // ── Recipient: resolved from the order's customer, never from the caller ──
    const { data: customer, error: custErr } = await admin.from('customers')
      .select('id,name,alpha_tag,primary_rep_id,shipping_address_line1,shipping_city,shipping_state,shipping_zip,shipping_attention')
      .eq('id', so.customer_id).maybeSingle();
    if (custErr) return j(500, { error: custErr.message });
    if (!customer) return j(409, { error: 'Order has no customer on file' });

    const { data: contacts, error: ctErr } = await admin.from('customer_contacts')
      .select('name,email,role,sort_order').eq('customer_id', customer.id).order('sort_order');
    if (ctErr) return j(500, { error: ctErr.message });
    const withEmail = (contacts || []).filter((c) => c && /^\S+@\S+\.\S+$/.test(String(c.email || '').trim()));
    // A caller may name WHICH of the customer's contacts to write to; it can
    // never introduce an address the customer doesn't already have on file.
    const requestedTo = String(body.to || '').trim().toLowerCase();
    const recipient = requestedTo
      ? withEmail.find((c) => String(c.email).trim().toLowerCase() === requestedTo)
      : (withEmail.find((c) => /coach/i.test(String(c.role || ''))) || withEmail[0]);
    if (!preview && !recipient) {
      return j(409, { error: requestedTo ? 'That email is not a contact on this account' : 'No contact with an email address on this account' });
    }

    // ── Already-sent guard: the same boxes don't get announced twice ──
    const sentHistory = Array.isArray(so.sent_history) ? so.sent_history : [];
    const signature = selected.map((s) => String(s.id)).sort().join(',');
    const already = sentHistory.find((h) => h && h.type === 'shipment' && h.shipment_sig === signature);
    if (already && !resend && !preview) {
      return j(409, { error: `These boxes were already emailed to ${already.to || 'the customer'} on ${already.sent_at}`, alreadySent: already });
    }

    const [itemsRes, artRes, repRes] = await Promise.all([
      admin.from('so_items').select('id,sku,name,brand,color,item_index').eq('so_id', so.id).order('item_index'),
      admin.from('so_art_files').select('id,item_mockups,mockup_files,files,archived').eq('so_id', so.id),
      customer.primary_rep_id
        ? admin.from('team_members').select('id,name,email,phone').eq('id', customer.primary_rep_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (itemsRes.error) return j(500, { error: itemsRes.error.message });
    if (artRes.error) return j(500, { error: artRes.error.message });

    const soItems = itemsRes.data || [];
    const artFiles = (artRes.data || []).filter((a) => a && !a.archived);

    let decorationsByItemId = {};
    if (soItems.length) {
      const { data: decos, error: decoErr } = await admin.from('so_item_decorations')
        .select('so_item_id,kind,deco_type,art_tbd_type,type,colors,position,placement,deco_index')
        .in('so_item_id', soItems.map((i) => i.id)).order('deco_index');
      if (decoErr) return j(500, { error: decoErr.message });
      (decos || []).forEach((d) => {
        if (!decorationsByItemId[d.so_item_id]) decorationsByItemId[d.so_item_id] = [];
        decorationsByItemId[d.so_item_id].push(d);
      });
    }

    const packages = selected.map((s, i) => ({
      index: i + 1,
      trackingNumber: s.tracking_number || '',
      trackingUrl: s.tracking_url || '',
      carrier: s.carrier || so._carrier || '',
      contents: contentsSummary(s.items),
      items: s.items || [],
    }));

    const lines = buildShipmentLines({ packages, soItems, decorationsByItemId, artFiles });
    if (!lines.length) {
      // Boxes with no recorded contents (a manually added shipment) still carry
      // real tracking — the coach gets the tracking, just no item list.
      console.warn('[so-shipment-notify] no line items resolved for', so.id);
    }

    // Ship-to: the order's own ship_to customer when it overrides the default,
    // mirroring resolveShipToClient in src/lib/botTasks.js.
    let shipCustomer = customer;
    if (so.ship_to_id && so.ship_to_id !== 'default' && so.ship_to_id !== customer.id) {
      const { data: alt } = await admin.from('customers')
        .select('name,shipping_address_line1,shipping_city,shipping_state,shipping_zip')
        .eq('id', so.ship_to_id).maybeSingle();
      if (alt) shipCustomer = alt;
    }
    const shipTo = (shipCustomer.shipping_address_line1 || shipCustomer.shipping_city) ? {
      name: shipCustomer.name || '',
      line1: shipCustomer.shipping_address_line1 || '',
      city: shipCustomer.shipping_city || '',
      state: shipCustomer.shipping_state || '',
      zip: shipCustomer.shipping_zip || '',
    } : null;

    const rep = repRes && repRes.data ? { name: repRes.data.name || '', email: repRes.data.email || '', phone: repRes.data.phone || '' } : null;
    const portalUrl = customer.alpha_tag
      ? `${PORTAL_BASE}?portal=${encodeURIComponent(customer.alpha_tag)}&so=${encodeURIComponent(so.id)}`
      : '';
    const reorderUrl = customer.alpha_tag
      ? `${PORTAL_BASE}?portal=${encodeURIComponent(customer.alpha_tag)}&page=shop`
      : '';

    const { subject, html } = buildSoShipmentEmail({
      order: { id: so.id },
      teamName: customer.name || '',
      coachName: greetingName(recipient),
      shipTo,
      rep,
      lines,
      packages,
      shipDate: selected[0].ship_date || so._ship_date || '',
      eta: etaInput || so.deliver_on_date || '',
      carrier: selected[0].carrier || so._carrier || '',
      portalUrl,
      reorderUrl,
      logoUrl: NSA_LOGO,
    });

    if (preview) {
      return j(200, {
        ok: true,
        preview: true,
        subject,
        html,
        to: recipient ? { email: recipient.email, name: recipient.name || '' } : null,
        contacts: withEmail.map((c) => ({ email: c.email, name: c.name || '', role: c.role || '' })),
        boxes: packages.length,
        pieces: lines.reduce((a, l) => a + l.totalQty, 0),
        alreadySent: already || null,
      });
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
      body: JSON.stringify({
        sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
        to: [{ email: recipient.email, name: recipient.name || '' }],
        // A coach replying about a short size must reach their rep, not a black hole.
        ...(rep && rep.email ? { replyTo: { email: rep.email, name: rep.name || '' } } : {}),
        subject,
        htmlContent: html,
      }),
    });
    let result = null;
    try { result = await res.json(); } catch { result = null; }
    if (!res.ok) {
      const detail = result && (result.message || result.code) ? `: ${result.message || result.code}` : '';
      console.error('[so-shipment-notify] Brevo send failed', res.status, detail);
      return j(502, { error: `Email send failed (HTTP ${res.status})${detail}` });
    }

    // Audit trail + the guard above. Append only: email_status/email_sent_at on a
    // sales order mean "the ORDER document was emailed" and must not be rewritten
    // by a shipping notice.
    const histEntry = {
      sent_at: new Date().toLocaleString(),
      sent_by: auth.teamMemberId || auth.userId || 'portal',
      type: 'shipment',
      to: recipient.email,
      messageId: (result && (result.messageId || result.message_id)) || null,
      shipment_sig: signature,
      boxes: packages.length,
    };
    const { error: histErr } = await admin.from('sales_orders')
      .update({ sent_history: [...sentHistory, histEntry] }).eq('id', so.id);
    if (histErr) console.warn('[so-shipment-notify] sent_history not persisted:', histErr.message);

    return j(200, {
      ok: true,
      to: recipient.email,
      subject,
      boxes: packages.length,
      pieces: lines.reduce((a, l) => a + l.totalQty, 0),
      carrier: carrierLabel(selected[0].carrier || so._carrier || ''),
      historyRecorded: !histErr,
    });
  } catch (e) {
    console.error('[so-shipment-notify] failed:', e);
    return j(500, { error: e.message });
  }
};
