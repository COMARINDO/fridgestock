-- Backstube als zusaetzliche Location.
--
-- Backstube ist KEIN Verkaufs-Platzerl: sie taucht NICHT in der Pickup-Auswahl
-- des Kunden-Chats auf. Backstube hat eine eigene Login-Sicht (/backstube),
-- die alle eingehenden Kundenbestellungen nach Abholtag sortiert anzeigt.
--
-- Ausfuehren: Supabase SQL Editor.

insert into public.locations (name, type)
values ('Backstube', 'backstube')
on conflict do nothing;

-- Falls die Location schon mit anderem Type existiert, sicherstellen, dass
-- der Name exakt 'Backstube' ist und ein definierter type gesetzt ist.
update public.locations
   set type = coalesce(type, 'backstube')
 where name = 'Backstube';
