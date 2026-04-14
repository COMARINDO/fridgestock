-- Bakery ordering module (additive)
-- Safe to run alongside existing fridge schema.
-- Creates: bakery_products, bakery_orders, bakery_order_items

create table if not exists public.bakery_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'Stk',
  sort_order integer not null default 0,
  active boolean not null default true
);

create unique index if not exists bakery_products_name_unique
  on public.bakery_products(lower(name));

create table if not exists public.bakery_orders (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  delivery_date date not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists bakery_orders_location_date_unique
  on public.bakery_orders(location_id, delivery_date);

create index if not exists bakery_orders_date_idx
  on public.bakery_orders(delivery_date);

create table if not exists public.bakery_order_items (
  order_id uuid not null references public.bakery_orders(id) on delete cascade,
  product_id uuid not null references public.bakery_products(id) on delete restrict,
  quantity integer not null default 0,
  primary key (order_id, product_id)
);

create index if not exists bakery_order_items_product_idx
  on public.bakery_order_items(product_id);

-- Optional: keep updated_at fresh
create or replace function public.touch_bakery_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bakery_orders_touch_updated_at on public.bakery_orders;
create trigger bakery_orders_touch_updated_at
before update on public.bakery_orders
for each row execute function public.touch_bakery_orders_updated_at();

