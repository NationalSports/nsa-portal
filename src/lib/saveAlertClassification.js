// Counts describe the affected collection, and a refused write is not evidence
// of committed data loss. Keep this classification shared by email and audit.
export function classifySaveAlert(kind, documentId) {
  const isBlocked = ['blocked', 'bg_shrink_blocked', 'qty_wipe_blocked', 'deco_shrink_blocked'].includes(kind);
  const decorations = kind === 'deco_shrink_blocked';
  return {
    isBlocked,
    entity: String(documentId).startsWith('EST-') ? 'Estimate' : 'SO',
    action: isBlocked ? 'save_blocked' : 'data_loss',
    unit: decorations ? 'decoration(s)' : 'item(s)',
    countLabel: decorations ? 'Decorations' : 'Items',
  };
}
