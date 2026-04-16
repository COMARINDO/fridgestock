-- Fridge Stock App schema
-- Designed for: simple anon-key access (no Supabase Auth), plain-text passwords.
-- If you enable RLS: für uneingeschränkten Anon-Zugriff siehe `rls-open-anon.sql`.

-- Users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  password text not null
);

-- Products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  product_name text not null,
  zusatz text,
  barcode text unique,
  short_name text,
  min_quantity integer not null default 0
);

-- Admin pricing (optional columns; run if table already exists without them)
alter table public.products add column if not exists supplier text;
alter table public.products add column if not exists purchase_price numeric;
alter table public.products add column if not exists selling_price numeric;

-- No duplicate products: brand + product_name + zusatz
create unique index if not exists products_brand_product_zusatz_unique
  on public.products(brand, product_name, coalesce(zusatz, ''));

-- Locations (tree)
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.locations(id) on delete set null,
  type text,
  warehouse_location_id uuid references public.locations(id) on delete set null
);

create index if not exists locations_parent_id_idx on public.locations(parent_id);
create index if not exists locations_warehouse_location_id_idx on public.locations(warehouse_location_id);

alter table public.locations add column if not exists type text;
alter table public.locations add column if not exists warehouse_location_id uuid references public.locations(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'locations_type_check'
  ) then
    alter table public.locations
      add constraint locations_type_check
      check (type is null or type in ('warehouse','outlet','independent'));
  end if;
end;
$$;


-- AI consumption analysis (trigger enqueues jobs; processing happens server-side)
create table if not exists public.ai_consumption (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  daily_consumption numeric,
  suggested_order_7_days integer,
  is_anomaly boolean,
  raw_input jsonb,
  raw_output jsonb,
  created_at timestamptz default now()
);

create index if not exists ai_consumption_loc_prod_created_idx
  on public.ai_consumption(location_id, product_id, created_at desc);

-- NOTE: inventory_history.id is uuid in this app. If you previously created ai_consumption_jobs
-- with bigint, drop it once (it's a queue table; safe to recreate).
drop table if exists public.ai_consumption_jobs;
create table public.ai_consumption_jobs (
  id uuid primary key default gen_random_uuid(),
  inventory_history_id uuid not null references public.inventory_history(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  previous_quantity integer not null,
  current_quantity integer not null,
  days_between numeric not null,
  status text not null default 'pending' check (status in ('pending','processing','done','failed','skipped')),
  error text,
  raw_input jsonb,
  raw_output jsonb,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create index if not exists ai_consumption_jobs_status_created_idx
  on public.ai_consumption_jobs(status, created_at);

create unique index if not exists ai_consumption_jobs_unique_history
  on public.ai_consumption_jobs(inventory_history_id);

create or replace function public.enqueue_ai_consumption_job_from_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_qty integer;
  v_prev_ts timestamptz;
  v_diff integer;
  v_days numeric;
begin
  -- Only on real inventory counts
  if coalesce(new.mode, '') <> 'count' then
    return new;
  end if;

  select ih.quantity, ih.timestamp
    into v_prev_qty, v_prev_ts
  from public.inventory_history ih
  where ih.location_id = new.location_id
    and ih.product_id = new.product_id
    and (ih.timestamp < new.timestamp or (ih.timestamp = new.timestamp and ih.id < new.id))
  order by ih.timestamp desc, ih.id desc
  limit 1;

  if v_prev_ts is null then
    return new;
  end if;

  v_diff := coalesce(v_prev_qty, 0) - coalesce(new.quantity, 0);
  if v_diff <= 0 then
    -- increases / equal: no consumption signal
    return new;
  end if;

  v_days := extract(epoch from (new.timestamp - v_prev_ts)) / 86400.0;
  if v_days is null or v_days <= 0 then
    return new;
  end if;

  insert into public.ai_consumption_jobs (
    inventory_history_id,
    location_id,
    product_id,
    previous_quantity,
    current_quantity,
    days_between,
    status,
    raw_input
  ) values (
    new.id,
    new.location_id,
    new.product_id,
    v_prev_qty,
    new.quantity,
    v_days,
    'pending',
    jsonb_build_object(
      'previous_quantity', v_prev_qty,
      'current_quantity', new.quantity,
      'days_between', v_days
    )
  )
  on conflict (inventory_history_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_ai_consumption_enqueue on public.inventory_history;
create trigger trg_ai_consumption_enqueue
after insert on public.inventory_history
for each row
execute function public.enqueue_ai_consumption_job_from_history();

-- Backfill for existing known locations (name-based once, logic becomes data-driven afterwards)
do $$
declare
  v_lager uuid;
begin
  select id into v_lager from public.locations where lower(name) = lower('Rabenstein Lager') limit 1;

  update public.locations
  set type = 'warehouse',
      warehouse_location_id = null
  where lower(name) = lower('Rabenstein Lager');

  update public.locations
  set type = 'outlet',
      warehouse_location_id = v_lager
  where lower(name) in (lower('Teich'), lower('Rabenstein'));

  update public.locations
  set type = 'independent',
      warehouse_location_id = null
  where lower(name) in (lower('Hofstetten'), lower('Kirchberg'));
end;
$$;

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

