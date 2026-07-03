-- Fixture for apply_coach_art_decision: so_jobs + so_art_files from their
-- production definitions (00007 base + the columns later migrations added that
-- the function touches), minimal sales_orders stub.
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create table sales_orders (id text primary key, updated_at text);

create table so_art_files (
  id text not null,
  so_id text not null references sales_orders(id) on delete cascade,
  name text, deco_type text, ink_colors text, thread_colors text, art_size text,
  files jsonb default '[]', mockup_files jsonb default '[]', prod_files jsonb default '[]',
  notes text, status text default 'needs_art', uploaded text,
  art_sizes jsonb default '{}', garment_colors jsonb default '{}',
  item_mockups jsonb default '{}', color_ways jsonb default '[]',
  preview_url text, sample_art jsonb default '[]', stitches int,
  _version int not null default 1, archived boolean default false,
  prod_files_attached boolean, mock_links jsonb default '{}', design_id text,
  web_logos jsonb, web_logo_url text,
  primary key (so_id, id)
);

create table so_jobs (
  id text not null,
  so_id text not null references sales_orders(id) on delete cascade,
  key text, art_file_id text, art_name text, deco_type text, positions text,
  art_status text default 'needs_art', item_status text default 'need_to_order',
  prod_status text default 'hold', total_units int default 0, fulfilled_units int default 0,
  split_from text, created_at text, assigned_machine text, assigned_to text, ship_method text,
  items jsonb default '[]', _auto boolean default false,
  art_requests jsonb default '[]', art_messages jsonb default '[]',
  assigned_artist text, rep_notes text, rejections jsonb default '[]',
  coach_rejected boolean default false,
  sent_to_coach_at timestamptz, coach_approved_at timestamptz,
  coach_email_opened_at timestamptz, follow_up_at timestamptz,
  sent_history jsonb, _merged boolean default false, coach_approval_comment text,
  art_hidden boolean default false, _art_ids jsonb,
  primary key (so_id, id)
);

insert into sales_orders (id, updated_at) values ('SO-1', '1/1/2026, 9:00:00 AM');
insert into so_art_files (so_id, id, name, deco_type, status, prod_files_attached, mockup_files, item_mockups, notes)
values
  ('SO-1', 'art1', 'Tigers Logo', 'screen_print', 'needs_approval', true,
   '["https://cdn/x/mock-v1.png"]'::jsonb,
   '{"TEE|Red":[{"url":"https://cdn/x/item-mock-1.png"}]}'::jsonb, 'orig note'),
  ('SO-1', 'art2', 'Back Number', 'screen_print', 'needs_approval', null,
   '[{"url":"https://cdn/x/back-mock.png"}]'::jsonb, '{}'::jsonb, null);
insert into so_jobs (so_id, id, art_name, deco_type, art_status, coach_rejected, sent_to_coach_at, _art_ids)
values ('SO-1', 'JOB-1-01', 'Tigers Logo + Back', 'screen_print', 'waiting_approval', true,
        '2026-07-01T10:00:00Z', '["art1","art2"]'::jsonb);
