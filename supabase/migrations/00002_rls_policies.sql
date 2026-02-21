-- ============================================================
-- NSA Portal – Row Level Security Policies
-- Migration: 00002_rls_policies
-- ============================================================
-- Strategy:
--   • Admin / GM  → full access to everything
--   • Rep         → own customers + related estimates/SOs/invoices
--   • Production / Warehouse / Artist → read SOs & jobs, write job status
--   • All authed  → read products, vendors, decoration_types, price_matrix

-- Helper: get current user's profile role
create or replace function public.current_user_role()
returns text as $$
  select role from public.user_profiles
  where auth_id = auth.uid()
  limit 1;
$$ language sql security definer stable;

-- Helper: get current user's profile id
create or replace function public.current_profile_id()
returns uuid as $$
  select id from public.user_profiles
  where auth_id = auth.uid()
  limit 1;
$$ language sql security definer stable;

-- Helper: is admin or gm?
create or replace function public.is_admin_or_gm()
returns boolean as $$
  select exists (
    select 1 from public.user_profiles
    where auth_id = auth.uid()
      and role in ('admin','gm')
  );
$$ language sql security definer stable;

-- ─── Enable RLS on all tables ──────────────────────────────

alter table public.user_profiles              enable row level security;
alter table public.customers                  enable row level security;
alter table public.customer_contacts          enable row level security;
alter table public.vendors                    enable row level security;
alter table public.products                   enable row level security;
alter table public.product_variants           enable row level security;
alter table public.inventory                  enable row level security;
alter table public.inventory_adjustments      enable row level security;
alter table public.decoration_types           enable row level security;
alter table public.price_matrix               enable row level security;
alter table public.art_files                  enable row level security;
alter table public.estimates                  enable row level security;
alter table public.estimate_items             enable row level security;
alter table public.estimate_item_decorations  enable row level security;
alter table public.estimate_art_files         enable row level security;
alter table public.sales_orders               enable row level security;
alter table public.sales_order_items          enable row level security;
alter table public.sales_order_item_decorations enable row level security;
alter table public.sales_order_art_files      enable row level security;
alter table public.firm_dates                 enable row level security;
alter table public.pick_lines                 enable row level security;
alter table public.po_lines                   enable row level security;
alter table public.po_shipments               enable row level security;
alter table public.production_jobs            enable row level security;
alter table public.production_job_items       enable row level security;
alter table public.invoices                   enable row level security;
alter table public.invoice_payments           enable row level security;
alter table public.messages                   enable row level security;
alter table public.message_reads              enable row level security;
alter table public.batch_pos                  enable row level security;
alter table public.batch_po_items             enable row level security;
alter table public.omg_stores                 enable row level security;
alter table public.omg_store_products         enable row level security;
alter table public.favorite_skus              enable row level security;
alter table public.id_sequences               enable row level security;

-- ─── USER_PROFILES ─────────────────────────────────────────

-- Everyone can read all profiles (needed for name lookups)
create policy "profiles_select" on public.user_profiles
  for select using (true);

-- Users can update their own profile
create policy "profiles_update_own" on public.user_profiles
  for update using (auth_id = auth.uid());

-- Admin/GM can manage all profiles
create policy "profiles_admin_all" on public.user_profiles
  for all using (public.is_admin_or_gm());

-- ─── CUSTOMERS ─────────────────────────────────────────────

-- Admin/GM see all; reps see only their assigned customers
create policy "customers_select" on public.customers
  for select using (
    public.is_admin_or_gm()
    or primary_rep_id = public.current_profile_id()
    or public.current_user_role() in ('production','warehouse','artist','csr')
  );

create policy "customers_admin_all" on public.customers
  for all using (public.is_admin_or_gm());

create policy "customers_rep_insert" on public.customers
  for insert with check (
    public.current_user_role() in ('rep','csr')
  );

create policy "customers_rep_update" on public.customers
  for update using (
    primary_rep_id = public.current_profile_id()
  );

