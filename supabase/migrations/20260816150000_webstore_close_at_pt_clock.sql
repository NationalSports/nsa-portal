-- Team-store close windows: move legacy bare-date values onto the PT clock.
--
-- The store editor wrote the raw 'YYYY-MM-DD' from an <input type="date"> straight
-- into webstores.close_at (TIMESTAMPTZ), so Postgres read it as midnight UTC — which
-- is 5 PM PT the PREVIOUS day. A store set to close "Aug 16" stopped taking orders
-- Aug 15 at 5 PM, and the portal list rendered the value back through a local clock
-- and showed "Aug 15" too. The app now composes date + time in America/Los_Angeles
-- (default 11:59 PM); this backfills the rows written under the old behaviour.
--
-- Only exact-midnight-UTC values are touched — those are unambiguously bare dates,
-- since nothing could previously store a real time of day. The correction always
-- moves a close LATER (to the end of the day the rep actually picked), never earlier,
-- so it cannot retroactively close a store that is still open.

-- close_at: end of the picked day, 11:59 PM PT.
UPDATE webstores
SET close_at = (((close_at AT TIME ZONE 'UTC')::date + TIME '23:59') AT TIME ZONE 'America/Los_Angeles')
WHERE close_at IS NOT NULL
  AND (close_at AT TIME ZONE 'UTC')::time = TIME '00:00';

-- open_at: start of the picked day, 12:00 AM PT (was 5 PM PT the day before).
UPDATE webstores
SET open_at = (((open_at AT TIME ZONE 'UTC')::date + TIME '00:00') AT TIME ZONE 'America/Los_Angeles')
WHERE open_at IS NOT NULL
  AND (open_at AT TIME ZONE 'UTC')::time = TIME '00:00';
