
-- Optional: mapping users to locations
create table if not exists public.location_users (
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  role text,
  primary key (user_id, location_id)
);

-- Inventory snapshot (always full quantity)
-- IMPORTANT: inventory is stored ONLY on parent locations (parent_id is null).
create table if not exists public.inventory (
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 0,
  primary key (location_id, product_id)
);

-- History of snapshots
create table if not exists public.inventory_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null,
  timestamp timestamptz not null default now(),
  is_transfer boolean not null default false,
  mode text
);

-- Submitted orders (per location, per calendar week)
create table if not exists public.submitted_orders (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  iso_year integer not null,
  iso_week integer not null,
  created_at timestamptz not null default now(),
  items jsonb not null default '[]'::jsonb,
  delivered_at timestamptz
);

-- Centralized ordering: locations report demand, warehouse places a single order.
create table if not exists public.order_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists order_requests_open_by_product_idx
  on public.order_requests (product_id, location_id)
  where processed_at is null;

-- Enforce at most one *open* request per (location, product).
create unique index if not exists order_requests_one_open_per_loc_prod_idx
  on public.order_requests (location_id, product_id)
  where processed_at is null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'order_requests_quantity_nonneg') then
    alter table public.order_requests drop constraint order_requests_quantity_nonneg;
  end if;
  alter table public.order_requests
    add constraint order_requests_quantity_nonneg
    check (quantity >= 0);
end;
$$;

-- Batch upsert of demand from one location.
drop function if exists public.report_order_requests(uuid, jsonb);
create or replace function public.report_order_requests(
  p_location_id uuid,
  p_items jsonb
) returns table (
  location_id uuid,
  reported_items integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_reported int := 0;
  rec record;
  v_pid uuid;
  v_qty int;
begin
  if p_location_id is null then
    raise exception 'location_id required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be array' using errcode = 'P0001';
  end if;

  for rec in
    select
      (x->>'product_id')::uuid as product_id,
      coalesce((x->>'quantity')::int, 0) as quantity
    from jsonb_array_elements(p_items) as x
  loop
    v_pid := rec.product_id;
    v_qty := greatest(0, rec.quantity);
    if v_pid is null then
      continue;
    end if;

    -- Update existing open request if present.
    update public.order_requests
    set quantity = v_qty,
        updated_at = v_now
    where location_id = p_location_id
      and product_id = v_pid
      and processed_at is null;

    if found then
      v_reported := v_reported + 1;
      continue;
    end if;

    -- Otherwise insert a new open request. Unique partial index prevents dupes.
    begin
      insert into public.order_requests (location_id, product_id, quantity, created_at, updated_at, processed_at)
      values (p_location_id, v_pid, v_qty, v_now, v_now, null);
      v_reported := v_reported + 1;
    exception when unique_violation then
      -- Race: another reporter inserted concurrently; retry update.
      update public.order_requests
      set quantity = v_qty,
          updated_at = v_now
      where location_id = p_location_id
        and product_id = v_pid
        and processed_at is null;
      if found then
        v_reported := v_reported + 1;
      end if;
    end;
  end loop;

  return query select p_location_id, v_reported::integer, v_now;
end;
$$;

grant execute on function public.report_order_requests(uuid, jsonb) to anon;
grant execute on function public.report_order_requests(uuid, jsonb) to authenticated;

-- Place order: mark all currently-open demand rows as processed.
drop function if exists public.process_open_order_requests(timestamptz);
create or replace function public.process_open_order_requests(
  p_processed_at timestamptz default now()
) returns table (
  processed_rows integer,
  processed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_processed_at, now());
  v_rows int := 0;
begin
  update public.order_requests
  set processed_at = v_now
  where processed_at is null;
  get diagnostics v_rows = row_count;
  return query select v_rows::integer, v_now;
end;
$$;

grant execute on function public.process_open_order_requests(timestamptz) to anon;
grant execute on function public.process_open_order_requests(timestamptz) to authenticated;

create index if not exists submitted_orders_loc_created_idx
  on public.submitted_orders (location_id, created_at desc);

create index if not exists submitted_orders_year_week_idx
  on public.submitted_orders (iso_year desc, iso_week desc, created_at desc);

-- Minimal validation: items must be JSON array.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'submitted_orders_items_is_array') then
    alter table public.submitted_orders drop constraint submitted_orders_items_is_array;
  end if;
  alter table public.submitted_orders
    add constraint submitted_orders_items_is_array
    check (jsonb_typeof(items) = 'array');
