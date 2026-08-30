/* eslint-disable */
import { daysUntil, isRequestOverdue, nextAction, nextDue, requestStage } from '../methodic/methodicWorkflow';

jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  verifyUser: jest.fn(),
}));
const { _test } = require('../../netlify/functions/methodic-workflow');

describe('Methodic workflow helpers', () => {
  test('keeps pricing, art, sample, order, and tracking as distinct operational stages', () => {
    expect(requestStage({ pricing_status: 'requested', mockup_status: 'not_requested', sample_status: 'not_requested', order_status: 'not_ordered' })).toBe('Pricing');
    expect(requestStage({ pricing_status: 'approved', mockup_status: 'in_art', sample_status: 'not_requested', order_status: 'not_ordered' })).toBe('Art');
    expect(requestStage({ pricing_status: 'approved', mockup_status: 'approved', sample_status: 'in_production', order_status: 'not_ordered' })).toBe('Sample');
    expect(requestStage({ pricing_status: 'approved', mockup_status: 'approved', sample_status: 'approved', order_status: 'in_production' })).toBe('Order');
    expect(requestStage({ pricing_status: 'approved', mockup_status: 'approved', sample_status: 'approved', order_status: 'shipped' })).toBe('Tracking');
  });

  test('surfaces the earliest active due date and overdue condition', () => {
    const request = {
      pricing_status: 'working', expected_pricing_date: '2026-09-03',
      mockup_status: 'in_art', expected_mockup_date: '2026-09-01',
      sample_status: 'not_requested', order_status: 'not_ordered',
    };
    expect(nextDue(request)).toMatchObject({ label: 'Mockup', date: '2026-09-01' });
    expect(daysUntil('2026-09-01', new Date(2026, 8, 2, 12))).toBe(-1);
    expect(isRequestOverdue(request, new Date(2026, 8, 2, 12))).toBe(true);
  });

  test('a blocker is always the rep-facing next action', () => {
    expect(nextAction({ blocker: 'Waiting for customer logo', pricing_status: 'requested' })).toBe('Waiting for customer logo');
  });

  test('validates and caps server-owned request fields', () => {
    const patch = _test.validatePatch({
      title: ' New basketball set ', priority: 'rush', quantity: 22,
      pricing_status: 'requested', mockup_status: 'requested',
      reference_files: [{ url: 'https://cdn.example.com/ref.png', name: 'ref.png' }, { url: 'javascript:bad' }],
      size_breakdown: { S: 4, M: 8, L: -1 }, ignored_admin_field: 'nope',
    }, { create: true });
    expect(patch).toMatchObject({ title: 'New basketball set', priority: 'rush', quantity: 22, pricing_status: 'requested', mockup_status: 'requested', size_breakdown: { S: 4, M: 8 } });
    expect(patch.reference_files).toHaveLength(1);
    expect(patch.ignored_admin_field).toBeUndefined();
    expect(() => _test.validatePatch({ title: 'Test', expected_mockup_date: 'tomorrow' }, { create: true })).toThrow(/invalid expected mockup date/i);
    expect(() => _test.validatePatch({ title: 'Test', expected_mockup_date: '2026-02-30' }, { create: true })).toThrow(/invalid expected mockup date/i);
  });

  test('maps the existing art board lifecycle back into Methodic', () => {
    expect(_test.artStatusToMockup('art_requested')).toBe('in_art');
    expect(_test.artStatusToMockup('waiting_approval')).toBe('ready_for_rep');
    expect(_test.artStatusToMockup('art_complete')).toBe('approved');
  });

  test('hands a mock request directly to the selected sales-order art job and is idempotent', async () => {
    const job = { id: 'JOB-2100-01', so_id: 'SO-2100', art_name: 'Falcons front', art_status: 'needs_art', art_requests: [], assigned_artist: 'artist-1' };
    const admin = {
      from: (table) => {
        const query = {
          payload: null,
          select() { return this; },
          update(payload) { this.payload = payload; return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: job, error: null }),
          then(resolve) { if (table === 'so_jobs' && this.payload) Object.assign(job, this.payload); return Promise.resolve({ error: null }).then(resolve); },
        };
        return query;
      },
    };
    const request = { id: 'req-1', request_number: 'MTH-01001', sales_order_id: 'SO-2100', art_job_id: job.id, title: 'Falcons uniforms', style_number: 'M100', quantity: 22, request_notes: 'Navy and gold.' };
    const actor = { teamMemberId: 'rep-1' };
    const first = await _test.handoffToArt(admin, request, actor);
    expect(first.reused).toBe(false);
    expect(job.art_status).toBe('art_requested');
    expect(job.art_requests[0]).toMatchObject({ source: 'methodic', methodic_request_id: 'req-1', artist: 'artist-1' });
    const second = await _test.handoffToArt(admin, request, actor);
    expect(second.reused).toBe(true);
    expect(job.art_requests).toHaveLength(1);
  });
});
