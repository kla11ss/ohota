-- Anonymous booking inventory for the Telegram confirmation workflow.
-- Guest contact details deliberately do not belong in this schema.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

set search_path = public, extensions;

create table public.booking_units (
  id text primary key,
  stay_id text not null,
  label text not null,
  sort_order smallint not null,
  capacity smallint not null,
  nightly_rate integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint booking_units_stay_id_check
    check (stay_id in ('hotel-room', 'cottage', 'hunter-house')),
  constraint booking_units_capacity_check check (capacity > 0),
  constraint booking_units_nightly_rate_check
    check (nightly_rate is null or nightly_rate >= 0),
  constraint booking_units_stay_sort_order_key unique (stay_id, sort_order)
);

insert into public.booking_units (
  id,
  stay_id,
  label,
  sort_order,
  capacity,
  nightly_rate
)
values
  ('hotel-room-1', 'hotel-room', 'Двухместный номер № 1', 1, 2, 6500),
  ('hotel-room-2', 'hotel-room', 'Двухместный номер № 2', 2, 2, 6500),
  ('hotel-room-3', 'hotel-room', 'Двухместный номер № 3', 3, 2, 6500),
  ('hotel-room-4', 'hotel-room', 'Двухместный номер № 4', 4, 2, 6500),
  ('hotel-room-5', 'hotel-room', 'Двухместный номер № 5', 5, 2, 6500),
  ('hotel-room-6', 'hotel-room', 'Двухместный номер № 6', 6, 2, 6500),
  ('cottage', 'cottage', 'Коттедж', 1, 15, 45000),
  ('hunter-house-1', 'hunter-house', 'Дом охотника № 1', 1, 6, null),
  ('hunter-house-2', 'hunter-house', 'Дом охотника № 2', 2, 6, null)
on conflict (id) do nothing;

create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null,
  metadata_hash text not null,
  stay_id text not null,
  unit_count smallint not null,
  selected_unit_ids text[] not null default '{}'::text[],
  check_in date not null,
  check_out date not null,
  nights integer not null,
  adults smallint not null,
  children smallint not null,
  capacity smallint not null,
  nightly_rate integer,
  estimated_total bigint,
  status text not null default 'pending',
  telegram_chat_id bigint,
  telegram_message_id bigint,
  telegram_topic_id bigint,
  telegram_routing_claim_token uuid,
  telegram_routing_claimed_at timestamptz,
  notification_error text,
  notified_at timestamptz,
  status_changed_at timestamptz not null default now(),
  status_changed_by_telegram_user_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_requests_request_key_key unique (request_key),
  constraint booking_requests_metadata_hash_check
    check (length(metadata_hash) between 1 and 128),
  constraint booking_requests_stay_id_check
    check (stay_id in ('hotel-room', 'cottage', 'hunter-house')),
  constraint booking_requests_dates_check check (check_out > check_in),
  constraint booking_requests_nights_check
    check (nights = check_out - check_in and nights > 0),
  constraint booking_requests_guest_counts_check
    check (adults >= 1 and children >= 0),
  constraint booking_requests_capacity_check
    check (capacity > 0 and adults + children <= capacity),
  constraint booking_requests_price_check
    check (
      (nightly_rate is null and estimated_total is null)
      or (
        nightly_rate is not null
        and nightly_rate >= 0
        and estimated_total = nightly_rate::bigint * nights::bigint * unit_count::bigint
      )
    ),
  constraint booking_requests_selection_check
    check (
      (
        stay_id = 'hotel-room'
        and unit_count between 1 and 6
        and cardinality(selected_unit_ids) = 0
      )
      or (
        stay_id = 'cottage'
        and unit_count = 1
        and (
          cardinality(selected_unit_ids) = 0
          or selected_unit_ids = array['cottage']::text[]
        )
      )
      or (
        stay_id = 'hunter-house'
        and unit_count between 1 and 2
        and cardinality(selected_unit_ids) = unit_count
        and selected_unit_ids <@ array['hunter-house-1', 'hunter-house-2']::text[]
        and (
          unit_count = 1
          or selected_unit_ids @> array['hunter-house-1', 'hunter-house-2']::text[]
        )
      )
    ),
  constraint booking_requests_status_check
    check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'notification_failed')),
  constraint booking_requests_telegram_message_check
    check (
      (telegram_chat_id is null and telegram_message_id is null)
      or (telegram_chat_id is not null and telegram_message_id is not null)
    ),
  constraint booking_requests_telegram_routing_claim_check
    check (
      (telegram_routing_claim_token is null and telegram_routing_claimed_at is null)
      or (telegram_routing_claim_token is not null and telegram_routing_claimed_at is not null)
    ),
  constraint booking_requests_notification_error_check
    check (notification_error is null or length(notification_error) <= 1000)
);

