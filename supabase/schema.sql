-- Fridge Stock App schema
-- Designed for: simple anon-key access (no Supabase Auth), plain-text passwords.
-- If you enable RLS, you must add policies accordingly.

-- Users
create table if not exists public.users (
  id bigserial primary key,
  name text not null unique,
  password text not null
);

-- Products
create table if not exists public.products (
  id bigserial primary key,
  name text not null unique,
  min_quantity integer not null default 0
);

-- Locations (tree)
create table if not exists public.locations (
  id bigserial primary key,
  name text not null,
  parent_id bigint references public.locations(id) on delete set null
);

create index if not exists locations_parent_id_idx on public.locations(parent_id);

-- Optional: mapping users to locations
create table if not exists public.location_users (
  user_id bigint not null references public.users(id) on delete cascade,
  location_id bigint not null references public.locations(id) on delete cascade,
  role text,
  primary key (user_id, location_id)
);

-- Inventory snapshot (always full quantity)
create table if not exists public.inventory (
  location_id bigint not null references public.locations(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  quantity integer not null default 0,
  primary key (location_id, product_id)
);

-- History of snapshots
create table if not exists public.inventory_history (
  id bigserial primary key,
  user_id bigint references public.users(id) on delete set null,
  location_id bigint not null references public.locations(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  quantity integer not null,
  timestamp timestamptz not null default now()
);

create index if not exists inventory_history_loc_prod_time_idx
  on public.inventory_history(location_id, product_id, timestamp desc);

-- Single RPC for "overwrite inventory + append history" (atomic)
create or replace function public.set_inventory_quantity(
  p_user_id bigint,
  p_location_id bigint,
  p_product_id bigint,
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

