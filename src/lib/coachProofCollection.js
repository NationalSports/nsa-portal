// The collection changes navigation only. Decisions still belong to one existing
// production job, with the portal-action transaction as the authority.
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const approvedStates = new Set(['art_complete', 'production_files_needed', 'upload_emb_files', 'upload_sp_files']);

export function coachProofStatus(job) {
  if (job?.art_status === 'waiting_approval' && job.sent_to_coach_at) return 'Awaiting approval';
  if (job?.coach_rejected) return 'Changes requested';
  if (approvedStates.has(job?.art_status) && (job.coach_approved_at || job.sent_to_coach_at)) return 'Approved';
  return 'Mockup in progress';
}

export function buildCoachProofCollection({ orderId, jobs, items, currentJobId, includeJob = () => true }) {
  const lines = Array.isArray(items) ? items : [];
  return list(jobs).filter(job => {
    const ownsArtwork = !!job.art_file_id || list(job._art_ids).length > 0;
    return (ownsArtwork && includeJob(job)) || job.id === currentJobId;
  }).flatMap(job => {
    const garments = list(job.items);
    const status = coachProofStatus(job);
    // Do not expose internal mocks before the rep sends them. Keep upcoming
    // designs on screen as disabled placeholders, without their artwork URLs.
    const canOpen = !!(job.sent_to_coach_at || (status === 'Approved' && job.coach_approved_at) || job.id === currentJobId);
    return (garments.length ? garments : [null]).map((garment, itemIndex) => {
      const line = garment ? (lines[garment.item_idx] || garment) : null;
      const sizes = garment?.sizes || line?.sizes || {};
      return {
        key: JSON.stringify([orderId, job.id, itemIndex]), orderId, jobId: job.id,
        job, garment, line, itemIndex, status, canOpen,
        pending: status === 'Awaiting approval',
        name: line?.name || garment?.name || line?.sku || garment?.sku || job.art_name || 'Artwork',
        color: garment?.color || line?.color || '',
        qty: garment?.units ?? Object.values(sizes).reduce((sum, value) => sum + (Number(value) || 0), 0),
        placement: job.positions || '', method: String(job.deco_type || '').replace(/_/g, ' '),
        sentAt: job.sent_to_coach_at || null,
      };
    });
  });
}

export function nextPendingCoachProof(entries, activeKey, excludeJobId = null) {
  const active = entries.findIndex(entry => entry.key === activeKey);
  for (let step = 1; step <= entries.length; step++) {
    const entry = entries[(Math.max(active, -1) + step) % entries.length];
    if (entry?.pending && entry.canOpen && entry.jobId !== excludeJobId) return entry;
  }
  return null;
}
