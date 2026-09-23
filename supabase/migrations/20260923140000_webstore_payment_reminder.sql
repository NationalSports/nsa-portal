-- "Finish your order" reminder (netlify/functions/webstore-payment-reminder.js).
-- Stamped when the one-time reminder for a stalled card checkout is claimed, so it
-- is never sent twice. NULL = never reminded (every existing order).
alter table public.webstore_orders
  add column if not exists payment_reminder_sent_at timestamptz;

comment on column public.webstore_orders.payment_reminder_sent_at is
  'When the one-time "finish your order" email was sent for this unpaid card checkout. NULL = never.';