end;
$$;

-- Confirm delivery: apply items as positive deltas and mark order delivered.
drop function if exists public.confirm_submitted_order(uuid);
create or replace function public.confirm_submitted_order(
  p_order_id uuid
) returns table (
  order_id uuid,
  location_id uuid,
  applied_items integer,
  delivered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc uuid;
  v_items jsonb;
  v_now timestamptz := now();
  v_applied int := 0;
  v_qty int;
  v_pid uuid;
  rec record;
begin
  -- Lock order row to prevent double confirmation
  select so.location_id, so.items
    into v_loc, v_items
  from public.submitted_orders so
  where so.id = p_order_id
    and so.delivered_at is null
  for update;

  if v_loc is null then
    raise exception 'order not found or already delivered' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'invalid items' using errcode = 'P0001';
  end if;

  for rec in
    select
      (x->>'product_id')::uuid as product_id,
      coalesce((x->>'quantity')::int, 0) as quantity
    from jsonb_array_elements(v_items) as x
  loop
    v_pid := rec.product_id;
    v_qty := greatest(0, rec.quantity);
    if v_pid is null or v_qty <= 0 then
      continue;
    end if;
    -- Reuse existing booking logic (outlets transfer from warehouse via apply_inventory_delta).
    perform public.apply_inventory_delta(null::uuid, v_loc, v_pid, v_qty);
    v_applied := v_applied + 1;
  end loop;

  update public.submitted_orders
  set delivered_at = v_now
  where id = p_order_id;

  return query select p_order_id, v_loc, v_applied::integer, v_now;
end;
$$;

grant execute on function public.confirm_submitted_order(uuid) to anon;
grant execute on function public.confirm_submitted_order(uuid) to authenticated;

alter table public.inventory_history add column if not exists is_transfer boolean not null default false;
alter table public.inventory_history add column if not exists mode text;

-- Optional: basic validation for mode values (null allowed for legacy rows)
do $$
begin
  -- Ensure the check constraint allows all supported modes (drop/recreate if needed).
  if exists (select 1 from pg_constraint where conname = 'inventory_history_mode_check') then
    alter table public.inventory_history drop constraint inventory_history_mode_check;
  end if;
  alter table public.inventory_history
    add constraint inventory_history_mode_check
    check (mode is null or mode in ('count','add','transfer','waste','loss'));
end;
$$;

create index if not exists inventory_history_loc_prod_time_idx
  on public.inventory_history(location_id, product_id, timestamp desc);

-- Atomic delete of a single history row + sync inventory to latest remaining snapshot.
drop function if exists public.delete_inventory_history_entry(uuid);
create or replace function public.delete_inventory_history_entry(
  p_id uuid
) returns table (
  location_id uuid,
  product_id uuid,
  new_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_loc uuid;
  v_prod uuid;
  v_new int;
begin
  select ih.location_id, ih.product_id
    into v_loc, v_prod
  from public.inventory_history ih
  where ih.id = p_id;

  if v_loc is null or v_prod is null then
    -- Idempotent delete: if already deleted, don't error (prevents noisy 400s in clients).
    return query select null::uuid, null::uuid, 0::integer;
    return;
  end if;

  -- Prevent races with concurrent updates on same (location, product).
  perform 1
  from public.inventory i
  where i.location_id = v_loc and i.product_id = v_prod
  for update;

  delete from public.inventory_history
  where id = p_id;

  select ih.quantity
    into v_new
  from public.inventory_history ih
  where ih.location_id = v_loc and ih.product_id = v_prod
  order by ih.timestamp desc, ih.id desc
  limit 1;

  v_new := coalesce(v_new, 0);

  insert into public.inventory (location_id, product_id, quantity)
  values (v_loc, v_prod, v_new)
  on conflict (location_id, product_id)
  do update set quantity = excluded.quantity;

  return query select v_loc, v_prod, v_new::integer;
end;
$$;

grant execute on function public.delete_inventory_history_entry(uuid) to anon;
grant execute on function public.delete_inventory_history_entry(uuid) to authenticated;

-- Resync inventory from latest history snapshot for one (location, product).
-- Keeps invariant: inventory.quantity == latest inventory_history.quantity (or 0 if none).
drop function if exists public.resync_inventory_from_history(uuid, uuid);
create or replace function public.resync_inventory_from_history(
  p_location_id uuid,
  p_product_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  -- lock inventory row (or at least serialize updates for this pair)
  perform 1
  from public.inventory i
  where i.location_id = p_location_id and i.product_id = p_product_id
  for update;

  select ih.quantity
    into v_new
  from public.inventory_history ih
  where ih.location_id = p_location_id
    and ih.product_id = p_product_id
  order by ih.timestamp desc, ih.id desc
  limit 1;

  v_new := coalesce(v_new, 0);

  insert into public.inventory (location_id, product_id, quantity)
  values (p_location_id, p_product_id, v_new)
  on conflict (location_id, product_id)
  do update set quantity = excluded.quantity;

  return v_new;
end;
$$;

grant execute on function public.resync_inventory_from_history(uuid, uuid) to anon;
grant execute on function public.resync_inventory_from_history(uuid, uuid) to authenticated;

-- Lightweight consistency check (optionally auto-fix).
drop function if exists public.check_inventory_matches_latest_history(uuid, uuid, boolean);
create or replace function public.check_inventory_matches_latest_history(
  p_location_id uuid,
  p_product_id uuid,
  p_autofix boolean default true
) returns table (
  matched boolean,
  inventory_quantity integer,
  history_quantity integer,
  fixed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv int;
  v_hist int;
  v_fixed boolean := false;
begin
  select i.quantity
    into v_inv
  from public.inventory i
  where i.location_id = p_location_id
    and i.product_id = p_product_id;
  v_inv := coalesce(v_inv, 0);

  select ih.quantity
    into v_hist
  from public.inventory_history ih
  where ih.location_id = p_location_id
    and ih.product_id = p_product_id
  order by ih.timestamp desc, ih.id desc
  limit 1;
  v_hist := coalesce(v_hist, 0);

  if v_inv <> v_hist and coalesce(p_autofix, true) then
    perform public.resync_inventory_from_history(p_location_id, p_product_id);
    v_inv := v_hist;
    v_fixed := true;
  end if;

  return query select (v_inv = v_hist), v_inv::integer, v_hist::integer, v_fixed;
end;
$$;

grant execute on function public.check_inventory_matches_latest_history(uuid, uuid, boolean) to anon;
grant execute on function public.check_inventory_matches_latest_history(uuid, uuid, boolean) to authenticated;

-- Single RPC for "overwrite inventory + append history" (atomic)
drop function if exists public.set_inventory_quantity(uuid, uuid, uuid, integer);
create or replace function public.set_inventory_quantity(
  p_user_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_quantity integer
) returns integer
language plpgsql
security definer
as $$
begin
  insert into public.inventory (location_id, product_id, quantity)
  values (p_location_id, p_product_id, p_quantity)
  on conflict (location_id, product_id)
  do update set quantity = excluded.quantity;

  insert into public.inventory_history (user_id, location_id, product_id, quantity, mode)
  values (p_user_id, p_location_id, p_product_id, p_quantity, 'count');

  return p_quantity;
end;
$$;

-- RPC for "add delta + append history" (atomic)
create or replace function public.add_inventory_delta(
  p_user_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_delta integer
) returns integer
language plpgsql
security definer
as $$
declare
  v_cur int;
  v_next int;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'delta must be positive';
  end if;

  insert into public.inventory (location_id, product_id, quantity)
  values (p_location_id, p_product_id, 0)
  on conflict (location_id, product_id) do nothing;

  select i.quantity into v_cur
  from public.inventory i
  where i.location_id = p_location_id and i.product_id = p_product_id
  for update;

  v_cur := coalesce(v_cur, 0);
  v_next := v_cur + p_delta;

  update public.inventory
  set quantity = v_next
  where location_id = p_location_id and product_id = p_product_id;

  insert into public.inventory_history (user_id, location_id, product_id, quantity, mode, is_transfer)
  values (p_user_id, p_location_id, p_product_id, v_next, 'add', false);

  return v_next;
end;
$$;

-- Unified RPC for "apply delta" (outlet => transfer, else add)
-- Returns the new quantity of the target location.
drop function if exists public.apply_inventory_delta(uuid, uuid, uuid, integer);
create or replace function public.apply_inventory_delta(
  p_user_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_delta integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_wh uuid;
  v_to int;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'delta must be positive';
  end if;

  select l.type, l.warehouse_location_id
    into v_type, v_wh
  from public.locations l
  where l.id = p_location_id;

  if v_type = 'outlet' then
    if v_wh is null then
      raise exception 'warehouse_location_id is required for outlet'
        using errcode = 'P0001';
    end if;
    -- Reuse existing transfer logic (atomic). We only return the target quantity.
    select new_to_quantity into v_to
    from public.transfer_stock(p_product_id, v_wh, p_location_id, p_delta);
    return v_to;
  end if;

  -- Default: normal add
  return public.add_inventory_delta(p_user_id, p_location_id, p_product_id, p_delta);
end;
$$;

grant execute on function public.apply_inventory_delta(uuid, uuid, uuid, integer) to anon;
grant execute on function public.apply_inventory_delta(uuid, uuid, uuid, integer) to authenticated;

-- Inventory adjustments that must NOT count as consumption (loss / waste).
drop function if exists public.record_inventory_adjustment(uuid, uuid, uuid, integer, text);
create or replace function public.record_inventory_adjustment(
  p_user_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_delta integer,
  p_reason text -- 'waste' or 'loss'
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_next int;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'delta must be positive'
      using errcode = 'P0001';
  end if;

  if p_reason not in ('waste', 'loss') then
    raise exception 'invalid reason'
      using errcode = 'P0001';
  end if;

  insert into public.inventory (location_id, product_id, quantity)
  values (p_location_id, p_product_id, 0)
  on conflict do nothing;

  select quantity into v_cur
  from public.inventory
  where location_id = p_location_id
    and product_id = p_product_id
  for update;

  v_cur := coalesce(v_cur, 0);

  if v_cur < p_delta then
    raise exception 'not enough stock'
      using errcode = 'P0001';
  end if;

  v_next := v_cur - p_delta;

  update public.inventory
  set quantity = v_next
  where location_id = p_location_id
    and product_id = p_product_id;

  insert into public.inventory_history (
    user_id,
    location_id,
    product_id,
    quantity,
    mode,
    is_transfer
  ) values (
    p_user_id,
    p_location_id,
    p_product_id,
    v_next,
    p_reason,
    false
  );

  return v_next;
end;
$$;

grant execute on function public.record_inventory_adjustment(uuid, uuid, uuid, integer, text) to anon;
grant execute on function public.record_inventory_adjustment(uuid, uuid, uuid, integer, text) to authenticated;

-- Inventory sessions (count-mode) using time gaps.
-- A new session starts when the gap between consecutive count events exceeds p_gap.
drop function if exists public.inventory_count_sessions(uuid, interval);
create or replace function public.inventory_count_sessions(
  p_location_id uuid,
  p_gap interval default interval '5 hours'
) returns table (
  session_no integer,
  started_at timestamptz,
  ended_at timestamptz,
  count_rows integer,
  distinct_products integer
)
language sql
stable
as $$
  with counts as (
    select
      ih.location_id,
      ih.product_id,
      ih.timestamp,
      case
        when lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) is null then 1
        when ih.timestamp - lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) > p_gap then 1
        else 0
      end as is_new_session
    from public.inventory_history ih
    where ih.location_id = p_location_id
      and ih.mode = 'count'
  ),
  sess as (
    select
      *,
      sum(is_new_session) over (partition by location_id order by timestamp) as session_no
    from counts
  )
  select
    s.session_no::integer,
    min(s.timestamp) as started_at,
    max(s.timestamp) as ended_at,
    count(*)::integer as count_rows,
    count(distinct s.product_id)::integer as distinct_products
  from sess s
  group by s.session_no
  order by s.session_no desc;
$$;

grant execute on function public.inventory_count_sessions(uuid, interval) to anon;
grant execute on function public.inventory_count_sessions(uuid, interval) to authenticated;

-- Latest snapshot (per product) within a given session, joined with product info.
drop function if exists public.inventory_session_snapshot(uuid, integer, interval);
create or replace function public.inventory_session_snapshot(
  p_location_id uuid,
  p_session_no integer,
  p_gap interval default interval '5 hours'
) returns table (
  product_id uuid,
  brand text,
  product_name text,
  zusatz text,
  short_name text,
  quantity integer,
  counted_at timestamptz
)
language sql
stable
as $$
  with counts as (
    select
      ih.location_id,
      ih.product_id,
      ih.quantity,
      ih.timestamp,
      ih.id,
      case
        when lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) is null then 1
        when ih.timestamp - lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) > p_gap then 1
        else 0
      end as is_new_session
    from public.inventory_history ih
    where ih.location_id = p_location_id
      and ih.mode = 'count'
  ),
  sess as (
    select
      *,
      sum(is_new_session) over (partition by location_id order by timestamp) as session_no
    from counts
  ),
  latest as (
    select distinct on (s.product_id)
      s.product_id,
      s.quantity,
      s.timestamp as counted_at
    from sess s
    where s.session_no = p_session_no
    order by s.product_id, s.timestamp desc
  )
  select
    l.product_id,
    coalesce(p.brand, '') as brand,
    coalesce(p.product_name, '') as product_name,
    coalesce(p.zusatz, '') as zusatz,
    coalesce(p.short_name, '') as short_name,
    l.quantity::integer as quantity,
    l.counted_at
  from latest l
  join public.products p on p.id = l.product_id
  order by p.brand, p.product_name, p.zusatz;
$$;

grant execute on function public.inventory_session_snapshot(uuid, integer, interval) to anon;
grant execute on function public.inventory_session_snapshot(uuid, integer, interval) to authenticated;

-- Products that were counted in the previous session but not counted in the target session.
drop function if exists public.missing_counts_for_inventory_session(uuid, integer, interval);
create or replace function public.missing_counts_for_inventory_session(
  p_location_id uuid,
  p_session_no integer,
  p_gap interval default interval '5 hours'
) returns table (
  product_id uuid,
  brand text,
  product_name text,
  zusatz text,
  short_name text,
  last_quantity integer,
  last_count_at timestamptz
)
language sql
stable
as $$
  with counts as (
    select
      ih.location_id,
      ih.product_id,
      ih.quantity,
      ih.timestamp,
      ih.id,
      case
        when lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) is null then 1
        when ih.timestamp - lag(ih.timestamp) over (partition by ih.location_id order by ih.timestamp, ih.id) > p_gap then 1
        else 0
      end as is_new_session
    from public.inventory_history ih
    where ih.location_id = p_location_id
      and ih.mode = 'count'
  ),
  sess as (
    select
      *,
      sum(is_new_session) over (partition by location_id order by timestamp) as session_no
    from counts
  ),
  prev_session as (
    select (p_session_no - 1) as session_no
  ),
  prev_products as (
    select distinct s.product_id
    from sess s
    join prev_session ps on ps.session_no = s.session_no
  ),
  cur_products as (
    select distinct s.product_id
    from sess s
    where s.session_no = p_session_no
  ),
  missing as (
    select pp.product_id
    from prev_products pp
    where pp.product_id not in (select product_id from cur_products)
  ),
  prev_latest as (
    select distinct on (s.product_id)
      s.product_id,
      s.quantity as last_quantity,
      s.timestamp as last_count_at
    from sess s
    join prev_session ps on ps.session_no = s.session_no
    order by s.product_id, s.timestamp desc
  )
  select
    m.product_id,
    coalesce(p.brand, '') as brand,
    coalesce(p.product_name, '') as product_name,
    coalesce(p.zusatz, '') as zusatz,
    coalesce(p.short_name, '') as short_name,
    coalesce(pl.last_quantity, 0)::integer as last_quantity,
    pl.last_count_at
  from missing m
  left join prev_latest pl on pl.product_id = m.product_id
  join public.products p on p.id = m.product_id
  order by p.brand, p.product_name, p.zusatz;
$$;

grant execute on function public.missing_counts_for_inventory_session(uuid, integer, interval) to anon;
grant execute on function public.missing_counts_for_inventory_session(uuid, integer, interval) to authenticated;

-- Convenience: missing vs previous for the latest session.
drop function if exists public.missing_counts_for_latest_inventory_session(uuid, interval);
create or replace function public.missing_counts_for_latest_inventory_session(
  p_location_id uuid,
  p_gap interval default interval '5 hours'
) returns table (
  product_id uuid,
  brand text,
  product_name text,
  zusatz text,
  short_name text,
  last_quantity integer,
  last_count_at timestamptz
)
language sql
stable
as $$
  with sessions as (
    select *
    from public.inventory_count_sessions(p_location_id, p_gap)
  ),
  latest as (
    select max(session_no) as session_no
    from sessions
  )
  select *
  from public.missing_counts_for_inventory_session(
    p_location_id,
    (select session_no from latest),
    p_gap
  );
$$;

grant execute on function public.missing_counts_for_latest_inventory_session(uuid, interval) to anon;
grant execute on function public.missing_counts_for_latest_inventory_session(uuid, interval) to authenticated;

-- Usage helpers (consumption only, ignore refills)
-- Calculates usage as sum of negative diffs between consecutive snapshots.
drop function if exists public.usage_by_location_product_since(timestamptz);
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
  with base as (
    select
      ih.location_id,
      ih.product_id,
      ih.timestamp,
      ih.id,
      ih.quantity,
      ih.is_transfer,
      ih.mode
    from public.inventory_history ih
    where ih.timestamp >= p_since

    union all

    -- include last snapshot before p_since per (location, product) to anchor first diff
    select
      ih.location_id,
      ih.product_id,
      ih.timestamp,
      ih.id,
      ih.quantity,
      ih.is_transfer,
      ih.mode
    from public.inventory_history ih
    join (
      select
        location_id,
        product_id,
        max(timestamp) as ts
      from public.inventory_history
      where timestamp < p_since
      group by location_id, product_id
    ) prev
      on prev.location_id = ih.location_id
     and prev.product_id = ih.product_id
     and prev.ts = ih.timestamp
  ),
  ordered as (
    select
      location_id,
      product_id,
      timestamp,
      id,
      quantity,
      is_transfer,
      mode,
      lag(quantity) over (
        partition by location_id, product_id
        order by timestamp, id
      ) as prev_quantity
    from base
  ),
  diffs as (
    select
      location_id,
      product_id,
      is_transfer,
      mode,
      (quantity - prev_quantity) as diff
    from ordered
    where prev_quantity is not null
      and timestamp >= p_since
  )
  select
    d.location_id,
    d.product_id,
    coalesce(
      sum(
        case
          when d.diff < 0
            and not coalesce(d.is_transfer, false)
            and coalesce(d.mode, '') not in ('transfer','waste','loss')
            then -d.diff
          else 0
        end
      ),
      0
    )::integer as usage
  from diffs d
  join public.locations l on l.id = d.location_id
  where coalesce(l.type, '') <> 'warehouse'
  group by d.location_id, d.product_id;
$$;

-- Usage + coverage (early-stage support)
-- Adds `days_covered` based on the earliest history row per (location, product), capped to 7.
drop function if exists public.usage_by_location_product_since_with_coverage(timestamptz);
create or replace function public.usage_by_location_product_since_with_coverage(
  p_since timestamptz
) returns table (
  location_id uuid,
  product_id uuid,
  usage integer,
  days_covered numeric
)
language sql
stable
as $$
  with usage as (
    select
      u.location_id,
      u.product_id,
      u.usage
    from public.usage_by_location_product_since(p_since) u
  ),
  first_seen as (
    select
      ih.location_id,
      ih.product_id,
      min(ih.timestamp) as first_ts
    from public.inventory_history ih
    group by ih.location_id, ih.product_id
  )
  select
    u.location_id,
    u.product_id,
    u.usage,
    least(
      7::numeric,
      greatest(
        0::numeric,
        extract(epoch from (now() - coalesce(fs.first_ts, now()))) / 86400.0
      )
    ) as days_covered
  from usage u
  left join first_seen fs
    on fs.location_id = u.location_id
   and fs.product_id = u.product_id;
$$;

grant execute on function public.usage_by_location_product_since_with_coverage(timestamptz) to anon;
grant execute on function public.usage_by_location_product_since_with_coverage(timestamptz) to authenticated;

