-- Requires the AI Notes migration from PR #2377. Additive; no customer writes.
alter table public.meetings add column if not exists capture_incomplete boolean not null default false;
alter table public.meetings add column if not exists processing_token uuid;
alter table public.meetings add column if not exists processing_lease_until timestamptz;
alter table public.meetings add column if not exists annotations jsonb not null default '[]';
alter table public.meetings add column if not exists attachments jsonb not null default '[]';

-- Provider IDs/completed segment transcripts must NOT leak via shared notes.
create table public.meeting_processing_jobs (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  created_at timestamptz not null default now(),
  extraction_key text,
  extraction_parts jsonb not null default '{}',
  segments jsonb not null default '{}'
);
alter table public.meeting_processing_jobs enable row level security;
revoke all on public.meeting_processing_jobs from public,anon,authenticated;
grant all on public.meeting_processing_jobs to service_role;

-- Single worker lease. Invoker security + service-only execute; no public bypass.
create or replace function public.claim_meeting_processing(p_id uuid,p_token uuid)
returns boolean language sql security invoker set search_path=public as $$
  with claimed as (
    update public.meetings set processing_token=p_token,
      processing_lease_until=now()+interval '14 minutes', updated_at=now()
    where id=p_id and status='processing'
      and (processing_lease_until is null or processing_lease_until<now())
    returning id
  ) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_meeting_processing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_meeting_processing(uuid,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('meeting-images','meeting-images',false,1048576,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
-- No client object policies. All uploads require owner-checked short-lived signed
-- upload authorization; read URLs are minted after note visibility checks.

-- Bound temporary cloud audio per note, including direct SDK uploads. The private
-- trigger reads Storage metadata as its owner so RLS cannot hide earlier chunks.
create schema if not exists private;
create or replace function private.limit_meeting_audio()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare folder text; bytes numeric; chunks integer;
begin
  if new.bucket_id <> 'meeting-audio' then return new; end if;
  folder := split_part(new.name,'/',1)||'/'||split_part(new.name,'/',2)||'/';
  perform pg_advisory_xact_lock(hashtextextended('meeting-audio:'||folder,0));
  select coalesce(sum(coalesce((metadata->>'size')::numeric,0)),0),count(*)
    into bytes,chunks from storage.objects
    where bucket_id='meeting-audio' and starts_with(name,folder) and id<>new.id;
  if bytes+coalesce((new.metadata->>'size')::numeric,0)>157286400 or chunks>=1000 then
    raise exception 'Meeting audio exceeds the 150 MB / 1000 chunk limit';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_meeting_audio() from public,anon,authenticated;
create trigger limit_meeting_audio before insert or update of metadata,name,bucket_id
on storage.objects for each row execute function private.limit_meeting_audio();
