-- Open RLS: jede Rolle anon/authenticated darf alle Zeilen lesen und schreiben.
-- Einmal im Supabase SQL Editor ausführen (oder als Migration).
-- Hinweis: service_role umgeht RLS weiterhin (Supabase-Standard).

-- Hilfs-Makro: eine Policy pro Tabelle
do $body$
declare
  t text;
  tables text[] := array[
    'users',
    'products',
    'locations',
    'location_users',
    'inventory',
    'inventory_history',
    'order_overrides'
  ];
begin
  foreach t in array tables
  loop
    execute format(
      'alter table public.%I enable row level security',
      t
    );
    execute format(
      'drop policy if exists open_read_write_anon on public.%I',
      t
    );
    execute format(
      $p$
      create policy open_read_write_anon
      on public.%I
      for all
      to anon, authenticated
      using (true)
      with check (true)
      $p$,
      t
    );
  end loop;
end;
$body$;
