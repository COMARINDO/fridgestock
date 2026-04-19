-- AI consumption: enqueue a job after every successful inventory count.
--
-- Idempotent migration:
--   * Creates ai_consumption and ai_consumption_jobs tables if they don't exist.
--   * Replaces the trigger function and trigger on public.inventory_history.
--
-- A job is created only when:
--   * NEW.mode = 'count' (i.e. a real inventory count, not 'add'/'transfer'/...).
--   * NEW.is_transfer is false (skip internal moves).
--   * A previous non-transfer 'count' snapshot exists for (location_id, product_id).
--   * The new quantity is strictly lower than the previous one (real consumption).
--
-- The worker (POST /api/ai/consumption/process) picks up status='pending' rows.

create extension if not exists pgcrypto;

create table if not exists public.ai_consumption_jobs (
  id uuid primary key default gen_random_uuid(),
  inventory_history_id uuid references public.inventory_history(id) on delete set null,
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  previous_quantity numeric not null,
  current_quantity numeric not null,
  days_between numeric not null,
  raw_input jsonb,
  raw_output jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','done','skipped','failed')),
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ai_consumption_jobs_status_created_idx
  on public.ai_consumption_jobs (status, created_at);

create index if not exists ai_consumption_jobs_loc_prod_idx
  on public.ai_consumption_jobs (location_id, product_id, created_at desc);

create table if not exists public.ai_consumption (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  daily_consumption numeric not null,
  suggested_order_7_days integer not null default 0,
  is_anomaly boolean not null default false,
  raw_input jsonb,
  raw_output jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_consumption_loc_prod_created_idx
  on public.ai_consumption (location_id, product_id, created_at desc);

-- Trigger function: enqueue a job after a count if consumption happened.
create or replace function public.ai_enqueue_consumption_job()
returns trigger
language plpgsql
as $$
declare
  v_prev_qty numeric;
  v_prev_ts  timestamptz;
  v_days     numeric;
begin
  if NEW.mode is distinct from 'count' then
    return NEW;
  end if;
  if coalesce(NEW.is_transfer, false) then
    return NEW;
  end if;

  select ih.quantity, ih.timestamp
    into v_prev_qty, v_prev_ts
  from public.inventory_history ih
  where ih.location_id = NEW.location_id
    and ih.product_id  = NEW.product_id
    and ih.id <> NEW.id
    and ih.mode = 'count'
    and coalesce(ih.is_transfer, false) = false
    and ih.timestamp <= NEW.timestamp
  order by ih.timestamp desc, ih.id desc
  limit 1;

  if v_prev_ts is null then
    return NEW;
  end if;

  if NEW.quantity >= v_prev_qty then
    return NEW;
  end if;

  v_days := greatest(
    extract(epoch from (NEW.timestamp - v_prev_ts)) / 86400.0,
    0
  );

  insert into public.ai_consumption_jobs (
    inventory_history_id,
    location_id,
    product_id,
    previous_quantity,
    current_quantity,
    days_between,
    raw_input,
    status
  ) values (
    NEW.id,
    NEW.location_id,
    NEW.product_id,
    v_prev_qty,
    NEW.quantity,
    v_days,
    jsonb_build_object(
      'previous_quantity', v_prev_qty,
      'current_quantity',  NEW.quantity,
      'days_between',      v_days,
      'previous_timestamp', v_prev_ts,
      'current_timestamp',  NEW.timestamp,
      'inventory_history_id', NEW.id
    ),
    'pending'
  );

  return NEW;
end;
$$;

drop trigger if exists trg_ai_enqueue_consumption_job on public.inventory_history;
create trigger trg_ai_enqueue_consumption_job
  after insert on public.inventory_history
  for each row
  execute function public.ai_enqueue_consumption_job();

-- Make sure anon/authenticated can read (RLS may further restrict).
grant select on public.ai_consumption to anon, authenticated;
grant select on public.ai_consumption_jobs to anon, authenticated;
