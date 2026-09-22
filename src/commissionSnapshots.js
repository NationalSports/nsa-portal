// Commission snapshots — pure helpers (no supabase, no React) so the freeze/apply logic
// is unit-testable and lives in exactly one place. CommissionsPage owns the I/O.
//
// A snapshot freezes a PAID invoice's commission at the numbers that were true when it
// was earned, so later SO edits (corrected PO costs, added freight, re-priced lines)
// can't retroactively change a rep's statement or move a line between months.

export const COMM_RATE_STANDARD = 0.30;
export const COMM_RATE_LATE = 0.15;
export const COMM_LATE_DAYS = 90;

// Commission is earned only after the invoice is fully paid. Partial payments
// remain pipeline until the final payment lands; this also keeps the eventual
// paid date and days-to-pay calculation accurate.
export function isCommissionEarnedInvoice(invoice) {
  return !!invoice && invoice.status === 'paid';
}

// Is the data behind this line loaded well enough to freeze anything at all?
//  - fully paid (a partial's final payment date isn't known yet — it keeps rendering live)
//  - payment rows hydrated and present (else paid_date would be the invoice-date fallback)
//  - the SO and its cost inputs hydrated (else calcGP under-counts cost and over-states GP)
// This is the gate for a DELIBERATE re-freeze (an admin correcting a paid order). The
// automatic first freeze adds the cost check below — see canSnapshotLine.
export function lineDataReady(line) {
  if (!line || !line.inv) return false;
  if (!isCommissionEarnedInvoice(line.inv)) return false;
  if (line.inv._paymentsHydrated === false) return false;
  if (!(line.inv.payments && line.inv.payments.length)) return false;
  const so = line.so;
  if (!so) return false;
  if (so._itemsHydrated === false || so._posHydrated === false) return false;
  return true;
}

// Has a real cost actually landed on this line? A line billing revenue at $0 cost is
// almost always MISSING its cost inputs (catalog cost still blank, PO unit cost not
// entered yet, item rows not loaded) — not a costless job. The hydration flags above
// don't catch it: the rows load fine, they just carry no cost yet.
//
// INV-63327 is the case this exists for: it froze at rev $5,498 / cost $0, paying 30% of
// 100% GP ($1,649.46) — five minutes before the real $89 and $47 unit costs were typed in,
// which put the true GP at $1,183 and the commission at ~$355.
export function costInputsBooked(line) {
  const gp = (line && line.gp) || {};
  const cost = Number(gp.cost) || 0;
  if (cost > 0) return true;
  // No revenue either → nothing to overstate; freezing is harmless.
  return !((Number(gp.rev) || 0) > 0);
}

// A line may be frozen automatically only when freezing it would freeze the TRUTH.
export function canSnapshotLine(line) {
  return lineDataReady(line) && costInputsBooked(line);
}

// An already-written freeze that captured $0 cost while today's live numbers carry a real
// cost was never valid — it froze missing data, not truth. Repairing it can only move
// commission DOWN toward the real GP, so it is the one frozen row the page corrects on its
// own; every other correction still goes through the deliberate Re-freeze button.
export function staleZeroCostSnapshot(snap, liveLine) {
  if (!snap || !liveLine) return false;
  if ((Number(snap.gp && snap.gp.cost) || 0) > 0) return false;
  return (Number(liveLine.gp && liveLine.gp.cost) || 0) > 0;
}

// Repair patch for the case above: re-freeze the GP at today's real cost and re-run the
// commission at the ALREADY-FROZEN rate. Paid date, days-to-pay, statement month and any
// admin override are left exactly as frozen — only the bad cost moves.
export function zeroCostRepairPatch(snap, liveLine, basis) {
  const gp = liveLine.gp || {};
  // A 0% rate is a legitimate admin override; a missing/garbage one is not — that keeps the
  // frozen amount rather than silently zeroing (or NaN-ing) the rep's line.
  const rate = snap && snap.rate != null ? Number(snap.rate) : NaN;
  const base = basis === 'revenue' ? (Number(gp.rev) || 0) : (Number(gp.gp) || 0);
  return {
    gp,
    amount: Number.isFinite(rate) ? Math.round(base * rate * 100) / 100 : Number(snap.amount) || 0,
  };
}

