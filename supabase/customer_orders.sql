-- Customer orders submitted via the public chat (/order page, no login).
-- Anonymous role darf hier INSERT machen (sonst koennten Kunden ohne Login
-- keine Bestellung absetzen), aber NICHT lesen oder updaten/loeschen.
-- Lesen + Status-Updates passieren ueber Service-Role (Server-API + Admin).
--
-- Ausfuehren: Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  product text not null,
  quantity integer not null check (quantity > 0),
  name text not null,
  phone text not null,
  pickup_time text not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  status text not null default 'open'
    check (status in ('open', 'confirmed', 'forwarded', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_orders is
  'Bestellungen aus dem oeffentlichen Chatbot (/order). Anon darf nur INSERT.';

create index if not exists idx_customer_orders_location_created
  on public.customer_orders (location_id, created_at desc);
create index if not exists idx_customer_orders_status_created
  on public.customer_orders (status, created_at desc);

-- updated_at automatisch mitfuehren
create or replace function public.touch_customer_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_customer_orders_touch on public.customer_orders;
create trigger trg_customer_orders_touch
  before update on public.customer_orders
  for each row execute function public.touch_customer_orders_updated_at();

-- RLS: anon darf NUR INSERT, kein SELECT/UPDATE/DELETE.
alter table public.customer_orders enable row level security;

drop policy if exists customer_orders_anon_insert on public.customer_orders;
create policy customer_orders_anon_insert
  on public.customer_orders
  for insert
  to anon, authenticated
  with check (true);

-- Bewusst keine SELECT-Policy fuer anon: niemand kann fremde Bestellungen lesen.
-- Service-Role bypassed RLS automatisch (Admin-API).
