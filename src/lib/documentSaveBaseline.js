// An explicit save owns this exact snapshot. Publish its baseline before React
// state so the diff-save effect cannot submit a second copy. New documents must
// be inserted too; replacing existing rows alone misses the first save.
export function stageDocumentBaseline(snapshotRef, key, document) {
  const rows = snapshotRef.current[key] || [];
  snapshotRef.current[key] = rows.some(row => row.id === document.id)
    ? rows.map(row => row.id === document.id ? document : row)
    : [...rows, document];
}

// A confirmed save can retire a stale banner only after its durable outbox
// entry is gone. Independently selected journal drafts still need review.
export function reconcileOutboxNotices(notices, entries, {table, id}) {
  if (entries.some(entry => entry.table === table && entry.id === id)) return notices;
  return notices.filter(entry => entry.table !== table || entry.id !== id || entry.payload?._draftRecovery);
}
