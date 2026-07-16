-- Commission-eligible flag for team members.
--
-- Commission attribution (see src/businessLogic.js commissionRepId) credits whoever is set as
-- an account's rep, regardless of their role. Historically only role='rep'/'admin' people were
-- offered in the rep pickers and commission reports, but the business also wants certain CSRs
-- (who own accounts and sell) to be listed as the rep and collect commission WITHOUT losing
-- their CSR duties. This per-person opt-in expresses that; isCommissionRep() in businessLogic.js
-- is the single source of truth that reads it.
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS commission_eligible boolean NOT NULL DEFAULT false;
