-- =====================================================================
-- Schwund / Inventur-Differenzen (Warehouse only)
--
-- Zweck:
--  - Nach einer Lager-Inventur erkennen, wenn der gezaehlte Bestand
--    niedriger ist als der erwartete Bestand (aus vorangegangenen
--    Ereignissen in `inventory_history`).
--  - Diese Differenzen lassen sich in der Admin-UI buchen oder
--    ignorieren. Das Buchen aendert den tatsaechlichen Bestand NICHT;
--    es dient ausschliesslich der Dokumentation.
--
-- Tabelle:
--  - public.inventory_discrepancies
--
-- Calculation Helper:
--  - public.inventory_shrinkage_for_session(p_location_id, p_session_no, p_gap)
--
-- Ausfuehrung:
--  - Komplette Datei im Supabase SQL-Editor ausfuehren.
--  - Idempotent (nutzt IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================

create table if not exists public.inventory_discrepancies (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  session_no integer not null,
  session_started_at timestamptz,
  prev_event_at timestamptz,
  prev_event_mode text,
  count_at timestamptz not null,
  expected_quantity integer not null,
  counted_quantity integer not null,
  shrink_quantity integer not null,
  status text not null default 'open'
    check (status in ('open', 'booked', 'ignored')),
  booked_at timestamptz,
  booked_by text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ein „offener/gebuchter" Eintrag pro (Location, Product, Session-Count-Zeitstempel).
-- So koennen wir beim Nachrechnen ON CONFLICT verwenden.
create unique index if not exists inventory_discrepancies_session_product_uniq
  on public.inventory_discrepancies (location_id, product_id, count_at);

create index if not exists inventory_discrepancies_location_session_idx
  on public.inventory_discrepancies (location_id, session_no);

create index if not exists inventory_discrepancies_status_idx
  on public.inventory_discrepancies (status);

-- Touch `updated_at` automatisch.
create or replace function public.touch_inventory_discrepancies_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists inventory_discrepancies_set_updated_at
  on public.inventory_discrepancies;

create trigger inventory_discrepancies_set_updated_at
before update on public.inventory_discrepancies
for each row
execute function public.touch_inventory_discrepancies_updated_at();

-- RLS: nur Service-Role schreibt/liest. Client-Zugriff laeuft ueber
-- die Admin-API-Routes mit SERVER_ACTION_SECRET.
alter table public.inventory_discrepancies enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_discrepancies'
      and policyname = 'service role full access'
  ) then
    create policy "service role full access"
      on public.inventory_discrepancies
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end;
$$;

-- =====================================================================
-- Berechnung: erwartet vs gezaehlt pro Session (Lager).
--
-- Logik:
--  - Eintraege in `inventory_history` enthalten IMMER die resultierende
--    Gesamtmenge nach dem Ereignis (nicht die Delta).
--  - Fuer jeden "count"-Eintrag in der Ziel-Session suchen wir die
--    unmittelbar davorliegende History-Zeile (beliebiger Modus) fuer
--    dieselbe Location/Produkt-Kombination. Deren `quantity` ist der
--    "erwartete" Bestand zum Zeitpunkt des Counts.
--  - Schwund = max(0, expected - counted).
--  - Falls keine Vorzeile existiert (erste Erfassung), wird das Produkt
--    nicht als Schwund gelistet.
-- =====================================================================
drop function if exists public.inventory_shrinkage_for_session(uuid, integer, interval);
create or replace function public.inventory_shrinkage_for_session(
  p_location_id uuid,
  p_session_no integer,
  p_gap interval default interval '5 hours'
) returns table (
  product_id uuid,
  brand text,
  product_name text,
  zusatz text,
  short_name text,
  expected_quantity integer,
  counted_quantity integer,
  shrink_quantity integer,
  count_at timestamptz,
  prev_event_at timestamptz,
  prev_event_mode text
)
language sql
stable
as $$
  with counts as (
    select
      ih.location_id,
      ih.product_id,
      ih.quantity,
      ih.timestamp,
      ih.id,
      case
        when lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) is null then 1
        when ih.timestamp - lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) > p_gap then 1
        else 0
      end as is_new_session
    from public.inventory_history ih
    where ih.location_id = p_location_id
      and ih.mode = 'count'
  ),
  sess as (
    select
      *,
      sum(is_new_session) over (partition by location_id order by timestamp) as session_no
    from counts
  ),
  latest_count as (
    select distinct on (s.product_id)
      s.product_id,
      s.quantity as counted_quantity,
      s.timestamp as count_at
    from sess s
    where s.session_no = p_session_no
    order by s.product_id, s.timestamp desc
  ),
  prev_event as (
    select
      lc.product_id,
      lc.counted_quantity,
      lc.count_at,
      (
        select ih2.quantity
        from public.inventory_history ih2
        where ih2.location_id = p_location_id
          and ih2.product_id = lc.product_id
          and ih2.timestamp < lc.count_at
        order by ih2.timestamp desc, ih2.id desc
        limit 1
      ) as expected_quantity,
      (
        select ih3.timestamp
        from public.inventory_history ih3
        where ih3.location_id = p_location_id
          and ih3.product_id = lc.product_id
          and ih3.timestamp < lc.count_at
        order by ih3.timestamp desc, ih3.id desc
        limit 1
      ) as prev_event_at,
      (
        select ih4.mode
        from public.inventory_history ih4
        where ih4.location_id = p_location_id
          and ih4.product_id = lc.product_id
          and ih4.timestamp < lc.count_at
        order by ih4.timestamp desc, ih4.id desc
        limit 1
      ) as prev_event_mode
    from latest_count lc
  )
  select
    pe.product_id,
    coalesce(p.brand, '') as brand,
    coalesce(p.product_name, '') as product_name,
    coalesce(p.zusatz, '') as zusatz,
    coalesce(p.short_name, '') as short_name,
    pe.expected_quantity::integer as expected_quantity,
    pe.counted_quantity::integer as counted_quantity,
    greatest(0, pe.expected_quantity - pe.counted_quantity)::integer as shrink_quantity,
    pe.count_at,
    pe.prev_event_at,
    pe.prev_event_mode
  from prev_event pe
  join public.products p on p.id = pe.product_id
  where pe.expected_quantity is not null
    and pe.expected_quantity > pe.counted_quantity
  order by p.brand, p.product_name, p.zusatz;
$$;

grant execute on function public.inventory_shrinkage_for_session(uuid, integer, interval) to service_role;
