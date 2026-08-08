// DTF transfer order automation (migration 00235).
//
// Flow: sales/artists submit artwork (already uploaded to Cloudinary client-side,
// folder nsa-dtf-transfers) with print size / qty / outline option → requests
// queue up → a weekly scheduled sweep (netlify.toml cron) packs the queue onto a
// gang-sheet layout (_dtfLayout.js) and builds ONE batch → the batch is emailed
// to the DTF supplier (Brevo manifest, same transport as teamshop-auto-po.js)
// either automatically (dtf_settings.auto_send) or by staff from the DTF page →
// the supplier opens a token-gated portal (?dtfvendor=…, VENDOR_DTF_TOKEN — same
// trust model as vendor-digitizing.js) and marks the batch shipped with
// carrier + tracking, which flows back onto the batch and its requests.
//
// Write posture: dtf_requests / dtf_batches / dtf_settings have NO client write
// policy — every write happens here via the service role. Staff actions are JWT-
// verified (_shared.verifyUser); supplier actions are verified with a timing-safe
// compare against VENDOR_DTF_TOKEN (503 when unset — closed by default).
//
// Idempotency on the money-adjacent path (a batch emailed twice = supplier prints
// twice): build_batch CLAIMS requests first (CAS queued→batched, exactly like
// teamshop-auto-po.js sweepDtf), builds the batch only from the rows actually
// claimed, and rolls the claim back if the batch insert fails. send_batch CLAIMS
// the batch first (CAS draft→sent), emails, and rolls back to draft on a send
// failure — the claim-then-send order closes the "sent but still draft →
// re-sent" double-order window (same audit fix as autoSubmitPo).
//
// Degrades gracefully pre-migration: missing tables return { enabled:false } so
// the UI shows a banner, never a blank page.
const { corsHeaders, getSupabaseAdmin, verifyUser, verifyAdmin, safeEqualStr } = require('./_shared');
const { packGangSheet } = require('./_dtfLayout');
const { syncFromArt, DTF_ORDER_STATUS } = require('./_dtfArtSync');

const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ ok: false, error, ...(extra || {}) }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, ...body }) });

// Same missing-relation detection shape as teamshop-auto-po.js.
const isMissingRelation = (e) => {
  if (!e) return false;
  const code = e.code || '';
  const msg = (e.message || '') + ' ' + (e.details || '') + ' ' + (e.hint || '');
  return code === '42P01' || code === '42703' || code === '42883' || /does not exist|could not find|schema cache/i.test(msg);
};

const escHtml = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Mirrors shipstation-webhook.js's carrier link helper (small enough to keep in
// step by eye; pointer left there too).
function trackingUrl(carrier, num) {
  const c = (carrier || '').toLowerCase();
  if (!num) return '';
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${encodeURIComponent(num)}`;
  if (c.includes('usps') || c.includes('stamps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(num)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(num)}`;
}

const portalBase = () => (process.env.PORTAL_PUBLIC_URL || process.env.URL || 'https://nsa-portal.netlify.app').replace(/\/+$/, '');

async function loadSettings(admin) {
  const res = await admin.from('dtf_settings').select('*').eq('id', 1).maybeSingle();
  if (res.error) throw res.error;
  return res.data || { id: 1, sheet_width_in: 22, margin_in: 0.25, spacing_in: 0.5, auto_send: false, supplier_name: 'DTF Supplier' };
}

const layoutOpts = (settings) => ({
  sheetWidthIn: Number(settings.sheet_width_in) || 22,
  marginIn: Number(settings.margin_in) >= 0 ? Number(settings.margin_in) : 0.25,
  spacingIn: Number(settings.spacing_in) >= 0 ? Number(settings.spacing_in) : 0.5,
});

// ── Brevo email helpers ───────────────────────────────────────────────
async function sendBrevo({ to, cc, subject, html }) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) { console.error('[dtf-orders] BREVO_API_KEY missing — cannot send email'); return false; }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: to }],
      ...(cc ? { cc: [{ email: cc }] } : {}),
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) { console.error('[dtf-orders] Brevo send failed:', res.status, await res.text().catch(() => '')); return false; }
  return true;
}

