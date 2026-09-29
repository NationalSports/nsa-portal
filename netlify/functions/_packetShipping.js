const crypto = require('crypto');
const { sendBrevoEmail, escapeHtml } = require('./_webstoreNotifications');
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const urls = { ups: 'https://www.ups.com/track?tracknum=', fedex: 'https://www.fedex.com/fedextrack/?trknbr=', usps: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' };
function normalizeShipment(body, packet) {
  const soId = String(body.target_so_id || '');
  if (!packet.salesOrders.some(s => s.id === soId)) fail(403, 'Choose an SO in this packet.');
  const dpo = (packet.dpos || []).find(d => d.soId === soId && d.id === body.shipment_dpo_id);
  if (!dpo || (packet.dpo && (packet.dpo.id !== dpo.id || packet.dpo.soId !== soId))) fail(403, 'Choose a DPO in this packet.');
  const carrier = String(body.carrier || '');
  if (!urls[carrier]) fail(400, 'Choose UPS, FedEx, or USPS.');
  const tracking = String(body.tracking_number || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9-]{6,60}$/.test(tracking)) fail(400, 'Enter a valid tracking number (6–60 letters or digits).');
  const date = String(body.ship_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || Date.parse(date) > Date.now() + 86400000) fail(400, 'Enter a valid shipment date, not a future shipment.');
  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > dpo.coveredQuantity) fail(400, `Enter a whole garment quantity from 1 to ${dpo.coveredQuantity}.`);
  if (!['customer', 'nsa'].includes(body.destination)) fail(400, 'Choose whether this goes to the customer or NSA.');
  const notes = String(body.notes || '').trim();
  if (notes.length > 2000) fail(400, 'Shipment notes must be under 2,000 characters.');
  // One parcel per SO. A retry or resubmission cannot append it twice.
  const id = 'packet-shp-' + crypto.createHash('sha256').update(`${soId}|${carrier}|${tracking}`).digest('hex').slice(0,32);
  return { id, so_id: soId, dpo_id: dpo.id, dpo_number: dpo.number, carrier, tracking_number: tracking, tracking_url: urls[carrier] + encodeURIComponent(tracking), ship_date: date, quantity, destination: body.destination, notes, source: 'production_packet', manual: true, items: [], fulfillment: body.destination === 'customer', shipment_scope: body.destination === 'customer' ? 'customer' : 'deco_transfer' };
}
async function recordShipment(ctx, body, packet) {
  if (body.revision_id) fail(400, 'Open the live packet to record a shipment.');
  if (body.fingerprint !== packet.fingerprint) fail(409, 'Production details changed. Refresh before recording the shipment.');
  const recent = (packet.messages || []).filter(m => m.metadata?.type === 'shipment' && Date.now() - Date.parse(m.ts) < 60000);
  if (!ctx.staff && recent.length >= 10) fail(429, 'Please wait a minute before recording another shipment.');
  const shipment = normalizeShipment(body, packet);
  const { data, error } = await ctx.admin.rpc('record_production_packet_shipment', { p_store_id: ctx.storeId, p_link_id: ctx.link?.id || null, p_actor_id: ctx.staff ? ctx.actorId : null, p_shipment: shipment, p_expected_version: ctx.soVersions?.[shipment.so_id] ?? null });
  if (error) fail(409, error.message);
  return { ok: true, ...data };
}
async function drainShipmentEmails(admin) {
  const {data: rows, error} = await admin.rpc('claim_production_packet_shipment_emails');
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  for (const row of rows || []) {
    try {
      const {data: rep, error: repError} = await admin.from('team_members').select('email,name').eq('id', row.rep_id).maybeSingle();
      if (repError || !rep?.email) throw new Error('Assigned rep email is unavailable; update their team member record.');
      const s = row.shipment, e = escapeHtml;
      const destination = s.destination === 'customer' ? 'Customer delivery — review for invoicing' : 'Return to NSA — receipt and fulfillment review needed';
      const url = `https://connect.nationalsportsapparel.com/?pg=orders&so=${encodeURIComponent(row.so_id)}`;
      const messageId = await sendBrevoEmail({ sender: {name:'NSA Production',email:'stores@nationalsportsapparel.com'}, to:[{email:rep.email,name:rep.name||''}], subject:`${row.so_id} shipment reported · ${s.dpo_number}`, htmlContent:`<h2>${e(row.so_id)}: shipment reported</h2><p>${e(destination)}</p><p>${e(s.quantity)} garments · ${e(s.dpo_number)} · ${e(s.ship_date)}</p><p>${e(s.carrier.toUpperCase())}: <a href="${e(s.tracking_url)}">${e(s.tracking_number)}</a></p><p>${e(s.notes)}</p><p><a href="${e(url)}">Open SO tracking and review invoicing</a></p><p>This report does not confirm complete fulfillment or create an invoice. Check remaining quantities and prior invoices.</p>` }, row.id, 5000);
      const {error: saved} = await admin.from('production_packet_shipment_emails').update({status:'sent',sent_at:new Date().toISOString(),locked_at:null,provider_message_id:messageId,last_error:null}).eq('id',row.id).eq('status','processing').eq('attempts',row.attempts);
      if (saved) throw new Error(saved.message);
      sent++;
    } catch (err) {
      failed++;
      const {error: saved} = await admin.from('production_packet_shipment_emails').update({status:'pending',locked_at:null,available_at:new Date(Date.now()+Math.min(360,2**Math.min(row.attempts,9))*60000).toISOString(),last_error:String(err.message).slice(0,1000)}).eq('id',row.id).eq('status','processing').eq('attempts',row.attempts);
      if (saved) console.error('[packet-shipment-email] retry persistence failed', saved.message);
    }
  }
  return {sent,failed};
}
module.exports = {normalizeShipment,recordShipment,drainShipmentEmails};
