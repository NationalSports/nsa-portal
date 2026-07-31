// Regression tests for closeOpenArtRequests — the fix for "I got an art that Needs Approval AND
// still shows as requested/out with the artist" (SO-1625 / JOB-1625-01). When a job is sent for
// approval (art_status → waiting_approval) or completed, the artist's open request is fulfilled and
// must be closed, or the job renders as BOTH "Needs Approval" and an open "Start Working" request.
import { closeOpenArtRequests, OPEN_ART_REQ_STATUSES } from '../lib/artRequests';

const req = (over) => ({ id: 'AR-1', artist: 'a1', status: 'requested', ...over });

describe('closeOpenArtRequests', () => {
  test('closes a still-open "requested" request (the reported bug)', () => {
    const out = closeOpenArtRequests([req({ status: 'requested' })]);
    expect(out[0].status).toBe('completed');
  });

  test('closes an "in_progress" request', () => {
    const out = closeOpenArtRequests([req({ status: 'in_progress' })]);
    expect(out[0].status).toBe('completed');
  });

  test('leaves already-completed and recalled requests untouched', () => {
    const input = [req({ id: 'a', status: 'completed' }), req({ id: 'b', status: 'recalled' })];
    const out = closeOpenArtRequests(input);
    expect(out.map((r) => r.status)).toEqual(['completed', 'recalled']);
    expect(out).toBe(input); // nothing changed → same reference (no needless re-render churn)
  });

  test('closes only the open one in a mixed history, preserving order and other fields', () => {
    const out = closeOpenArtRequests([
      req({ id: 'old', status: 'recalled', instructions: 'v1' }),
      req({ id: 'cur', status: 'in_progress', instructions: 'v2', artist_name: 'Mo' }),
    ]);
    expect(out.map((r) => [r.id, r.status])).toEqual([
      ['old', 'recalled'],
      ['cur', 'completed'],
    ]);
    expect(out[1].instructions).toBe('v2');
    expect(out[1].artist_name).toBe('Mo'); // other fields survive
  });

  test('does not mutate the input array or its objects', () => {
    const input = [req({ status: 'requested' })];
    const snapshot = JSON.parse(JSON.stringify(input));
    closeOpenArtRequests(input);
    expect(input).toEqual(snapshot); // caller's array is untouched
  });

  test('is null/empty safe', () => {
    expect(closeOpenArtRequests(null)).toBe(null);
    expect(closeOpenArtRequests(undefined)).toBe(undefined);
    expect(closeOpenArtRequests([])).toEqual([]);
  });

  test('the open-status set is exactly requested + in_progress', () => {
    expect([...OPEN_ART_REQ_STATUSES].sort()).toEqual(['in_progress', 'requested']);
  });
});