function buildBatchEmailHtml(batch, requests, settings) {
  const cell = 'padding:5px 10px;border:1px solid #e2e8f0;font-size:13px';
  const rows = requests.map((r, i) => `<tr>
    <td style="${cell};text-align:right;color:#94a3b8">${i + 1}</td>
    <td style="${cell}"><strong>${escHtml(r.design_name)}</strong>${r.notes ? `<div style="color:#64748b;font-size:11px">${escHtml(r.notes)}</div>` : ''}</td>
    <td style="${cell};text-align:center">${Number(r.width_in)}&quot; × ${Number(r.height_in)}&quot;</td>
    <td style="${cell};text-align:right">${Number(r.qty)}</td>
    <td style="${cell};text-align:center">${r.outline ? 'YES' : '—'}</td>
    <td style="${cell}"><a href="${escHtml(r.file_url)}">${escHtml(r.file_name || 'download')}</a></td>
  </tr>`).join('');
  const vendorToken = process.env.VENDOR_DTF_TOKEN || '';
  const portalLink = vendorToken ? `${portalBase()}/?dtfvendor=${encodeURIComponent(vendorToken)}` : '';
  return `<div style="font-family:sans-serif;max-width:720px">
    <h2 style="margin-bottom:4px">DTF Transfer Order ${escHtml(batch.batch_number)}</h2>
    <p style="color:#475569;margin-top:0">National Sports Apparel — weekly DTF batch · ${Number(batch.total_prints) || requests.reduce((a, r) => a + (Number(r.qty) || 0), 0)} prints
      ${batch.sheet_length_in ? ` · est. ${Number(batch.sheet_width_in)}&quot; roll × ${Number(batch.sheet_length_in)}&quot;` : ''}</p>
    <table style="border-collapse:collapse;margin-top:10px">
      <thead><tr>
        <th style="${cell};text-align:right">#</th>
        <th style="${cell};text-align:left">Design</th>
        <th style="${cell}">Print size (W × H)</th>
        <th style="${cell};text-align:right">Qty</th>
        <th style="${cell}">White outline</th>
        <th style="${cell};text-align:left">Artwork</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${portalLink ? `<p style="font-size:14px;margin-top:16px"><a href="${escHtml(portalLink)}" style="background:#1e40af;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open supplier portal — download art, print layout &amp; mark shipped</a></p>` : ''}
    <p style="font-size:12px;color:#64748b;margin-top:14px">When the order ships, please mark it shipped with the tracking number${portalLink ? ' in the portal above' : ''} so our team is notified automatically.</p>
    <p style="font-size:11px;color:#94a3b8;margin-top:18px">Sent by the National Sports Apparel portal.</p>
  </div>`;
}

// ── Batch building ────────────────────────────────────────────────────
// Date-keyed batch number; unique-collision retried with a -2/-3… suffix
// (weekly cadence makes collisions rare; the unique index is the authority).
function batchNumberFor(date, attempt) {
  const d = date instanceof Date ? date : new Date(date);
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  return 'DTF-' + ymd + (attempt > 1 ? '-' + attempt : '');
}

// Claim queued requests (CAS queued→batched) and build one batch from what was
// actually claimed. actor: team member id or 'schedule'. Returns { batched:false }
// when the queue is empty. On batch-insert failure the claim is rolled back so
// the requests are re-swept next time, never stranded.
async function buildBatch(admin, actor) {
  const settings = await loadSettings(admin);
  const queuedRes = await admin.from('dtf_requests')
    .select('id, design_name, file_url, file_name, preview_url, width_in, height_in, qty, outline, notes')
    .eq('status', 'queued').order('created_at').limit(2000);
  if (queuedRes.error) throw queuedRes.error;
  const queued = queuedRes.data || [];
  if (!queued.length) return { batched: false, reason: 'queue_empty' };

  const claimRes = await admin.from('dtf_requests')
    .update({ status: 'batched', updated_at: new Date().toISOString() })
    .in('id', queued.map((r) => r.id)).eq('status', 'queued')
    .select('id');
  if (claimRes.error) throw new Error('DTF claim failed: ' + claimRes.error.message);
  const claimedIds = new Set((claimRes.data || []).map((r) => r.id));
  if (!claimedIds.size) return { batched: false, reason: 'already_claimed' };
  const claimed = queued.filter((r) => claimedIds.has(r.id));

  const layout = packGangSheet(claimed, layoutOpts(settings));

  let batch = null;
  let insErr = null;
  for (let attempt = 1; attempt <= 5 && !batch; attempt++) {
    const ins = await admin.from('dtf_batches').insert({
      batch_number: batchNumberFor(new Date(), attempt),
      status: 'draft',
      built_by: actor || 'schedule',
      sheet_width_in: layout.sheet_width_in,
      sheet_length_in: layout.sheet_length_in,
      total_prints: layout.total_prints,
      total_area_sqin: layout.total_area_sqin,
      layout,
    }).select('*').maybeSingle();
    if (!ins.error) { batch = ins.data; break; }
    insErr = ins.error;
    if (!/duplicate key|unique/i.test(ins.error.message || '')) break;
  }
  if (!batch) {
    // Release the claim so these requests are re-swept, not stranded as
    // 'batched' with no batch (same rollback shape as sweepDtf's PO failure).
    await admin.from('dtf_requests')
      .update({ status: 'queued', updated_at: new Date().toISOString() })
      .in('id', [...claimedIds]).eq('status', 'batched').is('batch_id', null);
    throw new Error('DTF batch insert failed: ' + (insErr && insErr.message));
  }

  const link = await admin.from('dtf_requests')
    .update({ batch_id: batch.id, updated_at: new Date().toISOString() })
    .in('id', [...claimedIds]).is('batch_id', null);
  if (link.error) console.error('[dtf-orders] batch_id link failed (recoverable):', link.error.message);

  return { batched: true, batch, requests: claimed, unplaced: layout.unplaced };
}

// CAS draft→sent, then email; roll the claim back to draft on a failed send so
// the batch is retried rather than stranded as 'sent' but never delivered.
async function sendBatch(admin, batchId, actor) {
  const settings = await loadSettings(admin);
  const toEmail = String(settings.supplier_email || '').trim();
  if (!toEmail) return { sent: false, reason: 'no_supplier_email' };

  const claim = await admin.from('dtf_batches')
    .update({ status: 'sent', sent_at: new Date().toISOString(), sent_to: toEmail })
    .eq('id', batchId).eq('status', 'draft')
    .select('*').maybeSingle();
  if (claim.error) return { sent: false, reason: 'claim_failed', error: claim.error.message };
  if (!claim.data) return { sent: false, reason: 'not_draft' };
  const batch = claim.data;

  const reqRes = await admin.from('dtf_requests')
    .select('id, design_name, file_url, file_name, width_in, height_in, qty, outline, notes')
    .eq('batch_id', batchId).neq('status', 'canceled').order('created_at');
  if (reqRes.error) {
    // Never email an empty/partial manifest: release the claim so the batch is
    // retried, exactly like a failed send.
    await admin.from('dtf_batches')
      .update({ status: 'draft', sent_at: null, sent_to: null })
      .eq('id', batchId).eq('status', 'sent');
    return { sent: false, reason: 'lines_unreadable', error: reqRes.error.message };
  }
  const requests = reqRes.data || [];

  const emailed = await sendBrevo({
    to: toEmail,
    cc: String(settings.cc_email || '').trim() || null,
    subject: 'DTF Transfer Order ' + batch.batch_number + ' — National Sports Apparel',
    html: buildBatchEmailHtml(batch, requests, settings),
  });
  if (!emailed) {
    await admin.from('dtf_batches')
      .update({ status: 'draft', sent_at: null, sent_to: null })
      .eq('id', batchId).eq('status', 'sent');
    return { sent: false, reason: 'email_failed' };
  }

  // Films are now ordered: clear the rep todo on the source jobs by advancing
  // art_status 'order_dtf_transfers' → 'art_complete' for art-synced requests
  // in this batch (CAS on the exact status so a job someone already moved is
  // never touched). Best-effort — the send already succeeded.
  try {
    const synced = await admin.from('dtf_requests')
      .select('so_id, job_id').eq('batch_id', batchId).eq('source', 'art_sync').neq('status', 'canceled');
    const pairs = (synced.data || []).filter((p) => p.so_id && p.job_id);
    for (const p of pairs) {
      const upd = await admin.from('so_jobs')
        .update({ art_status: 'art_complete' })
        .eq('so_id', p.so_id).eq('id', p.job_id).eq('art_status', DTF_ORDER_STATUS);
      if (upd.error && !isMissingRelation(upd.error)) console.error('[dtf-orders] art_status advance failed:', p.so_id, p.job_id, upd.error.message);
    }
  } catch (e) { console.error('[dtf-orders] art_status advance failed (best-effort):', e.message || e); }

  return { sent: true, batch_id: batchId, to: toEmail, actor: actor || null };
}

// ── Staff actions ─────────────────────────────────────────────────────
const SUBMIT_FIELDS = ['design_name', 'file_url', 'file_name', 'preview_url', 'width_in', 'height_in', 'qty', 'outline', 'notes', 'customer_id', 'so_id', 'job_id'];

function validateRequestPatch(body, { partial } = {}) {
  const out = {};
  for (const k of SUBMIT_FIELDS) {
    if (body[k] === undefined) continue;
    out[k] = body[k];
  }
  const errs = [];
  const need = (k) => !partial || out[k] !== undefined;
  if (need('design_name')) {
    out.design_name = String(out.design_name || '').trim();
    if (!out.design_name) errs.push('design_name required');
  }
  if (need('file_url')) {
    out.file_url = String(out.file_url || '').trim();
    if (!/^https:\/\//i.test(out.file_url)) errs.push('file_url must be an https URL');
  }
  for (const k of ['width_in', 'height_in']) {
    if (!need(k) && out[k] === undefined) continue;
    const v = Number(out[k]);
    if (!(v > 0) || v > 200) errs.push(k + ' must be between 0 and 200 inches');
    else out[k] = Math.round(v * 100) / 100;
  }
  if (need('qty') || out.qty !== undefined) {
    const q = Math.round(Number(out.qty));
    if (!(q > 0) || q > 10000) errs.push('qty must be 1–10000');
    else out.qty = q;
  }
  if (out.outline !== undefined) out.outline = out.outline === true;
  for (const k of ['file_name', 'preview_url', 'notes', 'customer_id', 'so_id', 'job_id']) {
    if (out[k] !== undefined) out[k] = String(out[k] || '').trim() || null;
  }
  return { patch: out, errors: errs };
}

async function listAll(admin) {
  // Best-effort art-sync first, so opening the page always shows the queue in
  // step with order state (jobs newly at 'order_dtf_transfers' appear without
  // waiting for the hourly sweep). Never blocks the list.
  let artSync = null;
  try { artSync = await syncFromArt(admin); }
  catch (e) { if (!isMissingRelation(e)) console.error('[dtf-orders] art sync (list) failed:', e.message || e); }

  const [settingsRes, reqRes, batchRes] = await Promise.all([
    admin.from('dtf_settings').select('*').eq('id', 1).maybeSingle(),
    admin.from('dtf_requests').select('*').order('created_at', { ascending: false }).limit(500),
    admin.from('dtf_batches').select('*').order('built_at', { ascending: false }).limit(100),
  ]);
  if (settingsRes.error || reqRes.error || batchRes.error) {
    const err = settingsRes.error || reqRes.error || batchRes.error;
    if (isMissingRelation(err)) return ok({ enabled: false, error: 'DTF migration (00235) not applied yet' });
    return bad(500, err.message);
  }
  const settings = settingsRes.data || null;
  const requests = reqRes.data || [];
  // Live preview of what the next weekly batch will look like.
  const queued = requests.filter((r) => r.status === 'queued');
  const preview = queued.length && settings ? packGangSheet(queued, layoutOpts(settings)) : null;
  return ok({
    enabled: true,
    settings,
    requests,
    batches: batchRes.data || [],
    preview,
    vendor_portal_configured: !!process.env.VENDOR_DTF_TOKEN,
    ...(artSync ? { art_sync: artSync } : {}),
  });
}

async function submitRequest(admin, body, actor) {
  const { patch, errors } = validateRequestPatch(body, { partial: false });
  if (errors.length) return bad(400, errors.join('; '));
  const ins = await admin.from('dtf_requests')
    .insert({ ...patch, status: 'queued', submitted_by: actor || 'staff' })
    .select('*').maybeSingle();
  if (ins.error) {
    if (isMissingRelation(ins.error)) return bad(409, 'DTF migration (00235) not applied yet.');
    return bad(500, ins.error.message);
  }
  return ok({ request: ins.data });
}

// Edit only while still queued — once batched the manifest may already be with
// the supplier, so edits would silently diverge from what they print.
async function updateRequest(admin, body) {
  const id = String(body.id || '').trim();
  if (!id) return bad(400, 'id required');
  const { patch, errors } = validateRequestPatch(body, { partial: true });
  if (errors.length) return bad(400, errors.join('; '));
  if (!Object.keys(patch).length) return bad(400, 'nothing to update');
  const upd = await admin.from('dtf_requests')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'queued')
    .select('*').maybeSingle();
  if (upd.error) return bad(500, upd.error.message);
  if (!upd.data) return bad(409, 'Request is no longer queued (already batched or canceled) — refresh.');
  return ok({ request: upd.data });
}

async function cancelRequest(admin, body, actor) {
  const id = String(body.id || '').trim();
  if (!id) return bad(400, 'id required');
  const upd = await admin.from('dtf_requests')
    .update({ status: 'canceled', canceled_at: new Date().toISOString(), canceled_by: actor || 'staff', updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'queued')
    .select('id,status').maybeSingle();
  if (upd.error) return bad(500, upd.error.message);
  if (!upd.data) return bad(409, 'Request is no longer queued — it may already be in a batch.');
  return ok({ request: upd.data });
}

async function markReceived(admin, body, actor) {
  const batchId = String(body.batch_id || '').trim();
  if (!batchId) return bad(400, 'batch_id required');
  const upd = await admin.from('dtf_batches')
    .update({ status: 'received', received_at: new Date().toISOString(), received_by: actor || 'staff' })
    .eq('id', batchId).in('status', ['sent', 'shipped'])
    .select('*').maybeSingle();
  if (upd.error) return bad(500, upd.error.message);
  if (!upd.data) return bad(409, 'Batch is not sent/shipped (already received, or still a draft) — refresh.');
  await admin.from('dtf_requests')
    .update({ status: 'received', updated_at: new Date().toISOString() })
    .eq('batch_id', batchId).in('status', ['batched', 'shipped']);
  return ok({ batch: upd.data });
}

const SETTINGS_FIELDS = ['supplier_name', 'supplier_email', 'cc_email', 'notify_email', 'sheet_width_in', 'margin_in', 'spacing_in', 'auto_send'];
async function saveSettings(admin, body, actor) {
  const patch = {};
  for (const k of SETTINGS_FIELDS) if (body[k] !== undefined) patch[k] = body[k];
  if (patch.sheet_width_in !== undefined && !(Number(patch.sheet_width_in) >= 5 && Number(patch.sheet_width_in) <= 100)) return bad(400, 'sheet_width_in must be 5–100');
  for (const k of ['margin_in', 'spacing_in']) if (patch[k] !== undefined && !(Number(patch[k]) >= 0 && Number(patch[k]) <= 5)) return bad(400, k + ' must be 0–5');
  if (patch.auto_send !== undefined) patch.auto_send = patch.auto_send === true;
  if (!Object.keys(patch).length) return bad(400, 'nothing to save');
  const upd = await admin.from('dtf_settings')
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString(), updated_by: actor || 'staff' })
    .select('*').maybeSingle();
  if (upd.error) {
    if (isMissingRelation(upd.error)) return bad(409, 'DTF migration (00235) not applied yet.');
    return bad(500, upd.error.message);
  }
  return ok({ settings: upd.data });
}

// ── Scheduled sweep ───────────────────────────────────────────────────
// Runs HOURLY (netlify.toml). Every run art-syncs (jobs newly waiting on DTF
// films become queued requests); the batch itself only builds inside the
// weekly window — Wednesdays 16:xx UTC — so the cadence the owner asked for
// is unchanged while the queue stays continuously up to date.
const inBatchWindow = (now) => {
  const d = now instanceof Date ? now : new Date(now);
  return d.getUTCDay() === 3 && d.getUTCHours() === 16;
};

// Build a batch from the queue; email it only when auto_send is on AND a
// supplier email is configured — otherwise the draft waits for staff review
// (default-inert, like every other auto lane in this repo).
async function weeklySweep(admin) {
  let built;
  try {
    built = await buildBatch(admin, 'schedule');
  } catch (e) {
    if (isMissingRelation(e)) return { ok: true, enabled: false, note: 'DTF migration (00235) not applied' };
    return { ok: false, error: e.message || String(e) };
  }
  if (!built.batched) return { ok: true, batched: false, reason: built.reason };
  const settings = await loadSettings(admin);
  let send = null;
  if (settings.auto_send === true && String(settings.supplier_email || '').trim()) {
    send = await sendBatch(admin, built.batch.id, 'schedule');
  }
  return {
    ok: true, batched: true, batch_id: built.batch.id, batch_number: built.batch.batch_number,
    prints: built.batch.total_prints, unplaced: (built.unplaced || []).length,
    ...(send ? { send } : { send: { sent: false, reason: settings.auto_send ? 'no_supplier_email' : 'auto_send_off' } }),
  };
}

// ── Supplier (vendor-token) actions ──────────────────────────────────
function checkVendorAuth(event) {
  const token = process.env.VENDOR_DTF_TOKEN;
  if (!token) return { ok: false, status: 503, error: 'VENDOR_DTF_TOKEN not configured' };
  const presented = (event.headers && (event.headers['x-vendor-token'] || event.headers['X-Vendor-Token'])) || (event.queryStringParameters && event.queryStringParameters.token);
  if (!safeEqualStr(presented, token)) return { ok: false, status: 401, error: 'Bad or missing vendor token' };
  return { ok: true };
}

// Curated, money-free / customer-PII-free feed (same philosophy as
// vendor-digitizing.js): batch number, dates, specs, art links, layout. No
// customer names, no so_id, no costs.
async function vendorList(admin) {
  const settings = await loadSettings(admin).catch(() => ({}));
  const batchRes = await admin.from('dtf_batches')
    .select('id, batch_number, status, sent_at, sheet_width_in, sheet_length_in, total_prints, layout, carrier, tracking_number, shipped_at')
    .in('status', ['sent', 'shipped'])
    .order('sent_at', { ascending: false })
    .limit(30);
  if (batchRes.error) {
    if (isMissingRelation(batchRes.error)) return ok({ batches: [] });
    return bad(500, batchRes.error.message);
  }
  const batches = batchRes.data || [];
  const ids = batches.map((b) => b.id);
  const reqRes = ids.length
    ? await admin.from('dtf_requests')
        .select('id, batch_id, design_name, file_url, file_name, preview_url, width_in, height_in, qty, outline, notes')
        .in('batch_id', ids).neq('status', 'canceled').order('created_at')
    : { data: [], error: null };
  if (reqRes.error) return bad(500, reqRes.error.message);
  const byBatch = {};
  (reqRes.data || []).forEach((r) => { (byBatch[r.batch_id] = byBatch[r.batch_id] || []).push(r); });
  return ok({
    supplier_name: settings.supplier_name || 'DTF Supplier',
    batches: batches.map((b) => ({ ...b, lines: byBatch[b.id] || [] })),
  });
}

async function vendorMarkShipped(admin, body) {
  const batchId = String(body.batch_id || '').trim();
  const carrier = String(body.carrier || '').trim();
  const tracking = String(body.tracking_number || '').trim();
  const note = String(body.note || '').trim();
  if (!batchId) return bad(400, 'batch_id required');
  if (!tracking) return bad(400, 'tracking_number required');
  if (tracking.length > 60 || carrier.length > 40 || note.length > 500) return bad(400, 'field too long');

  const upd = await admin.from('dtf_batches')
    .update({
      status: 'shipped',
      carrier: carrier || null,
      tracking_number: tracking,
      tracking_url: trackingUrl(carrier, tracking),
      shipped_at: new Date().toISOString(),
      shipped_note: note || null,
    })
    .eq('id', batchId).eq('status', 'sent')
    .select('*').maybeSingle();
  if (upd.error) return bad(500, upd.error.message);
  if (!upd.data) return bad(409, 'Batch is not awaiting shipment (already marked shipped, or not sent) — refresh.');
  const batch = upd.data;

  await admin.from('dtf_requests')
    .update({ status: 'shipped', updated_at: new Date().toISOString() })
    .eq('batch_id', batchId).eq('status', 'batched');

  // Best-effort heads-up to the team; the tracking is already on the batch, so
  // a failed email loses nothing load-bearing.
  try {
    const settings = await loadSettings(admin);
    const notify = String(settings.notify_email || '').trim();
    if (notify) {
      await sendBrevo({
        to: notify,
        subject: 'DTF batch ' + batch.batch_number + ' shipped — ' + (carrier || 'carrier n/a') + ' ' + tracking,
        html: `<div style="font-family:sans-serif;max-width:560px">
          <h3>DTF batch ${escHtml(batch.batch_number)} is on the way</h3>
          <p>${escHtml(settings.supplier_name || 'The DTF supplier')} marked it shipped${carrier ? ' via <strong>' + escHtml(carrier) + '</strong>' : ''}.</p>
          <p>Tracking: <a href="${escHtml(batch.tracking_url || '')}"><strong>${escHtml(tracking)}</strong></a></p>
          ${note ? `<p style="color:#64748b">Note from supplier: ${escHtml(note)}</p>` : ''}
          <p style="font-size:12px;color:#94a3b8">Sent by the NSA portal DTF lane.</p>
        </div>`,
      });
    }
  } catch (e) { console.error('[dtf-orders] ship notify failed (best-effort):', e.message || e); }

  return ok({ batch });
}

// ── Handler ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Scheduled (Netlify cron) invocation — hourly art-sync; weekly batch build
  // (+ optional auto-send) only inside the Wednesday window.
  if (!event || event.httpMethod !== 'POST') {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Service not configured' }) }; }
    try {
      let artSync = null;
      try { artSync = await syncFromArt(admin); }
      catch (e) { if (!isMissingRelation(e)) console.error('[dtf-orders] scheduled art sync failed:', e.message || e); }
      const r = inBatchWindow(new Date())
        ? await weeklySweep(admin)
        : { ok: true, batched: false, reason: 'outside_batch_window' };
      return { statusCode: 200, headers, body: JSON.stringify({ ...r, ...(artSync ? { art_sync: artSync } : {}) }) };
    } catch (e) {
      console.error('[dtf-orders] scheduled sweep failed:', e.message || e);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
    }
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }
  const action = String(body.action || '');

  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

  try {
    // Supplier-facing actions authenticate with the vendor token, never a JWT.
    if (action === 'vendor_list' || action === 'vendor_mark_shipped') {
      const auth = checkVendorAuth(event);
      if (!auth.ok) return bad(auth.status, auth.error);
      if (action === 'vendor_list') return await vendorList(admin);
      return await vendorMarkShipped(admin, body);
    }

    const auth = await verifyUser(event);
    if (!auth.ok) return bad(auth.status || 401, auth.error || 'Unauthorized');
    const actor = auth.teamMemberId || 'staff';

    if (action === 'list') return await listAll(admin);
    if (action === 'submit') return await submitRequest(admin, body, actor);
    if (action === 'update_request') return await updateRequest(admin, body);
    if (action === 'cancel_request') return await cancelRequest(admin, body, actor);
    if (action === 'build_batch') {
      const r = await buildBatch(admin, actor);
      if (r.batched && body.send === true) {
        const send = await sendBatch(admin, r.batch.id, actor);
        return ok({ batched: true, batch: r.batch, unplaced: r.unplaced, send });
      }
      return ok(r);
    }
    if (action === 'send_batch') {
      const r = await sendBatch(admin, String(body.batch_id || '').trim(), actor);
      return r.sent ? ok(r) : bad(422, 'Send failed: ' + r.reason, r);
    }
    if (action === 'mark_received') return await markReceived(admin, body, actor);
    if (action === 'save_settings') {
      // Settings decide WHERE supplier orders are emailed — admin only (the UI
      // hides the tab from non-admins, but the server is the boundary).
      const adm = await verifyAdmin(event);
      if (!adm.ok) return bad(adm.status || 403, adm.error || 'Admin role required');
      return await saveSettings(admin, body, actor);
    }
    return bad(400, 'Unknown action.');
  } catch (e) {
    if (isMissingRelation(e)) return ok({ enabled: false, error: 'DTF migration (00235) not applied yet' });
    console.error('[dtf-orders] error:', e);
    return bad(500, e.message || 'DTF action failed');
  }
};

// ── Test surface (src/__tests__/dtfOrders.test.js) ───────────────────
module.exports.buildBatchEmailHtml = buildBatchEmailHtml;
module.exports.batchNumberFor = batchNumberFor;
module.exports.validateRequestPatch = validateRequestPatch;
module.exports.checkVendorAuth = checkVendorAuth;
module.exports.trackingUrl = trackingUrl;
module.exports.buildBatch = buildBatch;
module.exports.sendBatch = sendBatch;
module.exports.weeklySweep = weeklySweep;
module.exports.vendorMarkShipped = vendorMarkShipped;
module.exports.inBatchWindow = inBatchWindow;
