-- Keep malformed/unbounded browser uploads out of the worker queue.
create or replace function public.valid_webstore_build_attachments(files jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_typeof(files) = 'array'
    and jsonb_array_length(files) <= 5
    and not exists (
      select 1
      from jsonb_array_elements(files) as item
      where jsonb_typeof(item) <> 'object'
        or coalesce(item->>'url', '') !~ '^https://res[.]cloudinary[.]com/'
        or length(coalesce(item->>'name', '')) not between 1 and 255
        or coalesce(item->>'type', '') !~ '^(application/pdf|image/[a-z0-9.+-]+)$'
        or not case
          when coalesce(item->>'size', '') ~ '^[0-9]+$'
            then (item->>'size')::numeric between 1 and 20971520
          else false
        end
    );
$$;

revoke all on function public.valid_webstore_build_attachments(jsonb) from public, anon;
grant execute on function public.valid_webstore_build_attachments(jsonb) to authenticated, service_role;

alter table public.webstore_build_requests
  drop constraint webstore_build_requests_attachments_array,
  add constraint webstore_build_requests_valid_attachments
    check (public.valid_webstore_build_attachments(attachment_urls)),
  add constraint webstore_build_requests_failed_has_error
    check (status <> 'failed' or length(trim(coalesce(error, ''))) > 0);

-- An authenticated admin may only cancel work that has not been claimed. The
-- service-role worker may update the full row and controls every other status.
create or replace function public.guard_webstore_build_request_admin_update()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if (select auth.role()) = 'authenticated' then
    if old.status <> 'queued' or new.status <> 'cancelled' then
      raise exception 'Admins may only cancel queued store requests';
    end if;
    if (to_jsonb(new) - 'status' - 'updated_at')
        is distinct from
       (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Cancelling cannot change store request details';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_webstore_build_request_admin_update() from public, anon, authenticated;

create trigger guard_webstore_build_request_admin_update
  before update on public.webstore_build_requests
  for each row execute function public.guard_webstore_build_request_admin_update();

drop policy webstore_build_requests_admin_insert on public.webstore_build_requests;
create policy webstore_build_requests_admin_insert
  on public.webstore_build_requests for insert to authenticated
  with check (
    (select public.is_admin_member())
    and created_by = (
      select tm.id
      from public.team_members tm
      where tm.auth_id = (select auth.uid())
        and tm.is_active is not false
      limit 1
    )
  );
