-- Mark internal transfers so usage RPC does not count them as consumption.
-- Run after schema / transfer_stock exists.

alter table public.inventory_history
  add column if not exists is_transfer boolean not null default false;

create index if not exists inventory_history_is_transfer_idx
  on public.inventory_history (is_transfer)
  where is_transfer;

-- Recalculate usage: only non-transfer snapshots participate in lag() chain.
create or replace function public.usage_by_location_product_since(
  p_since timestamptz
) returns table (
  location_id uuid,
  product_id uuid,
  usage integer
)
language sql
stable
as $$
  with ordered as (
    select
      ih.location_id,
      ih.product_id,
      ih.timestamp,
      ih.quantity,
      lag(ih.quantity) over (
        partition by ih.location_id, ih.product_id
        order by ih.timestamp
      ) as prev_quantity
    from public.inventory_history ih
    where ih.timestamp >= p_since
      and not ih.is_transfer
  ),
  diffs as (
    select
      location_id,
      product_id,
      (quantity - prev_quantity) as diff
    from ordered
    where prev_quantity is not null
  )
  select
    location_id,
    product_id,
    coalesce(sum(case when diff < 0 then -diff else 0 end), 0)::integer as usage
  from diffs
  group by location_id, product_id;
$$;
