-- Anonymous routing state for moving reviewed trip messages between Telegram
-- forum topics. Guest contact details and message text deliberately do not
-- belong in this table.

create table public.telegram_trip_routes (
  source_chat_id bigint not null,
  source_message_id bigint not null,
  source_topic_id bigint not null,
  target_topic_id bigint not null,
  target_message_id bigint,
  state text not null default 'processing',
  claim_token uuid,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_trip_routes_pkey
    primary key (source_chat_id, source_message_id),
  constraint telegram_trip_routes_chat_check check (source_chat_id <> 0),
  constraint telegram_trip_routes_source_message_check check (source_message_id > 0),
  constraint telegram_trip_routes_source_topic_check check (source_topic_id > 0),
  constraint telegram_trip_routes_target_topic_check check (target_topic_id > 0),
  constraint telegram_trip_routes_target_message_check
    check (target_message_id is null or target_message_id > 0),
  constraint telegram_trip_routes_state_check
    check (state in ('processing', 'completed')),
  constraint telegram_trip_routes_state_fields_check check (
    (
      state = 'processing'
      and claim_token is not null
      and target_message_id is null
      and completed_at is null
    )
    or (
      state = 'completed'
      and claim_token is null
      and target_message_id is not null
      and completed_at is not null
    )
  )
);

create index telegram_trip_routes_stale_processing_idx
  on public.telegram_trip_routes (updated_at)
  where state = 'processing';

-- Claims a source Telegram message for one archive copy. A crashed claim can
-- be reclaimed after two minutes; completed routes remain permanent no-ops.
create or replace function public.claim_trip_message_routing(
  p_source_chat_id bigint,
  p_source_message_id bigint,
  p_source_topic_id bigint,
  p_target_topic_id bigint,
  p_claim_token uuid
)
returns table (
  claim_state text,
  route_claim_token uuid,
  routed_target_message_id bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed_token uuid;
  existing_state text;
  existing_target_message_id bigint;
begin
  if p_source_chat_id is null or p_source_chat_id = 0
     or p_source_message_id is null or p_source_message_id < 1
     or p_source_topic_id is null or p_source_topic_id < 1
     or p_target_topic_id is null or p_target_topic_id < 1
     or p_claim_token is null then
    raise exception using errcode = '22023', message = 'invalid_trip_routing_claim';
  end if;

  insert into public.telegram_trip_routes as existing_route (
    source_chat_id,
    source_message_id,
    source_topic_id,
    target_topic_id,
    state,
    claim_token,
    claimed_at,
    created_at,
    updated_at
  ) values (
    p_source_chat_id,
    p_source_message_id,
    p_source_topic_id,
    p_target_topic_id,
    'processing',
    p_claim_token,
    now(),
    now(),
    now()
  )
  on conflict (source_chat_id, source_message_id) do update
     set claim_token = p_claim_token,
         claimed_at = now(),
         updated_at = now()
   where existing_route.state = 'processing'
     and existing_route.source_topic_id = p_source_topic_id
     and existing_route.target_topic_id = p_target_topic_id
     and existing_route.updated_at < now() - interval '2 minutes'
  returning existing_route.claim_token
       into claimed_token;

  if claimed_token = p_claim_token then
    return query select 'claimed'::text, claimed_token, null::bigint;
    return;
  end if;

  select route.state, route.target_message_id
    into existing_state, existing_target_message_id
    from public.telegram_trip_routes route
   where route.source_chat_id = p_source_chat_id
     and route.source_message_id = p_source_message_id;

  return query select
    coalesce(existing_state, 'processing'),
    null::uuid,
    existing_target_message_id;
end;
$$;

create or replace function public.complete_trip_message_routing(
  p_source_chat_id bigint,
  p_source_message_id bigint,
  p_claim_token uuid,
  p_target_message_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  completed_source_message_id bigint;
begin
  if p_target_message_id is null or p_target_message_id < 1 then
    raise exception using errcode = '22023', message = 'invalid_trip_routing_target';
  end if;

  update public.telegram_trip_routes
     set state = 'completed',
         claim_token = null,
         target_message_id = p_target_message_id,
         completed_at = now(),
         updated_at = now()
   where source_chat_id = p_source_chat_id
     and source_message_id = p_source_message_id
     and state = 'processing'
     and claim_token = p_claim_token
  returning source_message_id into completed_source_message_id;

  return completed_source_message_id is not null;
end;
$$;

-- Releases an unfinished downstream delivery so a later button press can
-- retry immediately instead of waiting for the stale-claim lease.
create or replace function public.release_trip_message_routing(
  p_source_chat_id bigint,
  p_source_message_id bigint,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  released_source_message_id bigint;
begin
  delete from public.telegram_trip_routes
   where source_chat_id = p_source_chat_id
     and source_message_id = p_source_message_id
     and state = 'processing'
     and claim_token = p_claim_token
  returning source_message_id into released_source_message_id;

  return released_source_message_id is not null;
end;
$$;

comment on table public.telegram_trip_routes is
  'Technical Telegram topic/message routing only. Guest phone, name, comments and message text must never be stored here.';
comment on function public.claim_trip_message_routing(bigint, bigint, bigint, bigint, uuid) is
  'Claims one source trip message for archival, returning claimed, processing, or completed.';
comment on function public.complete_trip_message_routing(bigint, bigint, uuid, bigint) is
  'Records the destination message after one successful archive copy.';
comment on function public.release_trip_message_routing(bigint, bigint, uuid) is
  'Removes an unfinished trip route claim so a later callback can retry.';

alter table public.telegram_trip_routes enable row level security;

revoke all on public.telegram_trip_routes from public;
revoke execute on function public.claim_trip_message_routing(bigint, bigint, bigint, bigint, uuid) from public;
revoke execute on function public.complete_trip_message_routing(bigint, bigint, uuid, bigint) from public;
revoke execute on function public.release_trip_message_routing(bigint, bigint, uuid) from public;

do $trip_route_privileges$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'booking_app']::text[] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
      execute format('revoke all on public.telegram_trip_routes from %I', role_name);
      execute format(
        'revoke execute on function public.claim_trip_message_routing(bigint, bigint, bigint, bigint, uuid) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.complete_trip_message_routing(bigint, bigint, uuid, bigint) from %I',
        role_name
      );
      execute format(
        'revoke execute on function public.release_trip_message_routing(bigint, bigint, uuid) from %I',
        role_name
      );
    end if;
  end loop;

  if exists (select 1 from pg_catalog.pg_roles where rolname = 'booking_app') then
    grant execute on function public.claim_trip_message_routing(bigint, bigint, bigint, bigint, uuid) to booking_app;
    grant execute on function public.complete_trip_message_routing(bigint, bigint, uuid, bigint) to booking_app;
    grant execute on function public.release_trip_message_routing(bigint, bigint, uuid) to booking_app;
  end if;
end;
$trip_route_privileges$;
