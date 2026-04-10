-- RESET + CLEAN PRODUCT STRUCTURE
-- Run this in Supabase SQL editor.
-- WARNING: This deletes inventory + history + all products.

begin;

-- 1) Delete dependent data first
delete from public.inventory_history;
delete from public.inventory;

-- 2) Delete products
delete from public.products;

-- 3) Ensure clean schema (products)
-- Keep id UUID. Remove legacy columns if you had them.
alter table public.products
  add column if not exists brand text,
  add column if not exists product_name text,
  add column if not exists zusatz text,
  add column if not exists barcode text,
  add column if not exists short_name text;

-- Drop legacy columns (safe if they don't exist)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='name'
  ) then
    execute 'alter table public.products drop column name';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products' and column_name='min_quantity'
  ) then
    execute 'alter table public.products drop column min_quantity';
  end if;
end $$;

-- Constraints
alter table public.products
  alter column brand set not null,
  alter column product_name set not null;

-- barcode unique (if barcode is used)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_barcode_unique'
  ) then
    execute 'alter table public.products add constraint products_barcode_unique unique (barcode)';
  end if;
exception when others then
  -- ignore (constraint might already exist with different name)
end $$;

-- No duplicate products: brand + product_name + zusatz
create unique index if not exists products_brand_product_zusatz_unique
  on public.products(brand, product_name, coalesce(zusatz, ''));

-- 4) Insert clean data
-- Replace these rows with your real product list + real barcodes.
-- Rules:
-- - product_name must NOT include brand
-- - zusatz must be like "0,25l" / "0,5l" / "1,5l"
-- - barcode must be unique (or null)
insert into public.products (brand, product_name, zusatz, barcode, short_name)
values
  ('Red Bull', 'Sugarfree', '0,25l', null, 're 0,25'),
  ('Coca Cola', 'Zero', '0,5l', null, 'co 0,5'),
  ('Rauch', 'Eistee Pfirsich', '0,5l', null, 'ra 0,5');

commit;