-- ─── CUSTOMER_CONTACTS ─────────────────────────────────────

create policy "contacts_select" on public.customer_contacts
  for select using (true);

create policy "contacts_admin_all" on public.customer_contacts
  for all using (public.is_admin_or_gm());

create policy "contacts_rep_manage" on public.customer_contacts
  for all using (
    exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.primary_rep_id = public.current_profile_id()
    )
  );

-- ─── REFERENCE DATA (read-only for most) ───────────────────

-- Vendors: everyone reads, admin writes
create policy "vendors_select" on public.vendors
  for select using (true);
create policy "vendors_admin_all" on public.vendors
  for all using (public.is_admin_or_gm());

-- Products: everyone reads, admin writes
create policy "products_select" on public.products
  for select using (true);
create policy "products_admin_all" on public.products
  for all using (public.is_admin_or_gm());

-- Product variants: everyone reads
create policy "variants_select" on public.product_variants
  for select using (true);
create policy "variants_admin_all" on public.product_variants
  for all using (public.is_admin_or_gm());

-- Inventory: everyone reads, warehouse/admin writes
create policy "inventory_select" on public.inventory
  for select using (true);
create policy "inventory_write" on public.inventory
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() = 'warehouse'
  );

-- Inventory adjustments: everyone reads, warehouse/admin writes
create policy "inv_adj_select" on public.inventory_adjustments
  for select using (true);
create policy "inv_adj_write" on public.inventory_adjustments
  for insert with check (
    public.is_admin_or_gm()
    or public.current_user_role() = 'warehouse'
  );

-- Decoration types: everyone reads
create policy "deco_types_select" on public.decoration_types
  for select using (true);
create policy "deco_types_admin" on public.decoration_types
  for all using (public.is_admin_or_gm());

-- Price matrix: everyone reads
create policy "price_matrix_select" on public.price_matrix
  for select using (true);
create policy "price_matrix_admin" on public.price_matrix
  for all using (public.is_admin_or_gm());

-- ─── ART FILES ─────────────────────────────────────────────

create policy "art_files_select" on public.art_files
  for select using (true);
create policy "art_files_write" on public.art_files
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('artist','rep','csr')
  );

-- ─── ESTIMATES ─────────────────────────────────────────────

create policy "estimates_select" on public.estimates
  for select using (
    public.is_admin_or_gm()
    or created_by = public.current_profile_id()
    or exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.primary_rep_id = public.current_profile_id()
    )
  );

create policy "estimates_admin_all" on public.estimates
  for all using (public.is_admin_or_gm());

create policy "estimates_rep_manage" on public.estimates
  for all using (
    created_by = public.current_profile_id()
    or exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.primary_rep_id = public.current_profile_id()
    )
  );

-- Estimate items / decorations / art: inherit from parent estimate
create policy "est_items_select" on public.estimate_items
  for select using (true);
create policy "est_items_write" on public.estimate_items
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.estimates e
      where e.id = estimate_id
        and (e.created_by = public.current_profile_id())
    )
  );

create policy "est_deco_select" on public.estimate_item_decorations
  for select using (true);
create policy "est_deco_write" on public.estimate_item_decorations
  for all using (public.is_admin_or_gm() or true);

create policy "est_art_select" on public.estimate_art_files
  for select using (true);
create policy "est_art_write" on public.estimate_art_files
  for all using (public.is_admin_or_gm() or true);

-- ─── SALES ORDERS ──────────────────────────────────────────

create policy "so_select" on public.sales_orders
  for select using (true);  -- all staff need to see SOs

create policy "so_admin_all" on public.sales_orders
  for all using (public.is_admin_or_gm());

create policy "so_rep_manage" on public.sales_orders
  for all using (
    created_by = public.current_profile_id()
    or exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.primary_rep_id = public.current_profile_id()
    )
  );

