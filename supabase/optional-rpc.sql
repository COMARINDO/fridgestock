-- Optional: atomic snapshot function (recommended)
-- Creates/updates inventory row and appends inventory_history in a single transaction.
-- Works with UUID tables as described.

create or replace function public.set_inventory_snapshot(
  p_user_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_quantity integer
) returns void
language plpgsql
security definer
as $$
begin
  insert into public.inventory (location_id, product_id, quantity)
  values (p_location_id, p_product_id, p_quantity)
  on conflict (location_id, product_id)
  do update set quantity = excluded.quantity;

  insert into public.inventory_history (user_id, location_id, product_id, quantity, timestamp)
  values (p_user_id, p_location_id, p_product_id, p_quantity, now());
end;
$$;

