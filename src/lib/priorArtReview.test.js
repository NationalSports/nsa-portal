import { PRIOR_ART_REVIEW, startPriorArtReview, priorArtDecisionPending, confirmPriorArt, markPriorArtCoachSent } from './priorArtReview';

test('a split inherits the design but none of the prior approval', () => {
  const source = { id: 'JOB-1', art_file_id: 'af1', art_status: 'art_complete', sent_to_coach_at: 'yesterday', coach_approved_at: 'today', sent_history: [{ sent_at: 'yesterday' }] };
  const child = startPriorArtReview({ ...source, id: 'JOB-1-B' });
  expect(child).toMatchObject({ id: 'JOB-1-B', art_file_id: 'af1', art_status: PRIOR_ART_REVIEW, art_reuse_confirmed: false, sent_to_coach_at: null, coach_approved_at: null, sent_history: [] });
  expect(source.art_status).toBe('art_complete');
});

test('previous art stays in review until a decision and a confirmed coach send', () => {
  const job = startPriorArtReview({ art_file_id: 'af1' });
  expect(priorArtDecisionPending(job)).toBe(true);
  const accepted = confirmPriorArt(job);
  expect(priorArtDecisionPending(accepted)).toBe(false);
  expect(accepted.art_status).toBe(PRIOR_ART_REVIEW);
  expect(markPriorArtCoachSent(accepted).art_status).toBe('waiting_approval');
});

test('an older unsent reused job still requires the art decision, even with a mock', () => {
  const job = { art_status: 'waiting_approval', sent_to_coach_at: null };
  expect(priorArtDecisionPending(job, [{ status: 'approved' }], ['White tee'])).toBe(true);
  expect(priorArtDecisionPending(job, [{ status: 'approved' }], [])).toBe(true);
  expect(priorArtDecisionPending({ ...job, sent_to_coach_at: 'today' }, [{ status: 'approved' }], ['White tee'])).toBe(false);
});
