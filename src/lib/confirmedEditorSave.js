// Editor actions must not treat a queued/local update as durable. Prefer the
// result-checked save path and accept only an explicit true acknowledgement.
export async function confirmedEditorSave(updated, { onSaveNow, onSave, saveOptions } = {}) {
  const persist = onSaveNow || onSave;
  if (!persist) return false;
  let attached = false;
  try {
    if (saveOptions && updated && typeof updated === 'object') {
      Object.defineProperty(updated, '__editorSaveOptions', { value: saveOptions, configurable: true });
      attached = true;
    }
    return (await (saveOptions === undefined ? persist(updated) : persist(updated, saveOptions))) === true;
  } catch (error) {
    console.error('[Editor] save failed:', error);
    return false;
  } finally {
    if (attached) delete updated.__editorSaveOptions;
  }
}
