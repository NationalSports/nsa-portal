-- ============================================================
-- NSA Portal – Real Team Roster & Accounting Role
-- Migration: 00006_team_roster
-- ============================================================

-- ─── 1. Add 'accounting' role to the user_profiles check constraint ──

alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('admin','gm','rep','csr','artist','art','production','prod_manager','prod_assistant','warehouse','accounting'));

-- ─── 2. Remove demo users ───────────────────────────────────

delete from public.user_profiles
where id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);

-- ─── 3. Insert real team roster (26 members) ─────────────────

insert into public.user_profiles (id, full_name, role, pin) values
  -- Admins (3)
  ('00000000-0000-0000-0000-000000000001', 'Steve Peterson',      'admin',      '1234'),
  ('00000000-0000-0000-0000-000000000010', 'Gayle Peterson',      'admin',      null),
  ('00000000-0000-0000-0000-000000000011', 'Mike Peterson',       'admin',      null),

  -- Sales Reps (6)
  ('00000000-0000-0000-0000-000000000020', 'Chase Koissian',      'rep',        null),
  ('00000000-0000-0000-0000-000000000021', 'Jered Hunt',          'rep',        null),
  ('00000000-0000-0000-0000-000000000022', 'Mike Mercuriali',     'rep',        null),
  ('00000000-0000-0000-0000-000000000023', 'Kevin McCormack',     'rep',        null),
  ('00000000-0000-0000-0000-000000000024', 'Jeff Bianchini',      'rep',        null),
  ('00000000-0000-0000-0000-000000000025', 'Kelly Bean',          'rep',        null),

  -- CSR (4) — Sharon is CSR with sales-rep-level account access
  ('00000000-0000-0000-0000-000000000030', 'Sharon Day-Monroe',   'csr',        null),
  ('00000000-0000-0000-0000-000000000031', 'Rachel Najara',       'csr',        null),
  ('00000000-0000-0000-0000-000000000032', 'Tegan Peterson',      'csr',        null),
  ('00000000-0000-0000-0000-000000000033', 'Tamara Rodriguez',    'csr',        null),

  -- Accounting (2) — CSR-level access + invoices/payments/QuickBooks
  ('00000000-0000-0000-0000-000000000040', 'Andrea Jung',         'accounting', null),
  ('00000000-0000-0000-0000-000000000041', 'Ellie Calzada',       'accounting', null),

  -- Warehouse (4)
  ('00000000-0000-0000-0000-000000000050', 'Kellen Coates',       'warehouse',  null),
  ('00000000-0000-0000-0000-000000000051', 'Noah Corral',         'warehouse',  null),
  ('00000000-0000-0000-0000-000000000052', 'Marcel Salceda',      'warehouse',  null),
  ('00000000-0000-0000-0000-000000000053', 'Irving Santos',       'warehouse',  null),

  -- Production (7)
  ('00000000-0000-0000-0000-000000000060', 'Paco Salceda',        'production', null),
  ('00000000-0000-0000-0000-000000000061', 'Liliana Moreno',      'production', null),
  ('00000000-0000-0000-0000-000000000062', 'Fransisco Moreno',    'production', null),
  ('00000000-0000-0000-0000-000000000063', 'Griselda Franco',     'production', null),
  ('00000000-0000-0000-0000-000000000064', 'Luiz Acosta',         'production', null),
  ('00000000-0000-0000-0000-000000000065', 'Claudia Hernandez',   'prod_assistant', null),
  ('00000000-0000-0000-0000-000000000066', 'Roberto Rivas',       'prod_assistant', null);

-- ─── 4. RLS policy updates for 'accounting' role ─────────────
-- Accounting gets CSR-level access + invoice/payment write access.
-- We drop and recreate policies that need to include 'accounting'.

-- Customers: accounting can insert (like CSR)
drop policy if exists "customers_rep_insert" on public.customers;
create policy "customers_rep_insert" on public.customers
  for insert with check (
    public.current_user_role() in ('rep','csr','accounting')
  );

-- Art files: accounting can write (like CSR)
drop policy if exists "art_files_write" on public.art_files;
create policy "art_files_write" on public.art_files
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('artist','rep','csr','accounting')
  );

-- Pick lines: accounting can write (like CSR)
drop policy if exists "pick_lines_write" on public.pick_lines;
create policy "pick_lines_write" on public.pick_lines
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('warehouse','rep','csr','accounting')
  );

-- PO lines: accounting can write (like CSR)
drop policy if exists "po_lines_write" on public.po_lines;
create policy "po_lines_write" on public.po_lines
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('warehouse','rep','csr','accounting')
  );

-- Batch POs: accounting can write (like CSR)
drop policy if exists "batch_pos_write" on public.batch_pos;
create policy "batch_pos_write" on public.batch_pos
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','warehouse','accounting')
  );

drop policy if exists "batch_po_items_write" on public.batch_po_items;
create policy "batch_po_items_write" on public.batch_po_items
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','warehouse','accounting')
  );

-- Invoices: accounting can insert/update (new — previously admin/GM only)
create policy "invoices_accounting_write" on public.invoices
  for all using (
    public.current_user_role() = 'accounting'
  );

-- Invoice payments: accounting can insert/update (new — previously admin/GM only)
create policy "inv_payments_accounting_write" on public.invoice_payments
  for all using (
    public.current_user_role() = 'accounting'
  );

-- Sales orders: accounting can insert/update (like CSR — for order management)
create policy "so_accounting_write" on public.sales_orders
  for all using (
    public.current_user_role() = 'accounting'
  );

-- SO items: accounting can write
create policy "so_items_accounting_write" on public.sales_order_items
  for all using (
    public.current_user_role() = 'accounting'
  );

-- Estimates: accounting can manage
create policy "estimates_accounting_write" on public.estimates
  for all using (
    public.current_user_role() = 'accounting'
  );
