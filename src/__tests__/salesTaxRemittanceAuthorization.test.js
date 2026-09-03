/** @jest-environment node */

jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: jest.fn(() => ({ 'Access-Control-Allow-Origin': '*' })),
  getSupabaseAdmin: jest.fn(),
  verifyQBOUser: jest.fn(),
  verifyUser: jest.fn(),
}));

const { getSupabaseAdmin, verifyQBOUser, verifyUser } = require('../../netlify/functions/_shared');
const { handler, validDate } = require('../../netlify/functions/sales-tax-remittance');

const event = (body) => ({
  httpMethod: 'POST',
  headers: { origin: 'https://connect.nationalsportsapparel.com', authorization: 'Bearer test' },
  body: JSON.stringify(body),
});

const validRecord = {
  action: 'record', source_type: 'webstore', source_key: 'ws:store-1:CA',
  store_name: 'Test Store', jurisdiction: 'CA', filing_period_start: '2026-07-01',
  filing_period_end: '2026-09-03', cutoff_at: '2026-09-03T18:00:00.000Z',
  amount_cents: 14415, payment_reference: 'CDTFA-123',
  idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
};

describe('sales-tax ledger authorization and validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('requires a signed-in staff member even for reads', async () => {
    verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });
    const response = await handler(event({ action: 'list' }));
    expect(response.statusCode).toBe(401);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('allows staff reads but reserves ledger writes for accounting/admin', async () => {
    verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'rep-1' });
    verifyQBOUser.mockResolvedValue({ ok: false, status: 403, error: 'Accounting or admin role required' });
    getSupabaseAdmin.mockReturnValue({});
    const response = await handler(event(validRecord));
    expect(response.statusCode).toBe(403);
  });

  test('reads every ledger page instead of silently truncating the audit trail', async () => {
    verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'rep-1' });
    const calls = [];
    getSupabaseAdmin.mockReturnValue({ from: jest.fn(() => ({
      select: () => ({ order: () => ({
        range: async (from, to) => {
          calls.push([from, to]);
          return { data: from === 0 ? Array.from({ length: 1000 }, (_, id) => ({ id })) : [{ id: 1000 }], error: null };
        },
      }) }),
    })) });
    const response = await handler(event({ action: 'list' }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).entries).toHaveLength(1001);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
    expect(verifyQBOUser).not.toHaveBeenCalled();
  });

  test('rejects normalized impossible calendar dates', () => {
    expect(validDate('2026-02-28')).toBe(true);
    expect(validDate('2026-02-30')).toBe(false);
  });

  test('records integer cents and derives the actor from the verified user', async () => {
    verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'acct-1' });
    verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: 'acct-1', role: 'accounting' });
    let inserted;
    const admin = { from: jest.fn(() => ({
      insert(row) {
        inserted = row;
        return { select: () => ({ single: async () => ({ data: { id: 'entry-1', ...row }, error: null }) }) };
      },
    })) };
    getSupabaseAdmin.mockReturnValue(admin);
    const response = await handler(event({ ...validRecord, recorded_by: 'forged-user' }));
    expect(response.statusCode).toBe(200);
    expect(inserted).toMatchObject({ amount_cents: 14415, recorded_by: 'acct-1', entry_type: 'remittance' });
  });

  test('corrects a filing by inserting a reversal instead of updating or deleting', async () => {
    verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'admin-1' });
    verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: 'admin-1', role: 'admin' });
    const original = {
      id: '123e4567-e89b-42d3-a456-426614174001', entry_type: 'remittance',
      source_type: 'webstore', source_key: 'ws:store-1:CA', store_name: 'Test Store',
      jurisdiction: 'CA', filing_period_start: '2026-07-01', filing_period_end: '2026-09-03',
      cutoff_at: '2026-09-03T18:00:00.000Z', amount_cents: 14415,
      payment_reference: 'CDTFA-123', legacy_import: false,
    };
    let inserted;
    const table = {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: original, error: null }) }) }),
      insert(row) {
        inserted = row;
        return { select: () => ({ single: async () => ({ data: { id: 'reverse-1', ...row }, error: null }) }) };
      },
    };
    getSupabaseAdmin.mockReturnValue({ from: jest.fn(() => table) });
    const response = await handler(event({
      action: 'reverse', entry_id: original.id, reason: 'Duplicate state payment',
      idempotency_key: '123e4567-e89b-42d3-a456-426614174002',
    }));
    expect(response.statusCode).toBe(200);
    expect(inserted).toMatchObject({
      entry_type: 'reversal', reversal_of: original.id, amount_cents: 14415,
      recorded_by: 'admin-1', notes: 'Duplicate state payment',
    });
    expect(table.update).toBeUndefined();
    expect(table.delete).toBeUndefined();
  });
});
