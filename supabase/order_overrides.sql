-- Manual order quantity overrides (admin Bestellübersicht)
-- Nach Ausführung: bei offenem RLS auch supabase/rls-open-anon.sql erneut ausführen oder Policy für order_overrides ergänzen.

create table if not exists public.order_overrides (
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null,
  updated_at timestamptz not null default now(),
  primary key (location_id, product_id)
);

create index if not exists order_overrides_updated_at_idx
  on public.order_overrides (updated_at desc);
