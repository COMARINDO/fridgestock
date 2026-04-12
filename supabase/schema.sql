-- Fridge Stock App schema
-- Designed for: simple anon-key access (no Supabase Auth), plain-text passwords.
-- If you enable RLS: für uneingeschränkten Anon-Zugriff siehe `rls-open-anon.sql`.

-- Users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  password text not null
);

-- Products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  product_name text not null,
  zusatz text,
  barcode text unique,
  short_name text,
  min_quantity integer not null default 0
);

-- Admin pricing (optional columns; run if table already exists without them)
alter table public.products add column if not exists supplier text;
alter table public.products add column if not exists purchase_price numeric;
alter table public.products add column if not exists selling_price numeric;

-- No duplicate products: brand + product_name + zusatz
create unique index if not exists products_brand_product_zusatz_unique
  on public.products(brand, product_name, coalesce(zusatz, ''));

-- Locations (tree)
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.locations(id) on delete set null
);

create index if not exists locations_parent_id_idx on public.locations(parent_id);

-- Optional: mapping users to locations
create table if not exists public.location_users (
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  role text,
  primary key (user_id, location_id)
);

-- Inventory snapshot (always full quantity)
-- IMPORTANT: inventory is stored ONLY on parent locations (parent_id is null).
create table if not exists public.inventory (
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 0,
  primary key (location_id, product_id)
);

-- History of snapshots
create table if not exists public.inventory_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null,
  timestamp timestamptz not null default now(),
  is_transfer boolean not null default false
);

alter table public.inventory_history add column if not exists is_transfer boolean not null default false;

create index if not exists inventory_history_loc_prod_time_idx
  on public.inventory_history(location_id, product_id, timestamp desc);

-- Single RPC for "overwrite inventory + append history" (atomic)
create or replace function public.set_inventory_quantity(
  p_user_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_quantity integer
) returns void
language plpgsql
security definer
as $$
begin
  insert into public.inventory (location_id, product_id, quantity)
  values (p_location_id, p_product_id, p_quantity)
  on conflict (location_id, product_id)
  do update set quantity = excluded.quantity;

  insert into public.inventory_history (user_id, location_id, product_id, quantity)
  values (p_user_id, p_location_id, p_product_id, p_quantity);
end;
$$;

-- Usage helpers (consumption only, ignore refills)
-- Calculates usage as sum of negative diffs between consecutive snapshots.
create or replace function public.usage_by_location_product_since(
  p_since timestamptz
) returns table (
  location_id uuid,
  product_id uuid,
  usage integer
)
language sql
stable
as $$
  with ordered as (
    select
      ih.location_id,
      ih.product_id,
      ih.timestamp,
      ih.quantity,
      lag(ih.quantity) over (
        partition by ih.location_id, ih.product_id
        order by ih.timestamp
      ) as prev_quantity
    from public.inventory_history ih
    where ih.timestamp >= p_since
      and not ih.is_transfer
  ),
  diffs as (
    select
      location_id,
      product_id,
      (quantity - prev_quantity) as diff
    from ordered
    where prev_quantity is not null
  )
  select
    location_id,
    product_id,
    coalesce(sum(case when diff < 0 then -diff else 0 end), 0)::integer as usage
  from diffs
  group by location_id, product_id;
$$;


