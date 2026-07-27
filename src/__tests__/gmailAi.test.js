const { parseMessage, buildMime, getAccessToken, sendReply } = require('../../netlify/functions/_gmailAi');
const {
  extractForwardedMessage,
  cartPayloadForMessage,
} = require('../../netlify/functions/_repEmailAgent');

const enc = (value) => Buffer.from(value).toString('base64url');

test('parseMessage extracts sender, thread headers, body, and attachment metadata', () => {
  const parsed = parseMessage({
    id: 'gmail-1',
    threadId: 'thread-1',
    internalDate: String(Date.UTC(2026, 6, 26)),
    snippet: 'Need a quote',
    payload: {
      headers: [
        { name: 'From', value: 'Coach Rivera <coach@example.com>' },
        { name: 'To', value: 'sales@nationalsportsapparel.com' },
        { name: 'Subject', value: 'Jersey quote' },
        { name: 'Message-ID', value: '<message-1@example.com>' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: enc('Please quote 12 jerseys.') } },
        { mimeType: 'application/pdf', filename: 'roster.pdf', body: { attachmentId: 'att-1', size: 1234 } },
      ],
    },
  });

  expect(parsed.gmail_message_id).toBe('gmail-1');
  expect(parsed.gmail_thread_id).toBe('thread-1');
  expect(parsed.sender_email).toBe('coach@example.com');
  expect(parsed.sender_name).toBe('Coach Rivera');
  expect(parsed.text_body).toBe('Please quote 12 jerseys.');
  expect(parsed.attachment_meta[0]).toMatchObject({ filename: 'roster.pdf', attachment_id: 'att-1' });
});

test('buildMime creates a threaded multipart reply with a PDF attachment', () => {
  const raw = buildMime({
    to: 'coach@example.com',
    subject: 'Re: Jersey quote',
    text: 'Attached is the estimate.',
    html: '<p>Attached is the estimate.</p>',
    inReplyTo: '<message-1@example.com>',
    references: '<older@example.com> <message-1@example.com>',
    attachments: [{ name: 'EST-1234.pdf', mime_type: 'application/pdf', content: Buffer.from('pdf').toString('base64') }],
  });

  expect(raw).toContain('To: coach@example.com');
  expect(raw).toContain('In-Reply-To: <message-1@example.com>');
  expect(raw).toContain('References: <older@example.com> <message-1@example.com>');
  expect(raw).toContain('Content-Type: application/pdf; name="EST-1234.pdf"');
  expect(raw).toContain(Buffer.from('pdf').toString('base64'));
});

test('sendReply sends the verified-rep acknowledgement in the original Gmail thread', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'sent-ack-1', threadId: 'thread-1' }),
  });
  try {
    const sent = await sendReply('access-token', {
      sender_email: 'rep@nationalsportsapparel.com',
      subject: 'FPU request',
      gmail_thread_id: 'thread-1',
      internet_message_id: '<message-1@example.com>',
      references_header: '<older@example.com>',
    }, {
      text: 'We received your AI request.',
      html: '<p>We received your AI request.</p>',
    });
    expect(sent.id).toBe('sent-ack-1');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/messages/send'),
      expect.objectContaining({ method: 'POST' }),
    );
    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request.threadId).toBe('thread-1');
    const raw = Buffer.from(request.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: rep@nationalsportsapparel.com');
    expect(raw).toContain('We received your AI request.');
  } finally {
    global.fetch = originalFetch;
  }
});

test('getAccessToken refuses to use a refresh token belonging to a personal mailbox', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  };
  process.env.GMAIL_CLIENT_ID = 'client-id';
  process.env.GMAIL_CLIENT_SECRET = 'client-secret';
  process.env.GMAIL_REFRESH_TOKEN = 'refresh-token';
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'access-token' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emailAddress: 'steve@nationalsportsapparel.com' }),
    });
  try {
    await expect(getAccessToken()).rejects.toThrow(
      /authorized as steve@nationalsportsapparel\.com; expected sales@nationalsportsapparel\.com/
    );
  } finally {
    global.fetch = originalFetch;
    if (originalEnv.clientId === undefined) delete process.env.GMAIL_CLIENT_ID;
    else process.env.GMAIL_CLIENT_ID = originalEnv.clientId;
    if (originalEnv.clientSecret === undefined) delete process.env.GMAIL_CLIENT_SECRET;
    else process.env.GMAIL_CLIENT_SECRET = originalEnv.clientSecret;
    if (originalEnv.refreshToken === undefined) delete process.env.GMAIL_REFRESH_TOKEN;
    else process.env.GMAIL_REFRESH_TOKEN = originalEnv.refreshToken;
  }
});

test('extractForwardedMessage separates an authorized rep instruction from Gmail forwarded content', () => {
  const parsed = extractForwardedMessage(
    `Process the latest FPU Basketball estimate and prepare the CLICK cart.

---------- Forwarded message ---------
From: Coach Rivera <coach@example.com>
Date: Sun, Jul 26, 2026 at 1:00 PM
Subject: FPU Basketball order
To: Steve <steve@nationalsportsapparel.com>

Please use the same quantities as our latest estimate.`
  );

  expect(parsed.is_forwarded).toBe(true);
  expect(parsed.instruction).toContain('prepare the CLICK cart');
  expect(parsed.original_sender_email).toBe('coach@example.com');
  expect(parsed.original_sender_name).toBe('Coach Rivera');
  expect(parsed.original_subject).toBe('FPU Basketball order');
  expect(parsed.original_body).toContain('same quantities');
});

test('cartPayloadForMessage reuses exact items from a matched estimate and never invents a PO', () => {
  const payload = cartPayloadForMessage({
    id: 'inbox-1',
    command_type: 'queue_cart_from_estimate',
    submitted_by_id: 'rep-1',
    analysis: {
      command: { record_id: 'EST-1234' },
      lines: [],
      portal_context: {
        estimates: [{
          id: 'EST-1234',
          items: [{
            product_id: 'prod-1',
            sku: 'JW1234',
            name: 'Adidas Jersey',
            brand: 'Adidas',
            color: 'Black',
            sizes: { S: 2, M: 3 },
          }],
        }],
        orders: [],
      },
    },
  });

  expect(payload.target).toBe('adidas_click');
  expect(payload.source_estimate_id).toBe('EST-1234');
  expect(payload.po_number).toBeNull();
  expect(payload.totals.qty).toBe(5);
  expect(payload.lines[0]).toMatchObject({ sku: 'JW1234', qty: 5, sizes: { S: 2, M: 3 } });
});

test('cartPayloadForMessage blocks non-Adidas lines from the CLICK worker', () => {
  expect(() => cartPayloadForMessage({
    id: 'inbox-2',
    command_type: 'queue_cart',
    analysis: {
      command: { record_id: null },
      lines: [{
        product_id: 'prod-2',
        sku_guess: 'PC61',
        name: 'Port & Company Tee',
        brand: 'Port & Company',
        sizes: { L: 12 },
      }],
      portal_context: { estimates: [], orders: [] },
    },
  })).toThrow(/supports Adidas lines only/);
});
