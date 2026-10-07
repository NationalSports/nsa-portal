const crypto = require('crypto');
const { escapeHtml: e, trackingUrl } = require('./_webstoreNotifications');

function noticeId(soId, shipmentIds, email, kind = 'warehouse') {
  const hex = crypto.createHash('sha256').update(JSON.stringify([kind, soId, [...shipmentIds].sort(), email.trim().toLowerCase()])).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

// Brevo expects the dedupe key in the JSON email headers, not HTTP headers.
// https://developers.brevo.com/docs/heterogenous-versions-batch-emails
async function sendRepEmail(payload, id) {
  const apiKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not configured');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ ...payload, headers: { ...payload.headers, idempotencyKey: id } }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && result.code !== 'duplicate_parameter') throw new Error(`Brevo HTTP ${response.status}: ${result.message || result.code || 'send failed'}`);
  // A duplicate key confirms Brevo already accepted this same notification.
  return result.messageId || result.message_id || null;
}

async function drainRepShipmentEmails(admin, id = null) {
  const { data: rows, error } = await admin.rpc('claim_so_rep_shipment_emails', { p_id: id });
  if (error) throw new Error(error.message);
  let sent = 0; let failed = 0;
  for (const row of rows || []) {
    try {
      const messageId = await sendRepEmail(row.payload, row.id);
      const { error: saved } = await admin.from('so_rep_shipment_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), provider_message_id: messageId, locked_at: null, last_error: null })
        .eq('id', row.id).eq('status', 'processing').eq('attempts', row.attempts);
      if (saved) throw new Error(saved.message);
      sent++;
    } catch (err) {
      failed++;
      const { error: saved } = await admin.from('so_rep_shipment_outbox').update({
        status: row.attempts >= 8 ? 'dead' : 'pending', locked_at: null,
        available_at: new Date(Date.now() + Math.min(60, 2 ** row.attempts) * 60000).toISOString(),
        last_error: String(err.message).slice(0, 1000),
      }).eq('id', row.id).eq('status', 'processing').eq('attempts', row.attempts);
      if (saved) console.error('[rep-shipment] could not save retry', saved.message);
      console.error('[rep-shipment] delivery failed', row.id, err.message);
    }
  }
  return { sent, failed };
}

async function queueRepShipmentEmail(admin, { soId, shipmentIds, payload, kind }) {
  const id = noticeId(soId, shipmentIds, payload.to[0].email, kind);
  const { error } = await admin.from('so_rep_shipment_outbox').upsert({ id, so_id: soId, payload }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`Could not queue rep email: ${error.message}`);
  await drainRepShipmentEmails(admin, id);
  const { data, error: readError } = await admin.from('so_rep_shipment_outbox').select('status,last_error').eq('id', id).single();
  if (readError) throw new Error(readError.message);
  if (data.status === 'dead') throw new Error(`Rep email needs attention: ${data.last_error}`);
  return { id, status: data.status === 'sent' ? 'sent' : 'queued' };
}

async function notifyShipmentRep(admin, { soId, shipmentIds, preview = false }) {
  const { data: so, error } = await admin.from('sales_orders')
    .select('id,customer_id,rep_id,created_by,memo,_shipments,_shipped,deleted_at').eq('id', soId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!so || so.deleted_at) throw new Error('Sales order not found');
  const { data: customer, error: customerError } = await admin.from('customers').select('name,primary_rep_id').eq('id', so.customer_id).maybeSingle();
  if (customerError) throw new Error(customerError.message);
  const repId = so.rep_id || customer?.primary_rep_id || so.created_by;
  if (!repId) throw new Error('Assign a rep to the order or customer first');
  const { data: rep, error: repError } = await admin.from('team_members').select('name,email').eq('id', repId).maybeSingle();
  if (repError) throw new Error(repError.message);
  if (!/^\S+@\S+\.\S+$/.test(String(rep?.email || '').trim())) throw new Error('Assigned rep has no valid email address');
  const requested = Array.isArray(shipmentIds) ? new Set(shipmentIds.map(String)) : null;
  const shipments = (so._shipments || []).filter(s => s && s.id && s.fulfillment !== false
    && !['deco_transfer','warehouse_transfer'].includes(s.shipment_scope) && (!requested || requested.has(String(s.id))));
  if (!shipments.length || (requested && shipments.length !== requested.size)) throw new Error('Choose saved customer shipments on this SO');
  const subject = `${so.id} shipment update — ${customer?.name || 'Customer'}`;
  const htmlContent = `<div style="font-family:Arial,sans-serif;color:#192853"><h2>${e(subject)}</h2><p>${e(so.memo)}</p>
    <p>Warehouse shipment records. This rep-only update does not send a customer notice or confirm carrier delivery.</p>
    ${shipments.map(s => `<h3>${e(s.ship_date || 'Date not recorded')}</h3><p>${s.tracking_number
      ? `<a href="${e(trackingUrl(s.carrier, s.tracking_number))}">${e(s.carrier || 'Tracking')}: ${e(s.tracking_number)}</a>`
      : 'Tracking not recorded.'} ${e(s.clear_memo || s.notes || '')}</p><ul>${(s.items || []).map(i => `<li>${e(i.name || i.sku)} — ${e(i.color)}: ${e(Object.entries(i.sizes || {}).filter(([,q]) => Number(q)>0).map(([sz,q]) => `${sz}: ${q}`).join(', '))}</li>`).join('')}</ul>`).join('')}
    <p>${so._shipped ? 'Portal status: marked fully shipped.' : 'Portal status: not fully shipped; check remaining quantities.'}</p>
    <p><a href="https://connect.nationalsportsapparel.com/?pg=orders&amp;so=${encodeURIComponent(so.id)}">Open SO tracking</a></p></div>`;
  const payload = { sender: { name: 'NSA Shipping Notices', email: 'noreply@nationalsportsapparel.com' }, to: [{ email: rep.email.trim(), name: rep.name || '' }], subject, htmlContent };
  if (preview) return { ok: true, to: rep.email.trim(), subject, html: htmlContent, shipments: shipments.length, shipmentIds: shipments.map(s => String(s.id)) };
  const result = await queueRepShipmentEmail(admin, { soId: so.id, shipmentIds: shipments.map(s => String(s.id)), payload, kind: 'warehouse' });
  return { ok: true, to: rep.email.trim(), ...result };
}
module.exports = { noticeId, queueRepShipmentEmail, drainRepShipmentEmails, notifyShipmentRep };
