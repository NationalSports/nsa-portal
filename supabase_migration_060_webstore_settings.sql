-- Global webstore defaults (singleton).
--
-- Staff-editable defaults shared across every store, set from Webstores → Store defaults:
--   • standard_categories — the section presets offered in the builder's category pickers
--   • checkout_message     — custom copy shown to shoppers at checkout
--   • default_options      — default add-on options seeded onto new items (name/number/etc.)
--
-- Public read (the storefront shows checkout_message to anon shoppers); writes are staff
-- (authenticated) only. Singleton row id=1.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

create table if not exists webstore_settings (
  id int primary key default 1,
  standard_categories text[] not null default '{}',
  checkout_message text,
  default_options jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint webstore_settings_singleton check (id = 1)
);
insert into webstore_settings (id) values (1) on conflict (id) do nothing;
alter table webstore_settings enable row level security;
drop policy if exists webstore_settings_read on webstore_settings;
create policy webstore_settings_read on webstore_settings for select using (true);
drop policy if exists webstore_settings_write on webstore_settings;
create policy webstore_settings_write on webstore_settings for all to authenticated using (true) with check (true);