create unique index booking_requests_telegram_message_key
  on public.booking_requests (telegram_chat_id, telegram_message_id)
  where telegram_chat_id is not null and telegram_message_id is not null;

create index booking_requests_status_created_at_idx
  on public.booking_requests (status, created_at desc);

create index booking_requests_stay_dates_idx
  on public.booking_requests (stay_id, check_in, check_out)
  where status in ('pending', 'confirmed');

create table public.booking_allocations (
  id bigint generated always as identity primary key,
  request_id uuid not null
    references public.booking_requests (id) on delete cascade,
  unit_id text not null
    references public.booking_units (id) on delete restrict,
  check_in date not null,
  check_out date not null,
  stay_period daterange generated always as (
    daterange(check_in, check_out, '[)')
  ) stored,
  created_at timestamptz not null default now(),
  constraint booking_allocations_dates_check check (check_out > check_in),
  constraint booking_allocations_request_unit_key unique (request_id, unit_id),
  constraint booking_allocations_no_overlap
    exclude using gist (unit_id with =, stay_period with &&)
);

create index booking_allocations_request_id_idx
  on public.booking_allocations (request_id);

create table public.telegram_updates (
  update_id bigint primary key,
  booking_request_id uuid
    references public.booking_requests (id) on delete set null,
  action text,
  actor_telegram_user_id bigint,
  result_code text,
  status text not null default 'processing',
  received_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint telegram_updates_update_id_check check (update_id >= 0),
  constraint telegram_updates_action_check
    check (action is null or action in ('confirm', 'reject', 'cancel')),
  constraint telegram_updates_status_check
    check (status in ('processing', 'completed')),
  constraint telegram_updates_result_code_check
    check (result_code is null or length(result_code) <= 100)
);

create index telegram_updates_booking_request_id_idx
  on public.telegram_updates (booking_request_id)
  where booking_request_id is not null;

create index telegram_updates_stale_processing_idx
  on public.telegram_updates (updated_at)
  where status = 'processing';

create table public.booking_rate_limits (
  client_hash text primary key,
  reservation_token uuid not null,
  reserved_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint booking_rate_limits_client_hash_check
    check (length(client_hash) between 32 and 128)
);

create index booking_rate_limits_reserved_at_idx
  on public.booking_rate_limits (reserved_at);

create or replace function public._touch_booking_request_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger booking_requests_touch_updated_at
before update on public.booking_requests
for each row execute function public._touch_booking_request_updated_at();

