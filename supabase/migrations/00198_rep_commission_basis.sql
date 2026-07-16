-- Per-rep commission basis override.
--
-- Default (both columns null) = the standard policy: 30% of gross profit paid
-- within 90 days, 15% after. commission_basis='revenue' means the rep instead
-- earns commission_rate × commissionable revenue (sale price, excluding CC
-- surcharges) with no 90-day split — e.g. Rachel Najara at 1% of sale.
-- buildCommLines in src/CommissionsPage.js is the single consumer.
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS commission_basis text,
  ADD COLUMN IF NOT EXISTS commission_rate numeric;
