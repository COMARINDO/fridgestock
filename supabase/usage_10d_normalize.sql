-- =====================================================================
-- Verbrauchsberechnung: Rückblick bis zu 14 Tage, normalisiert auf 14 Tage.
--
-- Zweck:
--  - Bestellvorschläge nutzen ein 14-Tage-Äquivalent aus `inventory_history`.
--  - Wenn die Historie kürzer ist als 14 Tage, wird per observed_days hochgerechnet.
--  - Diese Migration ersetzt `usage_by_location_product_since_with_coverage`.
--  - Die Basisfunktion `usage_by_location_product_since` bleibt unverändert.
--
-- Verhalten:
--  - Intern mindestens `now() - 14 Tage` (auch wenn der Client p_since = now()-14d sendet).
--  - `usage` = round( raw_usage * 14.0 / observed_days ),
--    observed_days = greatest(1, least(14, Tage seit erstem History-Eintrag)).
--  - `days_covered` = 0..14 (Early-Stage-Glättung im Client).
--
-- Ausführung: komplett im Supabase SQL-Editor (idempotent).
-- =====================================================================

drop function if exists public.usage_by_location_product_since_with_coverage(timestamptz);

create or replace function public.usage_by_location_product_since_with_coverage(
  p_since timestamptz
) returns table (
  location_id uuid,
  product_id uuid,
  usage integer,
  days_covered numeric
)
language sql
stable
as $$
  with bounds as (
    select least(p_since, now() - interval '14 days') as effective_since
  ),
  raw as (
    select
      u.location_id,
      u.product_id,
      u.usage as raw_usage
    from public.usage_by_location_product_since((select effective_since from bounds)) u
  ),
  first_seen as (
    select
      ih.location_id,
      ih.product_id,
      min(ih.timestamp) as first_ts
    from public.inventory_history ih
    group by ih.location_id, ih.product_id
  )
  select
    r.location_id,
    r.product_id,
    round(
      r.raw_usage::numeric * 14.0 /
      greatest(
        1.0::numeric,
        least(
          14.0::numeric,
          extract(epoch from (now() - coalesce(fs.first_ts, now()))) / 86400.0
        )
      )
    )::integer as usage,
    least(
      14::numeric,
      greatest(
        0::numeric,
        extract(epoch from (now() - coalesce(fs.first_ts, now()))) / 86400.0
      )
    ) as days_covered
  from raw r
  left join first_seen fs
    on fs.location_id = r.location_id
   and fs.product_id = r.product_id;
$$;

grant execute on function public.usage_by_location_product_since_with_coverage(timestamptz) to anon;
grant execute on function public.usage_by_location_product_since_with_coverage(timestamptz) to authenticated;
