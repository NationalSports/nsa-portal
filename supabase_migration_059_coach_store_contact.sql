-- Public coach store builder: capture the lead's contact info.
--
-- The /team-stores "Build" button opens a PUBLIC (anon, no login) store builder
-- for coaches whose team isn't in the system yet ("Don't see your store?"). Since
-- there's no customer/rep record to hang the submission on, the coach types their
-- own contact info, and we store it on the draft store so staff can follow up.
--
-- webstores.coach_contact_email already exists (used by the logged-in coach
-- builder + the admin "Email store link" action). Add the matching name + phone
-- so a cold public lead is reachable. customer_id is already NULLABLE, so a
-- public submission simply leaves it null and is flagged created_via='coach',
-- landing in the same staff "★ Coach submission — review" queue.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS coach_contact_name  TEXT;
ALTER TABLE webstores ADD COLUMN IF NOT EXISTS coach_contact_phone TEXT;