-- Claims a Telegram update exactly once. A processing claim can be recovered
-- after two minutes so a crashed webhook invocation does not suppress retries.
create or replace function public.claim_telegram_update(
  p_update_id bigint
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_update_id bigint;
  existing_status text;
begin
  if p_update_id is null or p_update_id < 0 then
    raise exception using errcode = '22023', message = 'invalid_telegram_update_id';
  end if;

  insert into public.telegram_updates as existing_update (
    update_id,
    status,
    received_at,
    claimed_at,
    updated_at
  )
  values (
    p_update_id,
    'processing',
    now(),
    now(),
    now()
  )
  on conflict (update_id) do update
     set status = 'processing',
         claimed_at = now(),
         processed_at = null,
         updated_at = now()
   where existing_update.status = 'processing'
     and existing_update.updated_at < now() - interval '2 minutes'
  returning update_id into claimed_update_id;

  if claimed_update_id is not null then
    return 'claimed';
  end if;

  select status
    into existing_status
    from public.telegram_updates
   where update_id = p_update_id;

  return coalesce(existing_status, 'processing');
end;
$$;

create or replace function public.complete_telegram_update(
  p_update_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  completed_update_id bigint;
begin
  update public.telegram_updates
     set status = 'completed',
         processed_at = now(),
         updated_at = now()
   where update_id = p_update_id
     and status = 'processing'
  returning update_id into completed_update_id;

  return completed_update_id is not null;
end;
$$;

-- Releases an unfinished claim after a downstream failure so Telegram can
-- retry immediately instead of waiting for the stale-claim lease.
create or replace function public.release_telegram_update(
  p_update_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  released_update_id bigint;
begin
  delete from public.telegram_updates
   where update_id = p_update_id
     and status = 'processing'
  returning update_id into released_update_id;

  return released_update_id is not null;
end;
$$;

-- Removes a bounded batch of expired pseudonymous limiter keys. The limiter
-- invokes this opportunistically, so no raw address or unbounded history is
-- retained even when no external cleanup job is configured.
create or replace function public.cleanup_booking_rate_limits(
  p_retention_seconds integer default 172800,
  p_batch_size integer default 500
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  removed_count integer;
begin
  if p_retention_seconds is null
     or p_retention_seconds not between 60 and 604800
     or p_batch_size is null
     or p_batch_size not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_cleanup_input';
  end if;

  with expired as (
    select client_hash
      from public.booking_rate_limits
     where reserved_at < now() - make_interval(secs => p_retention_seconds)
     order by reserved_at
     limit p_batch_size
     for update skip locked
  ), removed as (
    delete from public.booking_rate_limits rate_limit
     using expired
     where rate_limit.client_hash = expired.client_hash
    returning 1
  )
  select count(*)::integer into removed_count from removed;

  return removed_count;
end;
$$;

-- Atomically reserves one submission slot before Telegram is contacted. The
-- opaque token makes rollback compare-and-delete safe if a newer reservation
-- replaces an expired one while the earlier request is still unwinding.
create or replace function public.reserve_booking_rate_limit(
  p_client_hashes text[],
  p_window_seconds integer default 20
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  reservation_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_token uuid := gen_random_uuid();
  current_hash text;
  lock_hash text;
  sorted_hashes text[];
  latest_reserved_at timestamptz;
  remaining_seconds integer;
begin
  if p_client_hashes is null
     or cardinality(p_client_hashes) <> 3
     or exists (
       select 1
         from unnest(p_client_hashes) as candidate(client_hash)
        where candidate.client_hash is null
           or length(candidate.client_hash) not between 32 and 128
     )
     or (
       select count(distinct candidate.client_hash)
         from unnest(p_client_hashes) as candidate(client_hash)
     ) <> 3
     or p_window_seconds is null
     or p_window_seconds not between 1 and 3600 then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_input';
  end if;

  current_hash := p_client_hashes[1];

  perform public.cleanup_booking_rate_limits();

  -- Requests straddling a rotation boundary share adjacent-generation locks.
  -- Sorting avoids deadlocks when concurrent requests present overlapping
  -- current/previous keys in the opposite generation order.
  select array_agg(candidate.client_hash order by candidate.client_hash)
    into sorted_hashes
    from unnest(p_client_hashes) as candidate(client_hash);

  foreach lock_hash in array sorted_hashes loop
    perform pg_advisory_xact_lock(hashtextextended(lock_hash, 20260721));
  end loop;

  select max(rate_limit.reserved_at)
    into latest_reserved_at
    from public.booking_rate_limits rate_limit
   where rate_limit.client_hash = any(p_client_hashes)
     and rate_limit.reserved_at > now() - make_interval(secs => p_window_seconds);

  if latest_reserved_at is not null then
    remaining_seconds := greatest(
      1,
      ceil(extract(epoch from (
        latest_reserved_at + make_interval(secs => p_window_seconds) - now()
      )))::integer
    );

    return query select false, remaining_seconds, null::uuid;
    return;
  end if;

  insert into public.booking_rate_limits as existing_limit (
    client_hash,
    reservation_token,
    reserved_at,
    updated_at
  )
  values (current_hash, new_token, now(), now())
  on conflict (client_hash) do update
     set reservation_token = new_token,
         reserved_at = now(),
         updated_at = now();

  return query select true, 0, new_token;
end;
$$;

create or replace function public.release_booking_rate_limit(
  p_client_hash text,
  p_reservation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  released_hash text;
begin
  if p_client_hash is null
     or length(p_client_hash) not between 32 and 128
     or p_reservation_token is null then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_release_input';
  end if;

  delete from public.booking_rate_limits
   where client_hash = p_client_hash
     and reservation_token = p_reservation_token
  returning client_hash into released_hash;

  return released_hash is not null;
end;
$$;

create or replace function public._validate_booking_allocation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  request_row public.booking_requests%rowtype;
  unit_row public.booking_units%rowtype;
begin
  select *
    into request_row
    from public.booking_requests
   where id = new.request_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'booking_request_not_found';
  end if;

  select *
    into unit_row
    from public.booking_units
   where id = new.unit_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'booking_unit_not_found';
  end if;

  if request_row.status not in ('pending', 'confirmed') then
    raise exception using
      errcode = '23514',
      message = 'booking_request_cannot_have_allocations';
  end if;

  if new.check_in <> request_row.check_in or new.check_out <> request_row.check_out then
    raise exception using
      errcode = '23514',
      message = 'booking_allocation_dates_mismatch';
  end if;

  if unit_row.stay_id <> request_row.stay_id then
    raise exception using
      errcode = '23514',
      message = 'booking_allocation_stay_mismatch';
  end if;

  if request_row.stay_id = 'cottage' and new.unit_id <> 'cottage' then
    raise exception using
      errcode = '23514',
      message = 'booking_allocation_unit_mismatch';
  end if;

  if request_row.stay_id = 'hunter-house'
     and not (new.unit_id = any(request_row.selected_unit_ids)) then
    raise exception using
      errcode = '23514',
      message = 'booking_allocation_unit_not_requested';
  end if;

  return new;
end;
$$;

create trigger booking_allocations_validate_metadata
before insert or update on public.booking_allocations
for each row execute function public._validate_booking_allocation();

create or replace function public._assert_booking_allocation_state(
  p_request_id uuid
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  request_status text;
  requested_count smallint;
  allocation_count integer;
begin
  select status, unit_count
    into request_status, requested_count
    from public.booking_requests
   where id = p_request_id;

  if not found then
    return;
  end if;

  select count(*)
    into allocation_count
    from public.booking_allocations
   where request_id = p_request_id;

  if request_status = 'confirmed' and allocation_count <> requested_count then
    raise exception using
      errcode = '23514',
      message = 'confirmed_booking_allocation_count_mismatch';
  end if;

  if request_status <> 'confirmed' and allocation_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'unconfirmed_booking_has_allocations';
  end if;
end;
$$;

create or replace function public._check_booking_request_allocation_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform public._assert_booking_allocation_state(
    case when tg_op = 'DELETE' then old.request_id else new.request_id end
  );
  return null;
end;
$$;

create or replace function public._check_booking_request_status_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform public._assert_booking_allocation_state(new.id);
  return null;
end;
$$;

create constraint trigger booking_allocations_check_request_state
after insert or update or delete on public.booking_allocations
deferrable initially deferred
for each row execute function public._check_booking_request_allocation_state();

create constraint trigger booking_requests_check_allocation_state
after insert or update of status, unit_count on public.booking_requests
deferrable initially deferred
for each row execute function public._check_booking_request_status_state();

-- Returns one row per calendar night and physical unit. p_to is exclusive.
create or replace function public.booking_availability(
  p_from date,
  p_to date
)
returns table (
  night_date date,
  unit_id text,
  stay_id text,
  available boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception using errcode = '22023', message = 'invalid_availability_range';
  end if;

  if p_to - p_from > 400 then
    raise exception using errcode = '22023', message = 'availability_range_too_large';
  end if;

  return query
  select
    days.day_start::date,
    units.id,
    units.stay_id,
    not exists (
      select 1
        from public.booking_allocations allocations
       where allocations.unit_id = units.id
         and allocations.stay_period && daterange(
           days.day_start::date,
           days.day_start::date + 1,
           '[)'
         )
    )
  from generate_series(
    p_from::timestamp,
    (p_to - 1)::timestamp,
    interval '1 day'
  ) as days(day_start)
  cross join public.booking_units units
  where units.active
  order by days.day_start, units.stay_id, units.sort_order;
end;
$$;

-- Non-locking preflight check. Atomic confirmation remains authoritative.
create or replace function public.check_booking_availability(
  p_stay_id text,
  p_unit_count smallint,
  p_selected_unit_ids text[],
  p_check_in date,
  p_check_out date
)
returns table (
  available boolean,
  result_code text,
  available_unit_ids text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  normalized_unit_ids text[] := coalesce(p_selected_unit_ids, '{}'::text[]);
  target_unit_ids text[];
  free_unit_ids text[];
  busy_unit_ids text[];
  booking_period daterange;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception using errcode = '22023', message = 'invalid_booking_range';
  end if;

  if p_stay_id = 'hotel-room' then
    if p_unit_count not between 1 and 6 or cardinality(normalized_unit_ids) <> 0 then
      raise exception using errcode = '22023', message = 'invalid_hotel_selection';
    end if;
  elsif p_stay_id = 'cottage' then
    if p_unit_count <> 1
       or normalized_unit_ids not in ('{}'::text[], array['cottage']::text[]) then
      raise exception using errcode = '22023', message = 'invalid_cottage_selection';
    end if;
    target_unit_ids := array['cottage']::text[];
  elsif p_stay_id = 'hunter-house' then
    if p_unit_count not between 1 and 2
       or cardinality(normalized_unit_ids) <> p_unit_count
       or not (normalized_unit_ids <@ array['hunter-house-1', 'hunter-house-2']::text[])
       or (
         p_unit_count = 2
         and not (normalized_unit_ids @> array['hunter-house-1', 'hunter-house-2']::text[])
       ) then
      raise exception using errcode = '22023', message = 'invalid_hunter_house_selection';
    end if;
    target_unit_ids := normalized_unit_ids;
  else
    raise exception using errcode = '22023', message = 'unknown_stay_id';
  end if;

  booking_period := daterange(p_check_in, p_check_out, '[)');

  if p_stay_id = 'hotel-room' then
    select
      coalesce(array_agg(units.id order by units.sort_order)
        filter (where allocations.id is null), '{}'::text[]),
      coalesce(array_agg(units.id order by units.sort_order)
        filter (where allocations.id is not null), '{}'::text[])
      into free_unit_ids, busy_unit_ids
      from public.booking_units units
      left join lateral (
        select allocation.id
          from public.booking_allocations allocation
         where allocation.unit_id = units.id
           and allocation.stay_period && booking_period
         limit 1
      ) allocations on true
     where units.stay_id = 'hotel-room'
       and units.active;
  else
    select
      coalesce(array_agg(units.id order by units.sort_order)
        filter (where allocations.id is null), '{}'::text[]),
      coalesce(array_agg(units.id order by units.sort_order)
        filter (where allocations.id is not null), '{}'::text[])
      into free_unit_ids, busy_unit_ids
      from public.booking_units units
      left join lateral (
        select allocation.id
          from public.booking_allocations allocation
         where allocation.unit_id = units.id
           and allocation.stay_period && booking_period
         limit 1
      ) allocations on true
     where units.id = any(target_unit_ids)
       and units.active;
  end if;

  return query
  select
    cardinality(free_unit_ids) >= p_unit_count,
    case
      when cardinality(free_unit_ids) >= p_unit_count then 'available'::text
      else 'conflict'::text
    end,
    free_unit_ids;
end;
$$;

-- Atomically assigns the same physical units for the whole [check_in, check_out)
-- interval. Result codes: confirmed, already_confirmed, conflict,
-- invalid_status, not_found.
create or replace function public.confirm_booking_request(
  p_request_id uuid,
  p_actor_telegram_user_id bigint default null
)
returns table (
  ok boolean,
  result_code text,
  request_status text,
  allocated_unit_ids text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  request_row public.booking_requests%rowtype;
  assigned_unit_ids text[] := '{}'::text[];
  booking_period daterange;
begin
  select *
    into request_row
    from public.booking_requests
   where id = p_request_id
   for update;

  if not found then
    return query select false, 'not_found'::text, null::text, '{}'::text[];
    return;
  end if;

  if request_row.status = 'confirmed' then
    select coalesce(array_agg(allocation.unit_id order by units.sort_order), '{}'::text[])
      into assigned_unit_ids
      from public.booking_allocations allocation
      join public.booking_units units on units.id = allocation.unit_id
     where allocation.request_id = request_row.id;

    return query
    select true, 'already_confirmed'::text, request_row.status, assigned_unit_ids;
    return;
  end if;

  if request_row.status <> 'pending' then
    return query
    select false, 'invalid_status'::text, request_row.status, '{}'::text[];
    return;
  end if;

  -- Serializes allocation decisions per accommodation type. The exclusion
  -- constraint below remains the final protection against every write path.
  perform pg_advisory_xact_lock(
    hashtextextended('booking-confirm:' || request_row.stay_id, 0)
  );

  booking_period := daterange(request_row.check_in, request_row.check_out, '[)');

  if request_row.stay_id = 'hotel-room' then
    select coalesce(array_agg(candidate.id order by candidate.sort_order), '{}'::text[])
      into assigned_unit_ids
      from (
        select units.id, units.sort_order
          from public.booking_units units
         where units.stay_id = 'hotel-room'
           and units.active
           and not exists (
             select 1
               from public.booking_allocations allocation
              where allocation.unit_id = units.id
                and allocation.stay_period && booking_period
           )
         order by units.sort_order
         limit request_row.unit_count
         for update of units
      ) candidate;
  else
    select coalesce(array_agg(units.id order by units.sort_order), '{}'::text[])
      into assigned_unit_ids
      from public.booking_units units
     where units.active
       and units.id = any(
         case request_row.stay_id
           when 'cottage' then array['cottage']::text[]
           else request_row.selected_unit_ids
         end
       )
       and not exists (
         select 1
           from public.booking_allocations allocation
          where allocation.unit_id = units.id
            and allocation.stay_period && booking_period
       );
  end if;

  if cardinality(assigned_unit_ids) <> request_row.unit_count then
    return query
    select false, 'conflict'::text, request_row.status, assigned_unit_ids;
    return;
  end if;

  begin
    insert into public.booking_allocations (
      request_id,
      unit_id,
      check_in,
      check_out
    )
    select
      request_row.id,
      selected_unit_id,
      request_row.check_in,
      request_row.check_out
    from unnest(assigned_unit_ids) as selected_unit_id;

    update public.booking_requests
       set status = 'confirmed',
           status_changed_at = now(),
           status_changed_by_telegram_user_id = p_actor_telegram_user_id,
           notification_error = null
     where id = request_row.id;
  exception
    when exclusion_violation or unique_violation then
      return query
      select false, 'conflict'::text, request_row.status, '{}'::text[];
      return;
  end;

  return query
  select true, 'confirmed'::text, 'confirmed'::text, assigned_unit_ids;
end;
$$;

-- Performs the non-confirmation state changes used by the bot. Reject and
-- cancel always remove allocations before the status change. Result codes:
-- transitioned, already_<status>, invalid_transition, not_found.
create or replace function public.transition_booking_request(
  p_request_id uuid,
  p_target_status text,
  p_actor_telegram_user_id bigint default null
)
returns table (
  ok boolean,
  result_code text,
  request_status text,
  allocated_unit_ids text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  request_row public.booking_requests%rowtype;
  current_unit_ids text[] := '{}'::text[];
  transition_allowed boolean := false;
begin
  select *
    into request_row
    from public.booking_requests
   where id = p_request_id
   for update;

  if not found then
    return query select false, 'not_found'::text, null::text, '{}'::text[];
    return;
  end if;

  select coalesce(array_agg(allocation.unit_id order by units.sort_order), '{}'::text[])
    into current_unit_ids
    from public.booking_allocations allocation
    join public.booking_units units on units.id = allocation.unit_id
   where allocation.request_id = request_row.id;

  if request_row.status = p_target_status then
    return query
    select true, ('already_' || p_target_status)::text, request_row.status, current_unit_ids;
    return;
  end if;

  transition_allowed :=
    (request_row.status = 'pending' and p_target_status in ('rejected', 'notification_failed'))
    or (request_row.status = 'notification_failed' and p_target_status = 'pending')
    or (request_row.status = 'confirmed' and p_target_status = 'cancelled');

  if not transition_allowed then
    return query
    select false, 'invalid_transition'::text, request_row.status, current_unit_ids;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('booking-confirm:' || request_row.stay_id, 0)
  );

  if p_target_status in ('rejected', 'cancelled', 'notification_failed') then
    delete from public.booking_allocations
     where request_id = request_row.id;
    current_unit_ids := '{}'::text[];
  end if;

  update public.booking_requests
     set status = p_target_status,
         status_changed_at = now(),
         status_changed_by_telegram_user_id = p_actor_telegram_user_id,
         notification_error = case
           when p_target_status = 'pending' then null
           else notification_error
         end
   where id = request_row.id;

  return query
  select true, 'transitioned'::text, p_target_status, current_unit_ids;
end;
$$;

comment on table public.booking_requests is
  'Anonymous booking metadata. Guest phone, name and comment must never be stored here.';
comment on column public.booking_requests.telegram_routing_claim_token is
  'Short-lived CAS token ensuring that only one callback copies a source message to its destination topic.';
comment on table public.booking_allocations is
  'Confirmed physical-unit occupancy using half-open [check_in, check_out) ranges.';
comment on table public.telegram_updates is
  'Recoverable Telegram webhook claims and anonymous action outcomes used for idempotency.';
comment on table public.booking_rate_limits is
  'Short-lived submission reservations keyed only by a server-generated HMAC; no raw addresses.';
comment on function public.claim_telegram_update(bigint) is
  'Returns claimed, processing, or completed; stale processing leases are reclaimed after two minutes.';
comment on function public.complete_telegram_update(bigint) is
  'Marks a claimed Telegram update completed so Telegram retries become no-ops.';
comment on function public.release_telegram_update(bigint) is
  'Deletes an unfinished Telegram update claim so a failed webhook can retry immediately.';
comment on function public.cleanup_booking_rate_limits(integer, integer) is
  'Deletes at most one bounded batch of expired client-HMAC reservations.';
comment on function public.reserve_booking_rate_limit(text[], integer) is
  'Atomically checks current, previous, and next rotating client-HMAC keys, then reserves only the current window before Telegram delivery.';
comment on function public.release_booking_rate_limit(text, uuid) is
  'Releases only the matching failed-delivery reservation token.';
comment on function public.booking_availability(date, date) is
  'Returns unit-level night availability for the half-open calendar window [from, to).';
comment on function public.check_booking_availability(text, smallint, text[], date, date) is
  'Performs a non-locking range preflight; confirmation is authoritative.';
comment on function public.confirm_booking_request(uuid, bigint) is
  'Atomically confirms a pending request and allocates physical units for its entire stay.';
comment on function public.transition_booking_request(uuid, text, bigint) is
  'Rejects, cancels, marks delivery failure, or retries a request according to the status graph.';

alter table public.booking_units enable row level security;
alter table public.booking_requests enable row level security;
alter table public.booking_allocations enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.booking_rate_limits enable row level security;

revoke all on public.booking_units from public;
revoke all on public.booking_requests from public;
revoke all on public.booking_allocations from public;
revoke all on public.telegram_updates from public;
revoke all on public.booking_rate_limits from public;
revoke all on sequence public.booking_allocations_id_seq from public;

revoke execute on function public.booking_availability(date, date) from public;
revoke execute on function public.check_booking_availability(text, smallint, text[], date, date) from public;
revoke execute on function public.confirm_booking_request(uuid, bigint) from public;
revoke execute on function public.transition_booking_request(uuid, text, bigint) from public;
revoke execute on function public.claim_telegram_update(bigint) from public;
revoke execute on function public.complete_telegram_update(bigint) from public;
revoke execute on function public.release_telegram_update(bigint) from public;
revoke execute on function public.cleanup_booking_rate_limits(integer, integer) from public;
revoke execute on function public.reserve_booking_rate_limit(text[], integer) from public;
revoke execute on function public.release_booking_rate_limit(text, uuid) from public;
revoke execute on function public._assert_booking_allocation_state(uuid) from public;

do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']::text[] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.booking_units from %I', role_name);
      execute format('revoke all on public.booking_requests from %I', role_name);
      execute format('revoke all on public.booking_allocations from %I', role_name);
      execute format('revoke all on public.telegram_updates from %I', role_name);
      execute format('revoke all on public.booking_rate_limits from %I', role_name);
      execute format('revoke all on sequence public.booking_allocations_id_seq from %I', role_name);
      execute format(
        'revoke execute on function public.booking_availability(date, date) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.check_booking_availability(text, smallint, text[], date, date) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.confirm_booking_request(uuid, bigint) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.transition_booking_request(uuid, text, bigint) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.claim_telegram_update(bigint) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.complete_telegram_update(bigint) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.release_telegram_update(bigint) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.cleanup_booking_rate_limits(integer, integer) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.reserve_booking_rate_limit(text[], integer) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.release_booking_rate_limit(text, uuid) from %I',
        role_name
      );
    end if;
  end loop;
end;
$$;
