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
const { brevoFetch, brevoConfigured } = require('./lib/brevo');

// Only these columns may be written from the portal — defends against a crafted
// payload setting arbitrary columns even though we don't validate the order id.
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

  const { jobs = [], artFiles = [], estimates = [], touchSO, email } = body;
  const admin = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const errors = [];

  try {
    for (const row of jobs) {
      if (!row?.so_id || !row?.id) continue;
      const patch = pick(row, JOB_COLS);
      if (!Object.keys(patch).length) continue;
      const { error } = await admin.from('so_jobs').update(patch).eq('so_id', row.so_id).eq('id', row.id);
      if (error) errors.push('so_jobs ' + row.id + ': ' + error.message);
    }

    for (const row of artFiles) {
      if (!row?.so_id || !row?.id) continue;
      const patch = pick(row, ART_COLS);
      if (!Object.keys(patch).length) continue;
      const { error } = await admin.from('so_art_files').update(patch).eq('so_id', row.so_id).eq('id', row.id);
      if (error) errors.push('so_art_files ' + row.id + ': ' + error.message);
    }

    for (const row of estimates) {
      if (!row?.id) continue;
      const patch = pick(row, EST_COLS);
      if (!Object.keys(patch).length) continue;
      const { error } = await admin.from('estimates').update(patch).eq('id', row.id);
      if (error) errors.push('estimates ' + row.id + ': ' + error.message);
    }

    if (touchSO) {
      const { error } = await admin.from('sales_orders').update({ updated_at: new Date().toLocaleString() }).eq('id', touchSO);
      if (error) errors.push('sales_orders ' + touchSO + ': ' + error.message);
    }
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  if (errors.length) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: errors.join('; ') }) };

  // Notify the rep. Failure here must not fail the approval — the write already succeeded.
  let emailSent = false, emailError = null;
  if (email && email.to) {
    if (!brevoConfigured()) {
      emailError = 'Brevo not configured';
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
        const r = await brevoFetch('/v3/smtp/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
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
