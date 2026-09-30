// Reusing a design is a new decision for each job. A source order's approval and
// coach-send history are reference material, not approval of the new garment.
export const PRIOR_ART_REVIEW = 'needs_art_review';

export const startPriorArtReview = job => ({
  ...job,
  art_status: PRIOR_ART_REVIEW,
  art_reuse_confirmed: false,
  sent_to_coach_at: null,
  coach_approved_at: null,
  coach_approval_comment: null,
  coach_rejected: null,
  coach_email_opened_at: null,
  follow_up_at: null,
  sent_history: [],
  art_requests: [],
  art_messages: [],
  rejections: [],
  follow_up_auto: false,
  follow_up_count: 0,
  follow_up_last_sent_at: null,
});

export const priorArtDecisionPending = (job, artFiles = []) => {
  if (!job || job.sent_to_coach_at || job.art_reuse_confirmed) return false;
  if (job.art_status === PRIOR_ART_REVIEW) return true;
  // Existing unsent orders can already be parked at waiting_approval by the old
  // sync path. Recognize the reused-art shape even if an old mock is attached.
  return job.art_status === 'waiting_approval'
    && artFiles.some(a => a?.status === 'approved' || a?.reused_from_so);
};

export const confirmPriorArt = job => ({ ...job, art_status: PRIOR_ART_REVIEW, art_reuse_confirmed: true });

export const markPriorArtCoachSent = job => job?.art_status === PRIOR_ART_REVIEW && job.art_reuse_confirmed
  ? { ...job, art_status: 'waiting_approval' } : job;
