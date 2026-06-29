-- Pay can stack: an employee might have a base salary AND commission, or hourly
-- AND commission, or a 1099 with a draw, etc. Store the full set of components
-- rather than a single pay_type. The legacy pay_type/pay_rate columns stay for
-- back-compat (we keep writing a human-readable summary into them).
--
-- pay_components shape: [{ type, amount, period, basis, notes, recoverable }]
--   type:   'salary' | 'hourly' | 'commission' | 'draw' | 'flat_1099' | 'bonus'
--   amount: text (e.g. '60000', '20.00')
--   period: 'year' | 'month' | 'hour' | 'week' (for amount-based components)
--   basis:  text (commission basis, e.g. '30% of gross profit')
ALTER TABLE onboarding_invites
  ADD COLUMN IF NOT EXISTS pay_components jsonb NOT NULL DEFAULT '[]'::jsonb;
