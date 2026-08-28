const { artReviewLocked, mockupReviewDate } = require('../businessLogic');

describe('mockup approval task guards', () => {
  test.each(['staging', 'in_process', 'completed', 'shipped'])(
    'locks approval once production reaches %s',
    (prod_status) => {
      expect(artReviewLocked({ prod_status }, { status: 'items_received' })).toBe(true);
    },
  );

  test.each(['ready_to_invoice', 'complete'])(
    'locks stale hold jobs on a %s order',
    (status) => {
      expect(artReviewLocked({ prod_status: 'hold' }, { status })).toBe(true);
    },
  );

  test('keeps a normal pre-production approval round actionable', () => {
    expect(artReviewLocked({ prod_status: 'hold' }, { status: 'items_received' })).toBe(false);
  });

  test('uses the latest actual send-to-rep event, not a later SO edit', () => {
    const job = {
      created_at: '2026-06-02T20:00:00Z',
      art_messages: [
        { text: 'Mockup sent to rep for approval', ts: '2026-06-02T21:16:45Z', is_system: true },
        { text: 'Mockup sent to rep for approval', ts: '2026-06-10T15:00:00Z', is_system: true },
      ],
    };
    const so = { created_at: '2026-05-18T12:00:00Z', updated_at: '2026-08-27T20:07:00Z' };
    expect(mockupReviewDate(job, so)).toBe('2026-06-10T15:00:00Z');
  });

  test('legacy jobs fall back to their art request, never SO updated_at', () => {
    const job = { art_requests: [{ created_at: '2026-06-02T21:15:08Z' }] };
    const so = { created_at: '2026-05-18T12:00:00Z', updated_at: '2026-08-27T20:07:00Z' };
    expect(mockupReviewDate(job, so)).toBe('2026-06-02T21:15:08Z');
  });
});
