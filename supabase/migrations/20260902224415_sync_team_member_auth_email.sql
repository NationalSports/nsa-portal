-- Coach approval notifications resolve recipients from team_members. Historical
-- auth links populated auth_id without copying the login email, so linked reps
-- with a blank roster email fell through to the monitored admin inbox (EST-2374).
-- Backfill only blank values; deliberately preserve any explicit roster address.
update public.team_members as tm
set email = lower(btrim(au.email)),
    updated_at = now()
from auth.users as au
where tm.auth_id = au.id
  and coalesce(btrim(tm.email), '') = ''
  and coalesce(btrim(au.email), '') <> '';
