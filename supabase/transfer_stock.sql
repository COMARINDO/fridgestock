-- Atomarer Lagertransfer zwischen zwei Platzerl (ein Commit: inventory + 2× history + order_overrides cleanup)
-- Voraussetzung: Spalte inventory_history.is_transfer (siehe inventory_history_is_transfer.sql).
-- Nach Anlegen: ggf. grant execute für anon/authenticated (siehe unten)

drop function if exists public.transfer_stock(uuid, uuid, uuid, integer);
create or replace function public.transfer_stock(
  p_product_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity integer
)
returns table (new_from_quantity int, new_to_quantity int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from int;
  v_to int;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  if p_from_location_id = p_to_location_id then
    raise exception 'from and to must differ';
  end if;

  insert into public.inventory (location_id, product_id, quantity)
  values (p_from_location_id, p_product_id, 0)
  on conflict (location_id, product_id) do nothing;

  insert into public.inventory (location_id, product_id, quantity)
  values (p_to_location_id, p_product_id, 0)
  on conflict (location_id, product_id) do nothing;

  select i.quantity into v_from
  from public.inventory i
  where i.location_id = p_from_location_id and i.product_id = p_product_id
  for update;

  select i.quantity into v_to
  from public.inventory i
  where i.location_id = p_to_location_id and i.product_id = p_product_id
  for update;

  v_from := coalesce(v_from, 0);
  v_to := coalesce(v_to, 0);

  if v_from < p_quantity then
    raise exception 'Not enough stock in Rabenstein'
      using errcode = 'P0001';
  end if;

  v_from := v_from - p_quantity;
  v_to := v_to + p_quantity;

  update public.inventory
  set quantity = v_from
  where location_id = p_from_location_id and product_id = p_product_id;

  update public.inventory
  set quantity = v_to
  where location_id = p_to_location_id and product_id = p_product_id;

  insert into public.inventory_history (user_id, location_id, product_id, quantity, is_transfer, mode)
  values (null, p_from_location_id, p_product_id, v_from, true, 'transfer');

  insert into public.inventory_history (user_id, location_id, product_id, quantity, is_transfer, mode)
  values (null, p_to_location_id, p_product_id, v_to, true, 'transfer');

  delete from public.order_overrides
  where location_id in (p_from_location_id, p_to_location_id);

  return query select v_from, v_to;
end;
$$;

grant execute on function public.transfer_stock(uuid, uuid, uuid, integer) to anon;
grant execute on function public.transfer_stock(uuid, uuid, uuid, integer) to authenticated;
