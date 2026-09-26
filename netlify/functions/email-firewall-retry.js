// Scheduled-only Netlify function: the platform does not expose scheduled
// functions as public URLs. No browser needs to remain open for this worker.
const { getSupabaseAdmin } = require('./_shared');
const { loadEmailRegistry } = require('./_emailRouter');
const { checkEmailRecipients } = require('../../src/lib/emailRouting');
const { sendViaGmail } = require('./_gmailSend');
const { TABLE, enabled, update, retryPlan, retryPayload, recipients } = require('./_emailFirewallRetry');

async function processRow(admin, row, registry, now = Date.now()) {
  // Read-only checks may be repeated after a crash; a send may not. Lease the
  // polling step, then durably transition to retrying BEFORE contacting Gmail.
  const lease = new Date(now + 5 * 60000).toISOString();
  const { data: claimed, error: claimError } = await admin.from(TABLE)
    .update({ next_check_at: lease, updated_at: new Date(now).toISOString() })
    .eq('id', row.id).eq('status', 'pending').eq('next_check_at', row.next_check_at).select('id');
  if (claimError || !claimed?.length) return 'skipped';
  if (!row.payload || new Date(row.expires_at).getTime() <= now) {
    await update(admin, row.id, { status: 'expired', payload: null }); return 'expired';
  }
  const { data: newer, error: newerError } = await admin.from(TABLE).select('id')
    .eq('fingerprint', row.fingerprint).gt('created_at', row.created_at).limit(1);
  if (newerError) throw new Error('Could not check for a newer send');
  if (newer?.length) {
    await update(admin, row.id, { status: 'done', error: 'A newer portal send supersedes this email; no automatic retry.' }); return 'superseded';
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/statistics/events?messageId=' + encodeURIComponent(row.original_message_id) + '&limit=100', {
    headers: { accept: 'application/json', 'api-key': process.env.BREVO_API_KEY },
  });
  if (!response.ok) throw new Error('Delivery lookup unavailable');
  const body = await response.json();
  if (!Array.isArray(body.events) || body.events.length >= 100) throw new Error('Delivery history incomplete');
  const plan = retryPlan(row.payload, body.events);
  if (!plan.retry.length) {
    if (plan.manual.length) await update(admin, row.id, { status: 'review', manual_recipients: plan.manual, error: 'Invalid, opted-out, suppressed or unclear recipients need review; no automatic resend.' });
    else if (plan.delivered.length === recipients(row.payload).length) await update(admin, row.id, { status: 'done', payload: null });
    return 'no-retry';
  }
  // Check all original recipients against current suppression history. The
  // current rejection does not override a newer opt-out or invalid-mailbox mark.
  const route = checkEmailRecipients(plan.retry, registry);
  if (route.dead.length || route.suppressed.length || plan.manual.length || plan.retry.length > 10 || (row.payload.attachment || []).some((a) => !a || a.url || !a.content)) {
    await update(admin, row.id, { status: 'review', manual_recipients: [...new Set([...plan.manual, ...plan.retry])], error: 'Automatic resend needs review: invalid/opted-out recipient, mixed failures, too many recipients, or linked attachment.' }); return 'review';
  }
  if (plan.retry.some((email) => registry.brevoOverrides?.has(email) || registry.brevoOverrides?.has(email.split('@')[1]))) {
    await update(admin, row.id, { status: 'review', error: 'Administrator Brevo override is active; automatic Gmail retry held.' }); return 'review';
  }
  const { data: ready, error: readyError } = await admin.from(TABLE)
    .update({ status: 'retrying', retry_recipients: plan.retry, rejection_events: body.events.filter(e => plan.retry.includes(String(e.email||'').trim().toLowerCase()) && /hard.?bounce/i.test(e.event||'')), updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'pending').eq('next_check_at', lease).select('id');
  if (readyError || !ready?.length) return 'skipped';
  const results = [];
  for (const email of plan.retry) {
    let result;
    try { result = await sendViaGmail(admin, retryPayload(row.payload, [email])); }
    catch (_) { result = { status: 502, uncertain: true, error: 'Gmail send outcome unknown; check Sent before retrying.' }; }
    const success = result.status >= 200 && result.status < 300 && !!result.messageId;
    results.push({ email, status: success ? 'sent' : 'review', messageId: result.messageId || null, from: result.from || null, at: new Date().toISOString(), error: success ? null : result.error || 'Gmail send outcome unknown' });
    // Persist after each recipient. Any crash leaves retrying, which is NEVER
    // selected again. This intentionally favors a manual check over duplicates.
    await update(admin, row.id, { retry_results: results });
    if (!success) break;
  }
  const success = results.length === plan.retry.length && results.every((r) => r.status === 'sent');
  await update(admin, row.id, { status: success ? 'resent' : 'review', payload: null, error: success ? null : 'Automatic Gmail resend needs review. Do not blindly resend.' });
  return success ? 'resent' : 'review';
}
exports.handler = async () => {
  if (!enabled()) return { statusCode: 200, body: JSON.stringify({ enabled: false }) };
  if (!process.env.BREVO_API_KEY) return { statusCode: 503, body: 'BREVO_API_KEY not configured' };
  const admin = getSupabaseAdmin();
  const started = Date.now();
  // Short retention for the original body/attachments. Keep status-only records
  // for 30 days so the portal can explain an automatic retry.
  const stale = await admin.from(TABLE).update({ status: 'review', error: 'Automatic Gmail attempt was interrupted. Check Sent before manually resending.' })
    .eq('status', 'retrying').lt('updated_at', new Date(started - 20 * 60000).toISOString());
  if (stale.error) throw stale.error;
  const retention = new Date(started - 7 * 86400000).toISOString();
  const cleanup = await admin.from(TABLE).update({ payload: null }).lt('created_at', retention).not('payload', 'is', null);
  if (cleanup.error) throw cleanup.error;
  const purge = await admin.from(TABLE).delete().lt('created_at', new Date(started - 30 * 86400000).toISOString());
  if (purge.error) throw purge.error;
  const { data: rows, error } = await admin.from(TABLE).select('*').eq('status', 'pending')
    .lte('next_check_at', new Date(started).toISOString()).order('next_check_at').limit(10);
  if (error) throw error;
  if (!rows?.length) return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  const registry = await loadEmailRegistry(admin);
  const outcomes = [];
  for (const row of rows) {
    if (Date.now() - started > 18000) break;
    try { outcomes.push(await processRow(admin, row, registry)); }
    catch (e) { console.error('[email-firewall-retry]', row.id, e.message); outcomes.push('error'); }
  }
  return { statusCode: 200, body: JSON.stringify({ processed: outcomes.length, outcomes }) };
};
exports.processRow = processRow;
