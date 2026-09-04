// A date-only close value means "through the end of this local calendar day".
// Parsing YYYY-MM-DD directly uses UTC, which can make a West Coast store look
// expired during the prior afternoon. Full timestamps are compared exactly.
export const webstoreCloseIsFuture = (closeAt, now = new Date()) => {
  if (!closeAt) return true;
  const raw = String(closeAt).trim();
  const closes = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T23:59:59.999`)
    : new Date(raw);
  return !Number.isNaN(closes.getTime()) && closes > now;
};

const sameCloseMoment = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb;
  return String(a).trim() === String(b).trim();
};

// Extending (or clearing) the close date of an already-closed store is a reopen
// action. Both admin date editors use this so the public countdown and the
// storefront/check-out status gate cannot drift apart.
export const reopenPatchForCloseDate = (store, closeAt, now = new Date(), allowSameDate = false) => (
  store?.status === 'closed'
    && (allowSameDate || !sameCloseMoment(store.close_at, closeAt))
    && webstoreCloseIsFuture(closeAt, now)
    ? { status: 'open', closed_notified_at: null }
    : {}
);
