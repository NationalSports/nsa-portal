-- Dedupe marker for the public quote-form rep notification (quote-notify.js):
-- once set, re-posting the same quote request id cannot re-send the email.
alter table public.quote_requests
  add column if not exists rep_notified_at timestamptz;
