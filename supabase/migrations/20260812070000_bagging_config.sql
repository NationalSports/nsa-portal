-- Shared Bagging Station config (manager-set expectation pace etc.).
-- Service-role only, tiny key/value. Applied 2026-08-12 (bagging_config).
create table if not exists bagging_config (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table bagging_config enable row level security;
insert into bagging_config(key, value) values ('target_sec_per_unit', '30'::jsonb)
on conflict (key) do nothing;
