// Commission snapshots — pure helpers (no supabase, no React) so the freeze/apply logic
// is unit-testable and lives in exactly one place. CommissionsPage owns the I/O.
//
// A snapshot freezes a PAID invoice's commission at the numbers that were true when it
// was earned, so later SO edits (corrected PO costs, added freight, re-priced lines)
// can't retroactively change a rep's statement or move a line between months.

export const COMM_RATE_STANDARD = 0.30;
export const COMM_RATE_LATE = 0.15;
export const COMM_LATE_DAYS = 90;

// A line may be frozen only when freezing it would freeze the TRUTH:
//  - fully paid (a partial's final payment date isn't known yet — it keeps rendering live)
//  - payment rows hydrated and present (else paid_date would be the invoice-date fallback)
//  - the SO and its cost inputs hydrated (else calcGP under-counts cost and over-states GP)
export function canSnapshotLine(line) {
  if (!line || !line.inv) return false;
  if (line.inv.status !== 'paid') return false;
  if (line.inv._paymentsHydrated === false) return false;
  if (!(line.inv.payments && line.inv.payments.length)) return false;
  const so = line.so;
  if (!so) return false;
  if (so._itemsHydrated === false || so._posHydrated === false) return false;
  return true;
}

// Build the DB row from a buildCommLines line. The line's commRate/commAmt already
// include any active admin override, so the freeze captures what the rep is actually
// owed; the raw override value is kept alongside for display and later edits.
export function snapshotRowFromLine(line, snappedBy) {
  const d = line.paidDate;
  // Guard Invalid Date (a failed upstream parse) — otherwise the row literally writes
  // "NaN-NaN-NaN" into paid_date.
  const paid_date = d && !isNaN(d.getTime())
    ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    : null;
  const ovr = line.ovrRaw;
  return {
    invoice_id: line.inv.id,
    so_id: (line.so && line.so.id) || line.inv.so_id || null,
    customer_id: line.inv.customer_id || null,
    rep_id: line.repId || null,
    gp: line.gp,
    rate: line.commRate,
    amount: line.commAmt,
    paid_date,
    days_to_pay: line.daysToPay != null ? line.daysToPay : null,
    override: ovr == null || ovr === false ? null : { value: ovr },
    snapped_by: snappedBy || null,
  };
}

// Overlay a snapshot onto a live-computed line. Identity/navigation fields (inv, so,
// customer, rep) stay live; the money fields come from the freeze. parseDateFn is
// injected (App's parseDate) so date-only strings parse as LOCAL midnight.
export function applySnapshotToLine(line, snap, parseDateFn) {
  if (!snap) return line;
  const paidDate = snap.paid_date ? parseDateFn(snap.paid_date) : line.paidDate;
  const daysToPay = snap.days_to_pay != null ? snap.days_to_pay : line.daysToPay;
  const rate = Number(snap.rate);
  const amount = Number(snap.amount);
  return {
    ...line,
    gp: snap.gp || line.gp,
    commRate: isNaN(rate) ? line.commRate : rate,
    commAmt: isNaN(amount) ? line.commAmt : amount,
    paidDate,
    daysToPay,
    isLate: daysToPay != null && daysToPay > COMM_LATE_DAYS,
    overridden: !!snap.override,
    ovrRaw: snap.override ? snap.override.value : undefined,
    paidMonth: paidDate ? (paidDate.getMonth() + 1) + '/' + paidDate.getFullYear() : line.paidMonth,
    snapped: true,
    snappedAt: snap.snapped_at,
  };
}

// New rate/amount/override for a snapshotted line when an admin changes the override.
// ovr: true = restore standard 30% on a late invoice; number = explicit decimal rate;
// null/false = clear back to the base rate implied by the frozen days_to_pay.
// basis/baseRate (optional, 00198): 'revenue' reps earn rate × frozen revenue instead
// of rate × frozen GP, and their base rate is their configured baseRate (no late split).
// Omitting them keeps the original GP behavior exactly.
export function overrideSnapshotPatch(snap, ovr, basis, baseRate) {
  const gp = Number(snap && snap.gp && snap.gp.gp) || 0;
  const rev = Number(snap && snap.gp && snap.gp.rev) || 0;
  const revBasis = basis === 'revenue';
  const late = snap && snap.days_to_pay != null && snap.days_to_pay > COMM_LATE_DAYS;
  const base = revBasis ? (baseRate != null ? baseRate : 0.01) : (late ? COMM_RATE_LATE : COMM_RATE_STANDARD);
  // NaN (a blanked admin input parsed with parseFloat) counts as clearing the override —
  // typeof NaN === 'number', so without this it would write rate: NaN / amount: NaN.
  const cleared = ovr == null || ovr === false || (typeof ovr === 'number' && !Number.isFinite(ovr));
  const rate = cleared ? base : (typeof ovr === 'number' ? ovr : (revBasis ? base : COMM_RATE_STANDARD));
  return {
    rate,
    amount: Math.round((revBasis ? rev : gp) * rate * 100) / 100,
    override: cleared ? null : { value: ovr },
  };
}