-- SO sub-tables: wide read, scoped write
create policy "so_items_select" on public.sales_order_items
  for select using (true);
create policy "so_items_write" on public.sales_order_items
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.sales_orders s
      where s.id = sales_order_id
        and s.created_by = public.current_profile_id()
    )
  );

create policy "so_deco_select" on public.sales_order_item_decorations
  for select using (true);
create policy "so_deco_write" on public.sales_order_item_decorations
  for all using (public.is_admin_or_gm() or true);

create policy "so_art_select" on public.sales_order_art_files
  for select using (true);
create policy "so_art_write" on public.sales_order_art_files
  for all using (public.is_admin_or_gm() or true);

create policy "firm_dates_select" on public.firm_dates
  for select using (true);
create policy "firm_dates_write" on public.firm_dates
  for all using (public.is_admin_or_gm() or true);

-- ─── FULFILLMENT: PICK LINES & PO LINES ───────────────────

create policy "pick_lines_select" on public.pick_lines
  for select using (true);
create policy "pick_lines_write" on public.pick_lines
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('warehouse','rep','csr')
  );

create policy "po_lines_select" on public.po_lines
  for select using (true);
create policy "po_lines_write" on public.po_lines
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('warehouse','rep','csr')
  );

create policy "po_shipments_select" on public.po_shipments
  for select using (true);
create policy "po_shipments_write" on public.po_shipments
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() = 'warehouse'
  );

-- ─── PRODUCTION JOBS ───────────────────────────────────────

create policy "jobs_select" on public.production_jobs
  for select using (true);
create policy "jobs_write" on public.production_jobs
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('production','artist')
  );

create policy "job_items_select" on public.production_job_items
  for select using (true);
create policy "job_items_write" on public.production_job_items
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('production','artist')
  );

-- ─── INVOICES ──────────────────────────────────────────────

create policy "invoices_select" on public.invoices
  for select using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.primary_rep_id = public.current_profile_id()
    )
  );

create policy "invoices_admin_all" on public.invoices
  for all using (public.is_admin_or_gm());

create policy "inv_payments_select" on public.invoice_payments
  for select using (true);
create policy "inv_payments_write" on public.invoice_payments
  for all using (public.is_admin_or_gm());

-- ─── MESSAGES ──────────────────────────────────────────────

create policy "messages_select" on public.messages
  for select using (true);  -- all staff can read messages
create policy "messages_insert" on public.messages
  for insert with check (true);  -- all staff can post

create policy "msg_reads_select" on public.message_reads
  for select using (true);
create policy "msg_reads_insert" on public.message_reads
  for insert with check (user_id = public.current_profile_id());

-- ─── BATCH POs ─────────────────────────────────────────────

create policy "batch_pos_select" on public.batch_pos
  for select using (true);
create policy "batch_pos_write" on public.batch_pos
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','warehouse')
  );

create policy "batch_po_items_select" on public.batch_po_items
  for select using (true);
create policy "batch_po_items_write" on public.batch_po_items
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','warehouse')
  );

-- ─── OMG STORES ────────────────────────────────────────────

create policy "omg_stores_select" on public.omg_stores
  for select using (true);
create policy "omg_stores_write" on public.omg_stores
  for all using (
    public.is_admin_or_gm()
    or rep_id = public.current_profile_id()
  );

create policy "omg_products_select" on public.omg_store_products
  for select using (true);
create policy "omg_products_write" on public.omg_store_products
  for all using (public.is_admin_or_gm() or true);

-- ─── FAVORITES ─────────────────────────────────────────────

create policy "favs_select" on public.favorite_skus
  for select using (user_id = public.current_profile_id());
create policy "favs_manage" on public.favorite_skus
  for all using (user_id = public.current_profile_id());

-- ─── ID SEQUENCES ──────────────────────────────────────────

create policy "seq_select" on public.id_sequences
  for select using (true);
create policy "seq_update" on public.id_sequences
  for all using (true);  -- called via server function
