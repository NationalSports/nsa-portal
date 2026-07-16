-- Artwork storage bucket: staff-only WRITES, public READ preserved.
--
-- CONFIRMED HOLE (parent audit): storage.objects carried three blanket policies
-- from 00040 — auth_upload_artwork (INSERT), auth_update_artwork (UPDATE),
-- auth_delete_artwork (DELETE) — each granted to role `authenticated` with only
-- `bucket_id = 'artwork'` as the check. Magic-link coach accounts share the
-- `authenticated` role, so ANY signed-in coach could upload/overwrite/delete ANY
-- object in the artwork bucket (every customer's art, every mockup). This mirrors
-- the July RLS lockdown (00173-00179): reads stay open, writes gate on
-- is_team_member().
--
-- PRESERVED: public_read_artwork (00040) is left untouched — coach email mockup
-- links and the anonymous coach portal render straight from these public URLs.
-- Coach logo uploads will move to a service-role function later (service_role
-- bypasses RLS), NOT direct storage writes, so this breaks no coach path today:
-- coach browsers only ever READ this bucket.
--
-- is_team_member() (00173) is SECURITY DEFINER and already granted to
-- anon, authenticated, so a storage policy may call it.

drop policy if exists "auth_upload_artwork" on storage.objects;
drop policy if exists "auth_update_artwork" on storage.objects;
drop policy if exists "auth_delete_artwork" on storage.objects;

create policy "staff_upload_artwork" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'artwork' and public.is_team_member());

create policy "staff_update_artwork" on storage.objects
  for update to authenticated
  using (bucket_id = 'artwork' and public.is_team_member())
  with check (bucket_id = 'artwork' and public.is_team_member());

create policy "staff_delete_artwork" on storage.objects
  for delete to authenticated
  using (bucket_id = 'artwork' and public.is_team_member());

-- public_read_artwork is intentionally NOT modified here.

-- ── Rollback (recreate the original 00040 blanket policies) ──────────────────
-- Only if this lockdown must be reverted; it re-opens the hole above.
--   drop policy if exists "staff_upload_artwork" on storage.objects;
--   drop policy if exists "staff_update_artwork" on storage.objects;
--   drop policy if exists "staff_delete_artwork" on storage.objects;
--   create policy "auth_upload_artwork" on storage.objects
--     for insert to authenticated with check (bucket_id = 'artwork');
--   create policy "auth_update_artwork" on storage.objects
--     for update to authenticated using (bucket_id = 'artwork');
--   create policy "auth_delete_artwork" on storage.objects
--     for delete to authenticated using (bucket_id = 'artwork');
