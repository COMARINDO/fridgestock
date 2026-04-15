-- One-time migration: introduce "Rabenstein Lager" as separate location (warehouse)
-- Assumptions:
-- - Existing location "Rabenstein" becomes the outlet/filiale.
-- - Inventory is stored on parent locations (parent_id is null).
--
-- REVIEW before running in production.

begin;

-- 1) Create new warehouse location (if missing)
insert into public.locations (name, parent_id)
select 'Rabenstein Lager', null
where not exists (
  select 1 from public.locations where lower(name) = lower('Rabenstein Lager')
);

-- 2) Capture IDs
with ids as (
  select
    (select id from public.locations where lower(name) = lower('Rabenstein')) as filiale_id,
    (select id from public.locations where lower(name) = lower('Rabenstein Lager')) as lager_id
)
select * from ids;

-- 3) Move inventory from filiale -> lager (Option B from plan: move 1:1)
-- If you prefer COPY instead (Option A), change `update` to `insert ... on conflict do update`
-- and then optionally zero the filiale quantities.
with ids as (
  select
    (select id from public.locations where lower(name) = lower('Rabenstein')) as filiale_id,
    (select id from public.locations where lower(name) = lower('Rabenstein Lager')) as lager_id
),
moved as (
  update public.inventory i
  set location_id = (select lager_id from ids)
  where i.location_id = (select filiale_id from ids)
  returning *
)
select count(*) as moved_inventory_rows from moved;

-- 4) OPTIONAL: Move history rows too (keeps consistency of past snapshots)
-- Note: This changes historical attribution. If you need "filiale history" preserved,
-- skip this step.
with ids as (
  select
    (select id from public.locations where lower(name) = lower('Rabenstein')) as filiale_id,
    (select id from public.locations where lower(name) = lower('Rabenstein Lager')) as lager_id
),
moved as (
  update public.inventory_history h
  set location_id = (select lager_id from ids)
  where h.location_id = (select filiale_id from ids)
  returning *
)
select count(*) as moved_history_rows from moved;

commit;

