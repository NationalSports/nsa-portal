-- Rep daily digest: "closing this week" alert goes out ONCE per close date, not every day.
--
-- The digest now tells the rep about a closing store twice: the first morning it is within a
-- week of closing, and the day before it closes. closing_week_notice_close_at records the
-- close_at value the week-out notice was sent for, so a store whose close date is moved gets
-- a fresh notice for the new date.
ALTER TABLE webstores ADD COLUMN IF NOT EXISTS closing_week_notice_close_at timestamptz;

-- Open stores already inside the 7-day window have been getting the old daily alert, so count
-- them as notified — otherwise they'd get a repeat "closes this week" email tomorrow.
UPDATE webstores
   SET closing_week_notice_close_at = close_at
 WHERE status = 'open'
   AND close_at > now()
   AND close_at <= now() + interval '7 days'
   AND closing_week_notice_close_at IS NULL;
