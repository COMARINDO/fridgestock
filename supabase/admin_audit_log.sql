-- Audit log for admin mutations (orders, deliveries, etc.).
-- Wer hat wann welche Server-Action ausgeloest, mit Payload, Ergebnis und ggf. Fehler.
-- Nur service_role darf lesen/schreiben (kein anon-Zugriff). Lesbar im Supabase-Dashboard.
--
-- Ausfuehren: Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action text not null,
  actor text,
  location_id text,
  payload jsonb,
  result jsonb,
  ok boolean not null default false,
  error text
);

comment on table public.admin_audit_log is
  'Audit-Log fuer Admin-Mutationen via API-Routes. Wird vom Server (service_role) geschrieben.';

create index if not exists idx_admin_audit_log_created_at
  on public.admin_audit_log (created_at desc);
create index if not exists idx_admin_audit_log_action
  on public.admin_audit_log (action);
create index if not exists idx_admin_audit_log_location
  on public.admin_audit_log (location_id);

alter table public.admin_audit_log enable row level security;

-- Anon-Rolle bekommt KEINE Policy → kein Lesen/Schreiben moeglich.
-- service_role bypassed RLS automatisch.

-- Optional: alte Eintraege automatisch nach 180 Tagen loeschen.
-- (Nur ausfuehren, wenn pg_cron aktiviert ist; sonst manuell.)
-- select cron.schedule(
--   'admin_audit_log_cleanup',
--   '0 4 * * *',
--   $$ delete from public.admin_audit_log where created_at < now() - interval '180 days' $$
-- );
