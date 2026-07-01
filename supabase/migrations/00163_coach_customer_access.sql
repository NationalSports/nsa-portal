-- Many-to-many coach ↔ customer access for the roster system.
--
-- coach_accounts has a single customer_id, which can't represent a coach who
-- works with more than one club (common in practice — the same person coaches
-- for multiple accounts). Granting a coach access to a customer is a row here.
--
-- The coach-invite function (service role) upserts a row whenever staff or
-- another coach add a coach to an account; staff manage the list (remove) from
-- the customer's Roster tab. The coach portal's roster module gates on this
-- table, falling back to the legacy coach_accounts.customer_id for older rows.
create table if not exists public.coach_customer_access (
  coach_id    uuid not null references public.coach_accounts(id) on delete cascade,
  customer_id text not null,
  role        text not null default 'editor',
  created_at  timestamptz default now(),
  primary key (coach_id, customer_id)
);
create index if not exists idx_coach_customer_access_customer
  on public.coach_customer_access (customer_id);

alter table public.coach_customer_access enable row level security;
-- Staff and coaches are both authenticated (staff sign in w/ password, coaches
-- via magic link); inserts from the invite function use the service role and
-- bypass RLS, so this policy only governs client reads + staff removes.
drop policy if exists "coach_customer_access_auth" on public.coach_customer_access;
create policy "coach_customer_access_auth" on public.coach_customer_access
  for all to authenticated using (true) with check (true);

-- Preserve existing single-customer coach links under the new gate.
insert into public.coach_customer_access (coach_id, customer_id, role)
select id, customer_id, 'editor'
from public.coach_accounts
where customer_id is not null
on conflict (coach_id, customer_id) do nothing;
