-- RLS lockdown, step 2 — staff-only WRITES across the core order schema.
--
-- Follows 00173 (team_members / app_state / scheduled_emails). Closes the gap where ANY
-- authenticated session — including magic-link coach accounts, which share the
-- `authenticated` role — could write the entire order book (customers, estimates,
-- sales orders, invoices, credits/promos). Verified against live policies and code
-- before this was written:
--
--   * Every public/coach WRITE path is already server-mediated: portal-action,
--     webstore-checkout, stripe-payment and the digests run with the service-role key
--     (RLS-exempt), and coach art decisions go through the apply_coach_art_decision RPC
--     (not executable by anon/authenticated). Client-side anon/coach writes are
--     optimistic-only and already fail, so gating writes on is_team_member() breaks no
--     live flow.
--   * The anonymous coach portal (?portal=<alpha_tag>) mounts the full app as anon and
--     RENDERS from: customers(+contacts/credits/promos), estimates(+items/art/decos),
--     sales_orders(+items/jobs/art/decos/pick_lines/po_lines/firm_dates) and
--     invoices(+items/payments). Their SELECTs stay open to anon AND authenticated
--     (a signed-in coach carries the authenticated role in the same browser).
--     Narrowing reads is a later step — it first requires moving the portal's loads
--     server-side (a portal-action-style loader) or the portal goes blank.
--   * customer_invoices / customer_invoice_lines (NetSuite history) and messages /
--     message_reads have NO public reader (messages anon read was already dropped in
--     00162; the others are only read on staff screens) — they become fully staff-only.
--     customer_invoices/lines were still `FOR ALL USING(true)` TO PUBLIC — the last
--     anon-WRITABLE tables in the order schema.
--   * save_estimate is SECURITY INVOKER, so it inherits these policies. Staff sessions
--     are linked on login (LoginGate → link_team_auth / get_my_profile), so every user
--     who can sign in today satisfies is_team_member(); team members with no auth
--     account cannot sign in (and so cannot write) today either — no regression.
--
-- Also hardens link_team_auth(): it was SECURITY DEFINER with NO authorization check —
-- any authenticated session (i.e. any coach) could point any team_members.auth_id at
-- any account. Once writes are gated on is_team_member(), that is a self-service
-- staff-promotion endpoint, so it must land in the same migration. It now only lets a
-- caller bind THEIR OWN auth account to the team row matching their verified login
-- email, and never re-binds a row already linked to a different account. This matches
-- the only two client call sites (LoginGate first-time setup and the sign-in
-- link-by-email fallback); the team-invite function writes auth_id directly with the
-- service key and bypasses this entirely.

-- ── link_team_auth: self-link only, email must match, no re-binding ──────────────
create or replace function public.link_team_auth(p_team_id text, p_auth_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_email  text;
  v_linked uuid;
begin
  if auth.uid() is null or p_auth_id is distinct from auth.uid() then
    raise exception 'link_team_auth: callers may only link their own account';
  end if;
  select lower(tm.email), tm.auth_id into v_email, v_linked
    from public.team_members tm
   where tm.id = p_team_id;
  if not found then
    raise exception 'link_team_auth: unknown team member %', p_team_id;
  end if;
  if v_email is null or v_email <> lower(coalesce(auth.jwt()->>'email', '')) then
    raise exception 'link_team_auth: login email does not match this team member';
  end if;
  if v_linked is not null and v_linked <> auth.uid() then
    raise exception 'link_team_auth: team member already linked to another account';
  end if;
  update public.team_members
     set auth_id = p_auth_id, password_set = true
   where id = p_team_id;
end;
$$;
revoke all on function public.link_team_auth(text, uuid) from public;
revoke all on function public.link_team_auth(text, uuid) from anon;
grant execute on function public.link_team_auth(text, uuid) to authenticated;

-- ── Core order schema: reads stay as today (anon + authenticated), writes → staff ──
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','customer_contacts','customer_credits','customer_credit_usage',
    'customer_promo_periods','customer_promo_programs','customer_promo_usage',
    'estimates','estimate_items','estimate_art_files','estimate_item_decorations',
    'sales_orders','so_items','so_jobs','so_art_files','so_item_decorations',
    'so_item_pick_lines','so_item_po_lines','so_firm_dates',
    'invoices','invoice_items','invoice_payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- Legacy write policies (names vary by table; each drop is a no-op elsewhere).
    execute format('drop policy if exists "Allow all" on public.%I', t);
    execute format('drop policy if exists est_art_write on public.%I', t);
    execute format('drop policy if exists est_deco_write on public.%I', t);
    execute format('drop policy if exists so_art_write on public.%I', t);
    execute format('drop policy if exists so_deco_write on public.%I', t);
    execute format('drop policy if exists firm_dates_write on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_team_member()) with check (public.is_team_member())',
      t || '_staff_write', t);
  end loop;
end $$;

-- ── No public reader: fully staff-only (mirrors 00162's treatment of messages) ──
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages','message_reads','customer_invoices','customer_invoice_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Allow all" on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_team_member()) with check (public.is_team_member())',
      t || '_staff_all', t);
    execute format(
      'revoke select, insert, update, delete, truncate, references, trigger on public.%I from anon', t);
  end loop;
end $$;
