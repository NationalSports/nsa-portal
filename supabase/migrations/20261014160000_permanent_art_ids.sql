-- Permanent Art IDs: ART-000123 for each logo in a customer art folder, plus
-- -V01 (garment-color version) and -R01 (revision of that version's print file).
--
-- Numbers are server-assigned from a sequence and never reused or renumbered.
-- Only a brand-new entry draws from the sequence, so ordinary saves leave no gaps.
-- The key is the art-folder entry (customer id + art id): one logo copied into a
-- parent and a child folder is two folder entries, so it gets two numbers.
-- Nothing in customers.art_files or any order is rewritten by this migration.

create sequence if not exists public.art_number_seq start with 1;

create table if not exists public.art_ids (
  art_number bigint primary key default nextval('public.art_number_seq'),
  customer_id text not null,
  art_id text not null,
  created_at timestamptz not null default now(),
  unique (customer_id, art_id)
);
alter sequence public.art_number_seq owned by public.art_ids.art_number;

create table if not exists public.art_id_versions (
  art_number bigint not null references public.art_ids(art_number),
  variant_key text not null,
  variant_no int not null check (variant_no > 0),
  revision_key text not null,
  revision_no int not null check (revision_no > 0),
  created_at timestamptz not null default now(),
  primary key (art_number, revision_key),
  unique (art_number, variant_no, revision_no)
);

-- Staff read; writes only through the definer functions below.
alter table public.art_ids enable row level security;
alter table public.art_id_versions enable row level security;
drop policy if exists art_ids_staff_read on public.art_ids;
create policy art_ids_staff_read on public.art_ids for select to authenticated using ((select public.is_team_member()));
drop policy if exists art_id_versions_staff_read on public.art_id_versions;
create policy art_id_versions_staff_read on public.art_id_versions for select to authenticated using ((select public.is_team_member()));
revoke all on public.art_ids, public.art_id_versions from anon;
grant select on public.art_ids, public.art_id_versions to authenticated;
grant all on public.art_ids, public.art_id_versions to service_role;

create or replace function public.art_code(p_number bigint, p_variant int default null, p_revision int default null)
returns text language sql immutable as $$
  select 'ART-' || lpad(p_number::text, 6, '0')
    || case when p_variant is null then '' else '-V' || lpad(p_variant::text, 2, '0') end
    || case when p_revision is null then '' else '-R' || lpad(p_revision::text, 2, '0') end
$$;

-- Idempotent: the same inputs always return the same code.
-- p_variant_key is the garment color (normalized); p_revision_key is the reviewed
-- DTF variant id, which changes whenever the print file/size/knockout changes.
create or replace function public.assign_art_code(
  p_customer_id text,
  p_art_id text,
  p_variant_key text default null,
  p_revision_key text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
  v_variant int;
  v_revision int;
  v_key text := lower(regexp_replace(btrim(coalesce(p_variant_key, '')), '\s+', ' ', 'g'));
begin
  if not public.is_team_member() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'active staff session required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_customer_id, '')) = '' or btrim(coalesce(p_art_id, '')) = '' then
    raise exception 'customer and art id are required' using errcode = '22023';
  end if;

  -- Look first: an insert that hits the conflict would still burn a sequence value.
  select art_number into v_number from art_ids where customer_id = p_customer_id and art_id = p_art_id;
  if v_number is null then
    insert into art_ids (customer_id, art_id) values (p_customer_id, p_art_id)
      on conflict (customer_id, art_id) do nothing;
    select art_number into v_number from art_ids where customer_id = p_customer_id and art_id = p_art_id;
  end if;

  if btrim(coalesce(p_revision_key, '')) = '' then
    return public.art_code(v_number);
  end if;
  if v_key = '' then
    raise exception 'garment color is required for a versioned art id' using errcode = '22023';
  end if;

  -- One art number at a time so two sends can't take the same V/R numbers.
  perform pg_advisory_xact_lock(hashtext('art_id_versions'), v_number::int);

  select variant_no, revision_no into v_variant, v_revision
    from art_id_versions where art_number = v_number and revision_key = p_revision_key;
  if found then
    return public.art_code(v_number, v_variant, v_revision);
  end if;

  select min(variant_no) into v_variant from art_id_versions where art_number = v_number and variant_key = v_key;
  if v_variant is null then
    select coalesce(max(variant_no), 0) + 1 into v_variant from art_id_versions where art_number = v_number;
  end if;
  select coalesce(max(revision_no), 0) + 1 into v_revision
    from art_id_versions where art_number = v_number and variant_no = v_variant;

  insert into art_id_versions (art_number, variant_key, variant_no, revision_key, revision_no)
    values (v_number, v_key, v_variant, p_revision_key, v_revision);
  return public.art_code(v_number, v_variant, v_revision);
end;
$$;
revoke all on function public.assign_art_code(text, text, text, text) from public, anon;
grant execute on function public.assign_art_code(text, text, text, text) to authenticated, service_role;

-- Every art-folder entry gets its number as soon as it is saved. This must never
-- block a customer save, so any failure is only logged.
create or replace function public.register_customer_art_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(new.art_files) = 'array' then
    insert into art_ids (customer_id, art_id)
    select new.id, e.value->>'id'
      from jsonb_array_elements(new.art_files) with ordinality as e(value, n)
     where jsonb_typeof(e.value) = 'object' and btrim(coalesce(e.value->>'id', '')) <> ''
       and not exists (select 1 from art_ids a where a.customer_id = new.id and a.art_id = e.value->>'id')
     order by e.n
    on conflict (customer_id, art_id) do nothing;
  end if;
  return null;
exception when others then
  raise warning 'register_customer_art_ids skipped for %: %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function public.register_customer_art_ids() from public, anon, authenticated;

drop trigger if exists customers_register_art_ids on public.customers;
create trigger customers_register_art_ids
  after insert or update of art_files on public.customers
  for each row execute function public.register_customer_art_ids();

-- Number the existing art folders once, in a stable order.
insert into public.art_ids (customer_id, art_id)
select c.id, e.value->>'id'
  from public.customers c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.art_files) = 'array' then c.art_files else '[]'::jsonb end)
       with ordinality as e(value, n)
 where jsonb_typeof(e.value) = 'object' and btrim(coalesce(e.value->>'id', '')) <> ''
   and not exists (select 1 from public.art_ids a where a.customer_id = c.id and a.art_id = e.value->>'id')
 order by c.id, e.n
on conflict (customer_id, art_id) do nothing;
