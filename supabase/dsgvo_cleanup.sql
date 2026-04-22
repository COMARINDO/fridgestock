-- =====================================================================
-- DSGVO-Cleanup: automatische Loeschung personenbezogener Daten.
--
-- Legt zwei Helfer-Funktionen an, die regelmaessig (via Vercel-Cron in
-- app/api/dsgvo/cleanup/route.ts) aufgerufen werden koennen:
--
--   1) public.dsgvo_cleanup_customer_orders(retain_days_done, retain_days_open)
--      Loescht abgeschlossene Kundenbestellungen nach `retain_days_done`
--      Tagen und offen liegengebliebene nach `retain_days_open` Tagen.
--
--   2) public.dsgvo_cleanup_admin_audit_log(retain_days)
--      Loescht alte Audit-Eintraege nach `retain_days` Tagen.
--
-- Beide Funktionen geben die Anzahl geloeschter Zeilen zurueck, damit der
-- Cron-Endpoint das Ergebnis ins Audit-Log schreiben kann.
--
-- Idempotent: laesst sich beliebig oft ausfuehren.
-- Rechtsgrundlage: Art. 5 Abs. 1 lit. c + e DSGVO (Datenminimierung,
-- Speicherbegrenzung).
-- =====================================================================

create or replace function public.dsgvo_cleanup_customer_orders(
  retain_days_done integer default 90,
  retain_days_open integer default 180
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_done int := 0;
  v_open int := 0;
begin
  -- 1) Abgeschlossene / stornierte Bestellungen nach retain_days_done Tagen.
  delete from public.customer_orders
   where status in ('confirmed', 'forwarded', 'cancelled')
     and updated_at < now() - make_interval(days => retain_days_done);
  get diagnostics v_done = row_count;

  -- 2) Liegengebliebene offene Bestellungen nach retain_days_open Tagen
  --    (damit nichts ewig rumliegt).
  delete from public.customer_orders
   where status = 'open'
     and created_at < now() - make_interval(days => retain_days_open);
  get diagnostics v_open = row_count;

  return v_done + v_open;
end;
$$;

comment on function public.dsgvo_cleanup_customer_orders(integer, integer) is
  'Loescht Kundenbestellungen nach Ablauf der Aufbewahrungsfrist (DSGVO Art. 5).';


create or replace function public.dsgvo_cleanup_admin_audit_log(
  retain_days integer default 180
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int := 0;
begin
  delete from public.admin_audit_log
   where created_at < now() - make_interval(days => retain_days);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.dsgvo_cleanup_admin_audit_log(integer) is
  'Loescht alte Admin-Audit-Eintraege. Standard: 180 Tage.';


-- Zugriffsrechte: nur service_role darf die Cleanup-Funktionen aufrufen.
-- (anon/authenticated hat per default sowieso keine Rechte auf die Tabellen,
-- aber wir sind hier explizit.)
revoke all on function public.dsgvo_cleanup_customer_orders(integer, integer) from public;
revoke all on function public.dsgvo_cleanup_admin_audit_log(integer) from public;
