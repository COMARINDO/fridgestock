-- Order lifecycle: archive a per-location order from the admin UI, and edit
-- items of an open (not yet delivered) order before booking the delivery.
--
-- Idempotent migration. Adds two RPCs:
--   * archive_order_for_location: write a submitted_orders row for one
--     location with the items provided. Optionally close all open
--     order_requests (so they disappear from the demand tab once the
--     warehouse order has been placed at Metro).
--   * update_submitted_order_items: overwrite the items of an open
--     submitted order (used to correct quantities before booking the
--     actual delivery, e.g. partial Metro delivery).

drop function if exists public.archive_order_for_location(uuid, jsonb, boolean);
create or replace function public.archive_order_for_location(
  p_location_id uuid,
  p_items jsonb,
  p_close_open_requests boolean default false
) returns table (
  order_id uuid,
  location_id uuid,
  iso_year integer,
  iso_week integer,
  created_at timestamptz,
  item_count integer,
  closed_requests integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_order_id uuid;
  v_year int := extract(isoyear from v_now)::int;
  v_week int := extract(week    from v_now)::int;
  v_count int := 0;
  v_closed int := 0;
  v_norm jsonb := '[]'::jsonb;
  rec record;
begin
  if p_location_id is null then
    raise exception 'location_id required' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be jsonb array' using errcode = 'P0001';
  end if;

  -- Normalise items: keep only positive integer quantities, drop dupes
  -- by aggregating per product_id.
  with raw as (
    select
      (x->>'product_id')::uuid as product_id,
      greatest(0, coalesce((x->>'quantity')::int, 0)) as quantity
    from jsonb_array_elements(p_items) as x
  ),
  agg as (
    select product_id, sum(quantity)::int as quantity
    from raw
    where product_id is not null
    group by product_id
    having sum(quantity) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity)), '[]'::jsonb)
    into v_norm
  from agg;

  v_count := jsonb_array_length(v_norm);
  if v_count = 0 then
    raise exception 'no items to archive' using errcode = 'P0001';
  end if;

  insert into public.submitted_orders (location_id, iso_year, iso_week, items)
  values (p_location_id, v_year, v_week, v_norm)
  returning id into v_order_id;

  if p_close_open_requests then
    update public.order_requests
    set processed_at = v_now
    where processed_at is null;
    get diagnostics v_closed = row_count;
  end if;

  return query select v_order_id, p_location_id, v_year, v_week, v_now, v_count, v_closed;
end;
$$;

grant execute on function public.archive_order_for_location(uuid, jsonb, boolean) to authenticated;
revoke execute on function public.archive_order_for_location(uuid, jsonb, boolean) from public;
revoke execute on function public.archive_order_for_location(uuid, jsonb, boolean) from anon;


drop function if exists public.update_submitted_order_items(uuid, jsonb);
create or replace function public.update_submitted_order_items(
  p_order_id uuid,
  p_items jsonb
) returns table (
  order_id uuid,
  item_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_norm jsonb := '[]'::jsonb;
  v_count int := 0;
  v_exists uuid;
begin
  if p_order_id is null then
    raise exception 'order_id required' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be jsonb array' using errcode = 'P0001';
  end if;

  -- Lock target row, ensure not yet delivered.
  select id into v_exists
  from public.submitted_orders
  where id = p_order_id
    and delivered_at is null
  for update;

  if v_exists is null then
    raise exception 'order not found or already delivered' using errcode = 'P0001';
  end if;

  with raw as (
    select
      (x->>'product_id')::uuid as product_id,
      greatest(0, coalesce((x->>'quantity')::int, 0)) as quantity
    from jsonb_array_elements(p_items) as x
  ),
  agg as (
    select product_id, sum(quantity)::int as quantity
    from raw
    where product_id is not null
    group by product_id
    having sum(quantity) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity)), '[]'::jsonb)
    into v_norm
  from agg;

  v_count := jsonb_array_length(v_norm);

  update public.submitted_orders
  set items = v_norm
  where id = p_order_id;

  return query select p_order_id, v_count, v_now;
end;
$$;

grant execute on function public.update_submitted_order_items(uuid, jsonb) to authenticated;
revoke execute on function public.update_submitted_order_items(uuid, jsonb) from public;
revoke execute on function public.update_submitted_order_items(uuid, jsonb) from anon;
