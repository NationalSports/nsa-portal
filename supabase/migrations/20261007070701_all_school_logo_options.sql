-- A shopper-facing garment can contain several independently decorated color groups.
-- Keep variant_group_id for color editing and use this key only for storefront grouping.
alter table public.webstore_products
  add column if not exists school_style_group_id uuid,
  add column if not exists school_design_label text;

create index if not exists webstore_products_school_style_group_idx
  on public.webstore_products (store_id, school_style_group_id)
  where school_style_group_id is not null;
