// Coach-portal write endpoint.
//
// The coach portal is a public link (?portal=<alpha_tag>) and runs as the
// Supabase `anon` role, which RLS only grants SELECT on sales_orders / so_jobs /
// so_art_files / estimates. So coach approvals, change-requests, and the emails
// they trigger never persisted — the browser write was silently rejected (401).
//
// This function performs those writes with the service-role key (bypassing RLS,
// same pattern as create-quote-request.js) and forwards the rep notification to
// Brevo using the server-side key so it isn't exposed to the browser.

const { createClient } = require('@supabase/supabase-js');

// Only these columns may be written from the portal — defends against a crafted
// payload setting arbitrary columns. Target rows are additionally verified to
// belong to the requesting portal's alpha_tag customer family (see below).
const JOB_COLS = new Set(['art_status', 'coach_approved_at', 'coach_approval_comment', 'coach_rejected', 'rejections', 'art_messages', 'art_requests', 'sent_to_coach_at']);
const ART_COLS = new Set(['status', 'notes']);
const EST_COLS = new Set(['status', 'approved_by', 'approved_at', 'update_requests', 'updated_at', 'email_status', 'email_viewed_at']);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const pick = (obj, allowed) => {
  const out = {};
  Object.keys(obj || {}).forEach(k => { if (allowed.has(k)) out[k] = obj[k]; });
  return out;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const sbUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Supabase service credentials missing' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { jobs = [], artFiles = [], estimates = [], touchSO, email, alphaTag } = body;
  const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const errors = [];

  // Ownership scoping: the portal link carries the customer's alpha_tag, so every
  // targeted SO/estimate must belong to that customer (or a sub-customer). Without
  // this, any caller could approve any estimate or patch any SO's allowlisted columns.
  if (!alphaTag || typeof alphaTag !== 'string' || !alphaTag.trim()) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'alphaTag required' }) };
  }
  let allowedSO = new Set(), allowedEst = new Set();
  try {
    const { data: parents, error: custErr } = await admin.from('customers').select('id').eq('alpha_tag', alphaTag.trim());
    if (custErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: custErr.message }) };
    if (!parents || !parents.length) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Unknown portal tag' }) };
    const parentIds = parents.map(p => p.id);
    const { data: kids, error: kidErr } = await admin.from('customers').select('id').in('parent_id', parentIds);
    if (kidErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: kidErr.message }) };
    const famIds = new Set([...parentIds, ...(kids || []).map(k => k.id)]);

    const soIds = [...new Set([...jobs, ...artFiles].map(r => r?.so_id).concat(touchSO ? [touchSO] : []).filter(Boolean))];
    if (soIds.length) {
      const { data: sos, error: soErr } = await admin.from('sales_orders').select('id,customer_id').in('id', soIds);
      if (soErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: soErr.message }) };
      (sos || []).forEach(s => { if (famIds.has(s.customer_id)) allowedSO.add(s.id); });
    }
    const estIds = [...new Set(estimates.map(r => r?.id).filter(Boolean))];
    if (estIds.length) {
      const { data: ests, error: estErr } = await admin.from('estimates').select('id,customer_id').in('id', estIds);
      if (estErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: estErr.message }) };
      (ests || []).forEach(e => { if (famIds.has(e.customer_id)) allowedEst.add(e.id); });
    }
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  try {
    for (const row of jobs) {
      if (!row?.so_id || !row?.id) continue;
      if (!allowedSO.has(row.so_id)) { errors.push('so_jobs ' + row.id + ': order not in this portal'); continue; }
      const patch = pick(row, JOB_COLS);
      if (!Object.keys(patch).length) continue;
      const { error } = await admin.from('so_jobs').update(patch).eq('so_id', row.so_id).eq('id', row.id);
      if (error) errors.push('so_jobs ' + row.id + ': ' + error.message);
    }

    for (const row of artFiles) {
      if (!row?.so_id || !row?.id) continue;
      if (!allowedSO.has(row.so_id)) { errors.push('so_art_files ' + row.id + ': order not in this portal'); continue; }
      const patch = pick(row, ART_COLS);
      if (!Object.keys(patch).length) continue;
      const { error } = await admin.from('so_art_files').update(patch).eq('so_id', row.so_id).eq('id', row.id);
      if (error) errors.push('so_art_files ' + row.id + ': ' + error.message);
    }

    for (const row of estimates) {
      if (!row?.id) continue;
      if (!allowedEst.has(row.id)) { errors.push('estimates ' + row.id + ': not in this portal'); continue; }
      const patch = pick(row, EST_COLS);
      if (!Object.keys(patch).length) continue;
      const { error } = await admin.from('estimates').update(patch).eq('id', row.id);
      if (error) errors.push('estimates ' + row.id + ': ' + error.message);
    }

    if (touchSO) {
      if (!allowedSO.has(touchSO)) { errors.push('sales_orders ' + touchSO + ': order not in this portal'); }
      else {
        const { error } = await admin.from('sales_orders').update({ updated_at: new Date().toLocaleString() }).eq('id', touchSO);
        if (error) errors.push('sales_orders ' + touchSO + ': ' + error.message);
      }
    }
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  if (errors.length) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: errors.join('; ') }) };

  // Notify the rep. Failure here must not fail the approval — the write already succeeded.
  let emailSent = false, emailError = null;
  if (email && email.to) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      emailError = 'BREVO_API_KEY not configured';
    } else {
      try {
        const payload = {
          sender: { name: email.senderName || 'NSA Portal', email: email.senderEmail || 'noreply@nationalsportsapparel.com' },
          to: Array.isArray(email.to) ? email.to : [{ email: email.to }],
          subject: email.subject,
          htmlContent: email.htmlContent || undefined,
        };
        if (email.replyTo) payload.replyTo = email.replyTo;
        if (email.cc) {
          const toSet = new Set(payload.to.map(t => (t.email || '').toLowerCase()));
          const cc = (Array.isArray(email.cc) ? email.cc : [email.cc]).filter(c => c && c.email && !toSet.has(c.email.toLowerCase()));
          if (cc.length) payload.cc = cc;
        }
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
          body: JSON.stringify(payload),
        });
        if (r.ok) emailSent = true;
        else { const d = await r.text(); emailError = 'Brevo ' + r.status + ': ' + d; }
      } catch (e) { emailError = e.message; }
    }
    if (emailError) console.error('[portal-action] email failed:', emailError);
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, emailSent, emailError }) };
};
