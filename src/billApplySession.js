// One confirmation boundary for Portal-only, credit, retry and QBO completion.
// A failed attempt retains the exact prepared writes in memory. Retrying never
// recomputes quantities or saves an arbitrary current order. A page reload drops
// that evidence deliberately: ambiguous historical failures require reconciliation.
export const createBillApplySession = (journal = null) => {
  let busy = false;
  let pending = null;
  const run = async (key, { prepare, record, complete, retry = false }) => {
    if (busy) throw new Error('Another bill is being saved — wait and retry.');
    if (pending && pending.key !== key) throw new Error('Finish Retry save on the pending bill before applying another bill.');
    if (!pending && journal?.has(key)) throw new Error('An earlier billing attempt was interrupted. Reconcile its target writes before applying again; this page cannot safely reconstruct the retry.');
    if (retry && !pending) throw new Error('No verified pending writes for this bill. Re-check its match and reconcile before pushing again.');
    busy = true;
    try {
      if (!pending) {
        const writes = prepare();
        if (!writes.length) throw new Error('Nothing was written: no billing target changed. Re-check the match.');
        // Retain an incomplete marker across reloads. Without the original write
        // set, partial local details must never be mistaken for full completion.
        journal?.add(key);
        pending = { key, writes, record, complete, published: false };
      }
      const attempt = pending;
      if (!attempt.published) {
        for (const w of attempt.writes) {
          if (!w.isCurrent()) throw new Error('A billing target changed during this attempt. Reconcile it before retrying; no stale snapshot was saved.');
        }
        // Settle every target, including multi-order bills. No ledger/status can
        // advance on false, undefined, rejection, or a still-pending promise.
        const results = await Promise.all(attempt.writes.map(async w => {
          if (w.confirmed) return true;
          try { w.confirmed = (await w.save()) === true; } catch { w.confirmed = false; }
          return w.confirmed;
        }));
        if (results.some(ok => !ok)) throw new Error('Billing save not confirmed. Use Retry save to finish the same writes without reapplying quantities.');
        if (attempt.writes.some(w => !w.isCurrent())) throw new Error('A billing target changed while saving. Reconcile before completing this bill.');
        attempt.writes.forEach(w => w.publish());
        attempt.published = true;
      }
      if ((await attempt.record()) !== true) throw new Error('Billing targets saved, but the applied ledger did not confirm. Retry save will retry bookkeeping only.');
      journal?.remove(key);
      const metadata = attempt.complete();
      if (complete !== attempt.complete) complete(metadata);
      pending = null;
      return true;
    } finally { busy = false; }
  };
  return { run, hasPending: key => pending?.key === key, isUnfinished: key => pending?.key === key || !!journal?.has(key) };
};

export const billAttemptJournal = storage => {
  const key='nsa_bill_incomplete_attempts';
  const read=()=>{
    const rows=JSON.parse(storage.getItem(key)||'[]');
    if(!Array.isArray(rows))throw new Error('Billing retry journal is unreadable — reconcile before applying.');
    return new Set(rows);
  };
  return {
    has: value=>read().has(value),
    add: value=>{const rows=read();rows.add(value);storage.setItem(key,JSON.stringify([...rows]))},
    remove: value=>{const rows=read();rows.delete(value);storage.setItem(key,JSON.stringify([...rows]))},
  };
};

export const billingAttemptKey = b => {
  const p = b?.parsed || {};
  const doc = String(p.doc_number || p.si_doc_number || b?.id || '').trim().toLowerCase();
  if (!doc) throw new Error('Bill has no document identity. Re-check it before applying.');
  return `${p.is_credit ? 'credit' : 'invoice'}|${doc}`;
};

export const sameBillingSnapshot = (a, b) => {
  const clean = value => value && !Array.isArray(value) ? { ...value, updated_at: undefined } : value;
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b));
};
