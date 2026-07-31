-- OMG (OrderMyGear) store: let a rep pick the ARTIST for the store's art right on
-- the OMG page, alongside the existing rep/CSR selectors.
--
-- WHY: OMG store orders are pulled into a Sales Order whose art jobs are built with
-- no assigned_artist (businessLogic.buildJobs never sets one). The art board treats
-- any job with no live-artist owner as a shared "unassigned pool" that EVERY active
-- artist sees, so online-store art landed on whoever grabbed it first (the first
-- active artist) instead of the artist the rep intended. This column lets the rep
-- name the artist at pull time; createOmgSO stamps it onto the SO's jobs so the work
-- routes to that artist instead of the pool.
--
-- Nullable, no default: existing OMG stores keep today's behavior (unassigned pool)
-- until a rep picks an artist. Mirrors rep_id / csr_id (also plain nullable text ids).
alter table public.omg_stores add column if not exists artist_id text;

comment on column public.omg_stores.artist_id is
  'team_members.id of the artist the rep chose for this OMG store''s art. Stamped onto the pulled SO''s so_jobs.assigned_artist by createOmgSO. Null = unassigned (shared art pool).';
