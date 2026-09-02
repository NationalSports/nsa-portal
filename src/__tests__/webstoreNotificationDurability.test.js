/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const {
  escapeHtml,
  safeHttpUrl,
  trackingUrl,
  buildCustomerStaffEmail,
  buildShipmentCustomerEmail,
  sendBrevoEmail,
} = require('../../netlify/functions/_webstoreNotifications');

describe('durable webstore notification rendering', () => {
  const previousPortal = process.env.PORTAL_PUBLIC_URL;

  beforeEach(() => {
    process.env.PORTAL_PUBLIC_URL = 'https://portal.example.com';
  });

  afterAll(() => {
    if (previousPortal == null) delete process.env.PORTAL_PUBLIC_URL;
    else process.env.PORTAL_PUBLIC_URL = previousPortal;
  });

  test('escapes customer text and rejects active-content image URLs', () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');

    const email = buildCustomerStaffEmail({
      order: { buyer_name: '<img src=x>', buyer_email: 'buyer@example.com', omg_order_number: '1&2' },
      store: { name: '<Store>' },
      message: { text: '<script>bad()</script>' },
      recipients: [{ email: 'stores@nationalsportsapparel.com', name: 'Team' }],
    });
    expect(email.htmlContent).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(email.htmlContent).not.toContain('<script>');
  });

  test('shipment email uses quantity-aware remaining count and token tracker link', () => {
    const email = buildShipmentCustomerEmail({
      order: { buyer_name: 'Pat', buyer_email: 'pat@example.com', status_token: 'private token' },
      store: { name: 'Falcons', logo_url: 'javascript:bad()', primary_color: '#001122', accent_color: '#dd1122' },
      shipment: {
        tracking_number: '1Z 123', carrier: 'ups',
        items: [{ name: 'Training Tee', qty: 2, image: 'javascript:bad()' }],
      },
      remainingUnits: 3,
    });

    expect(email.subject).toBe('Part of your Falcons order shipped');
    expect(email.htmlContent).toContain('remaining 3 items');
    expect(email.htmlContent).toContain('/shop/order/private%20token');
    expect(email.htmlContent).not.toContain('javascript:');
    expect(trackingUrl('UPS', '1Z 123')).toContain('1Z%20123');
  });
});

describe('Brevo delivery contract', () => {
  const previousKey = process.env.BREVO_API_KEY;

  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  afterAll(() => {
    if (previousKey == null) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = previousKey;
  });

  test('uses the durable outbox UUID as Brevo idempotency key', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: '<provider-id>' }) });
    const providerId = await sendBrevoEmail({ to: [{ email: 'x@example.com' }] }, '876e4567-e89b-12d3-a456-426614174000');
    expect(providerId).toBe('<provider-id>');
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ idempotencyKey: '876e4567-e89b-12d3-a456-426614174000' }),
    }));
  });

  test('throws on provider rejection so the outbox can retry', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: 'unavailable' }) });
    await expect(sendBrevoEmail({ to: [] }, '876e4567-e89b-12d3-a456-426614174000'))
      .rejects.toThrow('Brevo returned HTTP 503: unavailable');
  });
});

describe('outbox and webhook durability guards', () => {
  test('migration atomically inserts message + outbox and claims with row locks', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260902032343_webstore_notification_outbox.sql'), 'utf8');
    expect(sql).toMatch(/insert into public\.messages[\s\S]+insert into public\.webstore_notification_outbox/);
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/complete_webstore_notification[\s\S]+set emailed = true/i);
    expect(sql).toMatch(/revoke all on public\.webstore_notification_outbox from public, anon, authenticated/i);
  });

  test('ShipStation failures are retryable and duplicate shipments resume work', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../netlify/functions/shipstation-webhook.js'), 'utf8');
    expect(source).toMatch(/Non-2xx is intentional: ShipStation must retry/);
    expect(source).toMatch(/return result\(500, \{ received: false/);
    expect(source).toMatch(/Resume from its row/);
    expect(source).not.toMatch(/if \(existing && existing\.length\) continue/);
  });
});