// Build the DB row from a buildCommLines line. The line's commRate/commAmt already
// include any active admin override, so the freeze captures what the rep is actually
// owed; the raw override value is kept alongside for display and later edits.
// Blend the standard and late rates across an invoice's payments (per Steve, 2026-09).
//
// The late rule used to look at ONE date — the last payment — and halve the rate on the
// whole invoice. On a deposit order that punished the deposit for the balance's lateness:
// a 50% deposit banked on day 1 earned 15% because the balance landed on day 120.
//
// Now each payment is rated on its OWN age and weighted by its share of what was
// collected, so the invoice's GP is split across payments in the same proportion as the
// money. A day-1 deposit keeps the full 30% no matter when the balance arrives.
//
// Returns null when there is nothing to blend — no invoice date, no dated payments, or
// nothing collected — and the caller falls back to the single last-payment rule.
export function blendedStandardRate(payments, invDate) {
  if (!invDate || isNaN(invDate.getTime()) || !Array.isArray(payments)) return null;
  let total = 0, weighted = 0;
  for (const p of payments) {
    const amt = Number(p && p.amount);
    const d = p && p.date;
    // A payment with no usable date or amount is not evidence of anything; skip it rather
    // than guess a date, which would silently move the rate in one direction or the other.
    if (!Number.isFinite(amt) || amt <= 0 || !d || isNaN(d.getTime())) continue;
    const days = Math.round((d - invDate) / 86400000);
    total += amt;
    weighted += amt * (days > COMM_LATE_DAYS ? COMM_RATE_LATE : COMM_RATE_STANDARD);
  }
  if (total <= 0) return null;
  // Six decimals: enough that a blend re-multiplied by GP lands on the same cent, while
  // keeping the stored rate a stable, comparable number.
  return Math.round((weighted / total) * 1e6) / 1e6;
}

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
    // The pre-override rate. days_to_pay alone can no longer reproduce it — a blended
    // rate depends on every payment's own age — so clearing an override has to read the
    // frozen value back rather than re-derive 15%/30% from one date.
    base_rate: line.baseRate != null ? line.baseRate : null,
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
  const snapBase = snap.base_rate != null ? Number(snap.base_rate) : null;
  const baseRate = snapBase != null && Number.isFinite(snapBase) ? snapBase : line.baseRate;
  return {
    ...line,
    gp: snap.gp || line.gp,
    commRate: isNaN(rate) ? line.commRate : rate,
    commAmt: isNaN(amount) ? line.commAmt : amount,
    baseRate,
    paidDate,
    daysToPay,
    // Late means "some of this invoice was paid late", which for a blended rate is any
    // rate below standard. Rows frozen before base_rate existed fall back to the old
    // single-date test so their display does not shift under them.
    isLate: baseRate != null && Number.isFinite(baseRate)
      ? baseRate < COMM_RATE_STANDARD
      : (daysToPay != null && daysToPay > COMM_LATE_DAYS),
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
  // Prefer the frozen pre-override rate: on a part-late invoice the blend is the only
  // thing that reproduces what the rep actually earned. Older rows have no base_rate, so
  // they keep deriving 15%/30% from the single frozen days_to_pay.
  const snapBase = snap && snap.base_rate != null ? Number(snap.base_rate) : null;
  const late = snap && snap.days_to_pay != null && snap.days_to_pay > COMM_LATE_DAYS;
  const gpBase = snapBase != null && Number.isFinite(snapBase)
    ? snapBase
    : (late ? COMM_RATE_LATE : COMM_RATE_STANDARD);
  const base = revBasis ? (baseRate != null ? baseRate : 0.01) : gpBase;
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
