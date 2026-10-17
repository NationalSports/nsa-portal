// Editor actions must not treat a queued/local update as durable. Prefer the
// result-checked save path and accept only an explicit true acknowledgement.
export async function confirmedEditorSave(updated, { onSaveNow, onSave } = {}) {
  const persist = onSaveNow || onSave;
  if (!persist) return false;
  try {
    return (await persist(updated)) === true;
  } catch (error) {
    console.error('[Editor] save failed:', error);
    return false;
  }
}
