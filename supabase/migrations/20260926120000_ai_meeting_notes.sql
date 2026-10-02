-- AI meeting notes (docs/AI_MEETING_NOTES_V1_SPEC.md, steps 1-3, 5, 7).
--
-- A rep records a meeting, dictates a memo, or pastes text. Netlify functions
-- (meeting-notes, meeting-process-background) transcribe it (AssemblyAI) and
-- extract a draft (Claude). The rep edits and approves; approval writes to-dos
-- into assigned_todos (source = 'meeting:<id>:<n>') and new people into
-- customer_contacts. All writes go through those functions (service role); the
-- browser only reads, and uploads its own audio chunks.
--
-- Audio is never kept: chunks are deleted as soon as the transcript is saved,
-- and meeting-audio-sweep purges anything a failed/abandoned job left behind.

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  team_member_id text not null references public.team_members(id) on delete cascade,
  customer_id text references public.customers(id) on delete set null,
  mode text not null check (mode in ('dictated', 'recorded', 'pasted')),
  status text not null default 'recording'
    check (status in ('recording', 'processing', 'ready', 'approved', 'failed', 'discarded')),
  title text,
  duration_sec integer,
  -- Meeting mode records other people: the rep must confirm they told everyone.
  consent_confirmed_at timestamptz,
  -- [{ "index": 0, "chunks": 12, "ext": "webm", "mime": "audio/webm" }] — one per
  -- recorder session (a phone lock/app switch starts a new session).
  segments jsonb not null default '[]'::jsonb,
  draft jsonb,
  final jsonb,
  speaker_map jsonb,
  error text,
  audio_purged_at timestamptz,
  processed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_recorded_needs_consent check (mode <> 'recorded' or consent_confirmed_at is not null)
);

create index if not exists meetings_rep_created_idx on public.meetings (team_member_id, created_at desc);
create index if not exists meetings_customer_idx on public.meetings (customer_id, status);

-- Raw transcripts live apart from the note so approved notes can be shared with
-- the team while what was actually said stays with the rep (and admins).
create table if not exists public.meeting_transcripts (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  source_text text,
  utterances jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Audit of every transcription / extraction call (cost tracking).
create table if not exists public.ai_jobs (
  id bigserial primary key,
  meeting_id uuid references public.meetings(id) on delete set null,
  provider text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  audio_seconds numeric,
  duration_ms integer,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

alter table public.customer_contacts add column if not exists source text;
alter table public.customer_contacts add column if not exists sport text;
alter table public.customer_contacts add column if not exists created_at timestamptz default now();

alter table public.meetings enable row level security;
alter table public.meeting_transcripts enable row level security;
alter table public.ai_jobs enable row level security;

revoke all on table public.meetings from anon, authenticated;
revoke all on table public.meeting_transcripts from anon, authenticated;
revoke all on table public.ai_jobs from anon, authenticated;
grant select on table public.meetings to authenticated;
grant select on table public.meeting_transcripts to authenticated;

-- Notes: the rep sees their own (any status); admins/GMs see everything; any
-- active staff member sees APPROVED notes (the account's shared history).
drop policy if exists "meetings_read" on public.meetings;
create policy "meetings_read"
  on public.meetings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.team_members tm
      where tm.auth_id = (select auth.uid()) and tm.is_active is not false
        and (
          tm.id = meetings.team_member_id
          or tm.role in ('admin', 'super_admin', 'gm')
          or meetings.status = 'approved'
        )
    )
  );

-- Transcripts: the rep who recorded it, and admins.
drop policy if exists "meeting_transcripts_read" on public.meeting_transcripts;
create policy "meeting_transcripts_read"
  on public.meeting_transcripts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.meetings m
      join public.team_members tm on tm.auth_id = (select auth.uid()) and tm.is_active is not false
      where m.id = meeting_transcripts.meeting_id
        and (tm.id = m.team_member_id or tm.role in ('admin', 'super_admin'))
    )
  );

-- Private audio bucket. Path: {team_member_id}/{meeting_id}/s{segment}-c{chunk}.{ext}
insert into storage.buckets (id, name, public, file_size_limit)
values ('meeting-audio', 'meeting-audio', false, 20971520)
on conflict (id) do nothing;

-- A rep may only add chunks under their own folder, for their own meeting that
-- is still recording. No read/update/delete from the browser: the functions
-- (service role) read the audio once and delete it.
drop policy if exists "meeting_audio_owner_insert" on storage.objects;
create policy "meeting_audio_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'meeting-audio'
    and exists (
      select 1 from public.meetings m
      join public.team_members tm on tm.id = m.team_member_id
      where tm.auth_id = (select auth.uid()) and tm.is_active is not false
        and (storage.foldername(name))[1] = tm.id
        and (storage.foldername(name))[2] = m.id::text
        and m.status = 'recording'
    )
  );
