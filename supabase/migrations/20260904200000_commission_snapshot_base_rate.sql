-- Commission snapshots: remember the pre-override rate.
--
-- The late rule used to be reproducible from one number: days_to_pay > 90 meant 15%,
-- otherwise 30%. So when an admin cleared a rate override on a frozen line,
-- overrideSnapshotPatch could re-derive the base rate from the frozen days_to_pay.
--
-- Payments are now rated individually — each payment's own age, weighted by its share of
-- what was collected — so a deposit paid on day 1 keeps 30% when the balance lands late.
-- That blended rate cannot be recovered from a single date, so it is frozen alongside the
-- rate the rep was actually paid.
--
-- Nullable and additive: rows frozen before this column existed keep NULL and fall back to
-- the old single-date derivation, and code that does not know the column is unaffected.
alter table public.commission_snapshots
  add column if not exists base_rate numeric;

comment on column public.commission_snapshots.base_rate is
  'Pre-override commission rate at freeze time. For GP-basis reps this is the payment-weighted blend of the 30% standard and 15% late rates. NULL on rows frozen before payment-level rating, which fall back to deriving 15%/30% from days_to_pay.';
