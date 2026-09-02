/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const {
  isScheduled,
  alertRecipients,
  runRuntimeCanary,
  buildAlertEmail,
  runSweep,
} = require('../../netlify/functions/webstore-integrity-sweep');

describe('webstore integrity runtime canary', () => {
  const oldRecipients = process.env.WEBSTORE_INTEGRITY_ALERT_EMAILS;

  afterEach(() => {
    if (oldRecipients == null) delete process.env.WEBSTORE_INTEGRITY_ALERT_EMAILS;
    else process.env.WEBSTORE_INTEGRITY_ALERT_EMAILS = oldRecipients;
  });

  test('exercises message escaping and token-scoped shipment rendering without I/O', () => {
    expect(runRuntimeCanary()).toBe(true);
  });

  test('deduplicates the configured operations recipients', () => {
    process.env.WEBSTORE_INTEGRITY_ALERT_EMAILS = 'Stores@example.com; tam@example.com,stores@example.com';
    expect(alertRecipients()).toEqual([{ email: 'stores@example.com' }, { email: 'tam@example.com' }]);
  });

  test('renders incident details safely and does not claim to repair ambiguous data', () => {
    const email = buildAlertEmail([{
      incident_key: 'message:1', category: 'message_missing_outbox', severity: 'critical',
      summary: '<script>Customer message</script>', record_type: 'message', record_id: 'm-1',
      details: { order_id: '<bad>' },
    }]);
    expect(email.subject).toContain('1 issue');
    expect(email.htmlContent).toContain('&lt;script&gt;Customer message&lt;/script&gt;');
    expect(email.htmlContent).not.toContain('<script>');
    expect(email.htmlContent).toMatch(/did not move money or buy postage/i);
  });

  test('recognizes Netlify schedules and rejects an ordinary request shape', () => {
    expect(isScheduled({ headers: { 'x-nf-event': 'schedule' } })).toBe(true);
    expect(isScheduled({ body: JSON.stringify({ next_run: 'soon' }) })).toBe(true);
    expect(isScheduled({ headers: {}, body: '{}' })).toBe(false);
  });
});

describe('webstore integrity orchestration', () => {
  test('runs the database scan and cleanly no-ops when no alert is queued', async () => {
    const rpc = jest.fn(async (name) => {
      if (name === 'sync_webstore_integrity_incidents') {
        return { data: { finding_count: 0, open_incident_count: 0, resolved_count: 1 }, error: null };
      }
      if (name === 'claim_webstore_integrity_alert') return { data: [], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    await expect(runSweep({ rpc })).resolves.toEqual({
      ok: true, finding_count: 0, open_incident_count: 0, resolved_count: 1,
      alert_claimed: false, alert_sent: false,
    });
  });
});

describe('database integrity monitor contract', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260902110000_webstore_integrity_monitor.sql'), 'utf8');
  const followup = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260902111500_webstore_integrity_monitor_followup.sql'), 'utf8');

  test('covers messages, notification delivery, shipment ledgers, money ledgers, and access boundaries', () => {
    expect(sql).toMatch(/message_missing_outbox/);
    expect(sql).toMatch(/notification_delivery_stuck/);
    expect(sql).toMatch(/labeled_order_missing_ledger/);
    expect(sql).toMatch(/shipment_line_quantity_mismatch/);
    expect(sql).toMatch(/webstore_batch_missing_invoice/);
    expect(sql).toMatch(/webstore_refund_ledger_mismatch/);
    expect(sql).toMatch(/anonymous_sensitive_table_access/);
    expect(sql).toMatch(/service_rpc_client_access/);
  });

  test('persists, resolves, deduplicates, claims, and completes alerts', () => {
    expect(sql).toMatch(/create table if not exists public\.webstore_integrity_incidents/);
    expect(sql).toMatch(/resolved_at = now\(\)/);
    expect(sql).toMatch(/create table if not exists public\.webstore_integrity_alert_outbox/);
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/complete_webstore_integrity_alert/);
    expect(sql).toMatch(/last_alerted_at = now\(\)/);
  });

  test('keeps monitor tables and RPCs service-only', () => {
    expect(sql).toMatch(/revoke all on public\.%I from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.scan_webstore_integrity\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.sync_webstore_integrity_incidents\(\) to service_role/);
    expect(sql).toMatch(/service role required/);
    expect(followup).toMatch(/scan_webstore_integrity_monitor_rpcs/);
    expect(followup).toMatch(/distinct on \(all_findings\.incident_key\)/);
    expect(followup).toMatch(/existing\.resolved_at/);
    expect(followup).toMatch(/v_alert_version/);
  });
});
