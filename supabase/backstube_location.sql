-- Backstube als zusaetzliche Location.
--
-- Backstube ist KEIN Verkaufs-Platzerl: sie taucht NICHT in der Pickup-Auswahl
-- des Kunden-Chats auf. Backstube hat eine eigene Login-Sicht (/backstube),
-- die alle eingehenden Kundenbestellungen nach Abholtag sortiert anzeigt.
--
-- Ausfuehren: Supabase SQL Editor.
--
-- Hinweis: `locations.type` hat einen check-constraint, der nur die bereits
-- existierenden Werte (z.B. 'outlet', 'warehouse') zulaesst. Da Backstube
-- ueber den Namen erkannt wird, lassen wir den `type` einfach leer.

insert into public.locations (name)
values ('Backstube')
on conflict do nothing;
