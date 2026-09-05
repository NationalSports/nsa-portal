// Retry the exact attempted edit, never a refreshed React row. This registry is
// tab-local; persisted drafts from previous sessions enter through explicit
// recovery / the existing boot conflict gate, not by guessing from an ID.
const copy = value => JSON.parse(JSON.stringify(value));
export function createSaveRetryCoordinator() {
  const attempts = new Map(), active = new Map();
  let sequence = 0, cursor = 0, running;
  return {
    begin(owner, table, payload) {
      const receipt = {owner, table, id:payload.id, revision:++sequence, payload:copy(payload)};
      const key = JSON.stringify([owner, table, payload.id]);
      receipt.key = key;
      attempts.set(key, receipt);
      active.set(key, (active.get(key) || 0) + 1);
      return receipt;
    },
    finish(receipt, result) {
      if (!receipt) return;
      const count = (active.get(receipt.key) || 1) - 1;
      if (count) active.set(receipt.key, count); else active.delete(receipt.key);
      if (result === true && attempts.get(receipt.key)?.revision === receipt.revision) attempts.delete(receipt.key);
    },
    retry({ids, owner, canRetry, save, onMissing = () => {}, onError = () => {}, limit = 10}) {
      // Timer, visibility and manual retry share one batch. No overlapping sends.
      if (running) return running;
      running = (async () => {
        let saved = 0, failed = 0, skipped = 0;
        const all = [...ids];
        const start = all.length ? cursor % all.length : 0;
        const batch = [...all.slice(start), ...all.slice(0,start)].slice(0,limit);
        cursor = all.length ? (start + batch.length) % all.length : 0;
        for (const id of batch) {
          if (!canRetry(id)) { skipped++; continue; }
          const candidates = [...attempts.values()].filter(a => a.owner === owner && a.id === id);
          if (candidates.length !== 1) { onMissing(id); skipped++; continue; }
          const attempt = candidates[0];
          if (active.has(attempt.key)) { skipped++; continue; }
          try {
            const result = await save(attempt.table, copy(attempt.payload));
            if (result === true) saved++; else failed++;
          } catch (error) { failed++; onError(id, error); }
        }
        return {saved, failed, skipped};
      })().finally(() => { running = null; });
      return running;
    },
  };
}
