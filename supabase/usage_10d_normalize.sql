-- =====================================================================
-- Verbrauchsberechnung: Rückblick bis zu 10 Tage, normalisiert auf 7 Tage.
--
-- Zweck:
--  - Die Bestellvorschlags-Logik verlangt einen robusten 7-Tage-Verbrauch.
--  - Wenn die letzte Inventur an einer Verkaufsstelle aelter als 7 Tage ist
--    (z. B. 8–10 Tage), soll der Verbrauch trotzdem erfasst und auf eine
--    7-Tage-Baseline skaliert werden.
--  - Diese Migration passt NUR `usage_by_location_product_since_with_coverage`
--    an (= die Quelle der Bestellvorschlaege ueber
--    `getWeeklyUsageWithCoverageByLocationProduct`).
--  - Die Basisfunktion `usage_by_location_product_since` bleibt unveraendert
--    (wird in der Uebersicht verwendet und soll dort unveraendert 7 Tage
--    zeigen).
--
-- Verhalten (neu):
--  - Intern wird IMMER mindestens bis `now() - 10 Tage` zurueckgeschaut
--    (auch wenn der Client p_since = now()-7d mitgibt).
--  - `raw_usage` ist die Summe der negativen Diffs ueber dieses Fenster
--    (Transfers/Waste/Loss werden weiterhin ausgeschlossen — dafuer sorgt
--    die Basisfunktion).
--  - `observed_days` = min(10, Tage seit erstem History-Eintrag). Der Wert
--    ist mindestens 1, um Division durch Null zu vermeiden.
--  - `usage` = round( raw_usage * 7.0 / observed_days ) → 7-Tage-Aequivalent.
--  - `days_covered` bleibt (wie bisher) auf 0..7 gekappt; damit funktioniert
--    die Early-Stage-Glaettung im Client unveraendert.
--
-- Ausfuehrung:
--  - Diese Datei im Supabase SQL-Editor komplett ausfuehren.
--  - Idempotent (CREATE OR REPLACE / drop + create).
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
    -- Immer mindestens 10 Tage zurueckschauen; bei aelterem p_since nicht einschraenken.
    select least(p_since, now() - interval '10 days') as effective_since
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
    -- Normalisierung auf 7-Tage-Aequivalent:
    --   raw_usage (ueber bis zu 10 Tage) * 7 / observed_days
    --   observed_days ist gedeckelt: 1..10 (damit keine Div/0 und keine Explosion).
    round(
      r.raw_usage::numeric * 7.0 /
      greatest(
        1.0::numeric,
        least(
          10.0::numeric,
          extract(epoch from (now() - coalesce(fs.first_ts, now()))) / 86400.0
        )
      )
    )::integer as usage,
    -- days_covered bleibt 0..7 (Early-Stage-Glaettung im Client erwartet das).
    least(
      7::numeric,
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
