-- Product list grouping (Kühl / Metro / Gebäck) for PWA tabs and imports.
-- Run in Supabase SQL editor after main schema.

alter table public.products
  add column if not exists list_category text not null default 'kuehl';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_list_category_check') then
    alter table public.products
      add constraint products_list_category_check
      check (list_category in ('kuehl', 'metro', 'gebaeck'));
  end if;
end $$;

comment on column public.products.list_category is 'PWA/Listen: kuehl | metro | gebaeck';
