// Counts describe the affected collection, and a refused write is not evidence
// of committed data loss. Keep this classification shared by email and audit.
export function classifySaveAlert(kind, documentId) {
  const isBlocked = ['blocked', 'bg_shrink_blocked', 'qty_wipe_blocked', 'deco_shrink_blocked', 'jobs_wipe_blocked', 'overcommit_blocked'].includes(kind);
  const recovered = ['est_id_reminted', 'inv_id_reminted', 'received_restored'].includes(kind);
  const partialProtection = ['jobs_wipe_blocked', 'overcommit_blocked'].includes(kind);
  const decorations = kind === 'deco_shrink_blocked';
  const jobs = kind === 'jobs_wipe_blocked';
  const title = recovered ? 'Save recovery' : partialProtection ? 'Save protection triggered'
    : isBlocked ? 'Save blocked' : kind === 'batch_promotion_failed' ? 'Vendor order needs review' : 'Save needs review';
  return {
    isBlocked,
    entity: String(documentId).startsWith('EST-') ? 'Estimate' : String(documentId).startsWith('INV-') ? 'Invoice' : 'SO',
    action: recovered ? 'save_recovered' : isBlocked ? 'save_blocked' : 'save_needs_review',
    unit: decorations ? 'decoration(s)' : jobs ? 'job(s)' : 'item(s)',
    countLabel: decorations ? 'Decorations' : jobs ? 'Jobs' : 'Items',
    auditOnly: recovered,
    title,
    notice: partialProtection
      ? 'A protected part of the save was refused. Other changes may have saved. Review the reason and current cloud copy before retrying.'
      : isBlocked ? 'The save was blocked. This event does not confirm data loss. Review the preserved draft against the current cloud copy before retrying.'
      : 'This event needs review. Check the reason and current cloud record; this alert alone does not establish that items were lost.',
  };
}
