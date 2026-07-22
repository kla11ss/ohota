-- Least-privilege runtime role for the accommodation booking backend.
--
-- Run this file as the database owner after all booking migrations. It creates
-- no credential and preserves an existing role credential. Configure the
-- credential out of band, then use booking_app in the pooled DATABASE_URL.

begin;

do $booking_app_prerequisites$
begin
  if to_regclass('public.booking_requests') is null
     or to_regclass('public.booking_allocations') is null
     or to_regclass('public.booking_units') is null
     or to_regclass('public.telegram_updates') is null
     or to_regclass('public.booking_rate_limits') is null
     or to_regclass('public.telegram_trip_routes') is null
     or to_regclass('public.accommodation_map_config') is null then
    raise exception using
      errcode = '42P01',
      message = 'booking migration must be applied before booking-app-role.sql';
  end if;

  if to_regprocedure('public.booking_availability(date,date)') is null
     or to_regprocedure('public.check_booking_availability(text,smallint,text[],date,date)') is null
     or to_regprocedure('public.confirm_booking_request(uuid,bigint)') is null
     or to_regprocedure('public.transition_booking_request(uuid,text,bigint)') is null
     or to_regprocedure('public.claim_telegram_update(bigint)') is null
     or to_regprocedure('public.complete_telegram_update(bigint)') is null
     or to_regprocedure('public.release_telegram_update(bigint)') is null
     or to_regprocedure('public.cleanup_booking_rate_limits(integer,integer)') is null
     or to_regprocedure('public.reserve_booking_rate_limit(text[],integer)') is null
     or to_regprocedure('public.release_booking_rate_limit(text,uuid)') is null
     or to_regprocedure('public.claim_trip_message_routing(bigint,bigint,bigint,bigint,uuid)') is null
     or to_regprocedure('public.complete_trip_message_routing(bigint,bigint,uuid,bigint)') is null
     or to_regprocedure('public.release_trip_message_routing(bigint,bigint,uuid)') is null
     or to_regprocedure('public.get_published_accommodation_map()') is null
     or to_regprocedure('public.get_accommodation_map_draft()') is null
     or to_regprocedure('public.save_accommodation_map_draft(jsonb)') is null
     or to_regprocedure('public.publish_accommodation_map()') is null
     or to_regprocedure('public._assert_booking_allocation_state(uuid)') is null then
    raise exception using
      errcode = '42883',
      message = 'booking runtime functions must exist before booking-app-role.sql';
  end if;
end;
$booking_app_prerequisites$;

do $booking_app_create_role$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'booking_app') then
    execute 'create role booking_app';
  end if;
end;
$booking_app_create_role$;

-- Re-applying the template hardens role attributes without changing its
-- out-of-band credential.
-- Neon blocks explicit SUPERUSER, REPLICATION, and BYPASSRLS changes for
-- project-owner roles, even when setting them to false. New roles default to
-- false for those attributes, and the assertions below fail closed otherwise.
alter role booking_app with
  login
  nocreatedb
  nocreaterole
  noinherit
  connection limit 20;

alter role booking_app set search_path = pg_catalog, public;
alter role booking_app set statement_timeout = '15s';
alter role booking_app set lock_timeout = '5s';
alter role booking_app set idle_in_transaction_session_timeout = '15s';

-- A dedicated runtime login must not inherit or SET ROLE into an older,
-- broader role if this file is applied over a pre-existing login.
do $booking_app_revoke_memberships$
declare
  granted_role text;
begin
  for granted_role in
    select parent_role.rolname
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles parent_role on parent_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where member_role.rolname = 'booking_app'
  loop
    execute format('revoke %I from booking_app', granted_role);
  end loop;
end;
$booking_app_revoke_memberships$;

-- Keep persistent DDL unavailable through privileges inherited from PUBLIC.
do $booking_app_database_privileges$
begin
  execute format(
    'revoke create on database %I from public',
    current_database()
  );
  execute format(
    'revoke all privileges on database %I from booking_app',
    current_database()
  );
  execute format(
    'grant connect on database %I to booking_app',
    current_database()
  );
end;
$booking_app_database_privileges$;

revoke create on schema public from public;
revoke all privileges on schema public from booking_app;
grant usage on schema public to booking_app;

-- Clear any grants left by an earlier experiment before applying the exact
-- runtime contract below. No sequence or booking-table ownership is needed.
revoke all privileges on all tables in schema public from booking_app;
revoke all privileges on all sequences in schema public from booking_app;
revoke all privileges on all functions in schema public from booking_app;

-- SELECT is column-scoped so a future sensitive column fails closed until the
-- runtime contract is deliberately reviewed and re-provisioned.
grant select (
  id,
  request_key,
  metadata_hash,
  stay_id,
  unit_count,
  selected_unit_ids,
  check_in,
  check_out,
  nights,
  adults,
  children,
  capacity,
  nightly_rate,
  estimated_total,
  status,
  telegram_chat_id,
  telegram_message_id,
  telegram_topic_id,
  telegram_routing_claim_token,
  telegram_routing_claimed_at,
  notification_error,
  notified_at,
  status_changed_at,
  status_changed_by_telegram_user_id,
  created_at,
  updated_at
) on public.booking_requests to booking_app;

grant insert (
  id,
  request_key,
  metadata_hash,
  stay_id,
  unit_count,
  selected_unit_ids,
  check_in,
  check_out,
  adults,
  children,
  capacity,
  nights,
  nightly_rate,
  estimated_total,
  status
) on public.booking_requests to booking_app;

grant update (
  status,
  telegram_chat_id,
  telegram_message_id,
  telegram_topic_id,
  telegram_routing_claim_token,
  telegram_routing_claimed_at,
  notification_error,
  notified_at,
  updated_at
) on public.booking_requests to booking_app;

grant select (
  request_id,
  unit_id
) on public.booking_allocations to booking_app;

-- The runtime never writes inventory directly. These SECURITY DEFINER
-- functions retain their migration owner and enforce allocation invariants.
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
revoke execute on function public.claim_trip_message_routing(bigint, bigint, bigint, bigint, uuid) from public;
revoke execute on function public.complete_trip_message_routing(bigint, bigint, uuid, bigint) from public;
revoke execute on function public.release_trip_message_routing(bigint, bigint, uuid) from public;
revoke execute on function public.get_published_accommodation_map() from public;
revoke execute on function public.get_accommodation_map_draft() from public;
revoke execute on function public.save_accommodation_map_draft(jsonb) from public;
revoke execute on function public.publish_accommodation_map() from public;
revoke execute on function public._assert_booking_allocation_state(uuid) from public;

grant execute on function public.booking_availability(date, date) to booking_app;
grant execute on function public.check_booking_availability(text, smallint, text[], date, date) to booking_app;
grant execute on function public.confirm_booking_request(uuid, bigint) to booking_app;
grant execute on function public.transition_booking_request(uuid, text, bigint) to booking_app;
grant execute on function public.claim_telegram_update(bigint) to booking_app;
grant execute on function public.complete_telegram_update(bigint) to booking_app;
grant execute on function public.release_telegram_update(bigint) to booking_app;
grant execute on function public.cleanup_booking_rate_limits(integer, integer) to booking_app;
grant execute on function public.reserve_booking_rate_limit(text[], integer) to booking_app;
grant execute on function public.release_booking_rate_limit(text, uuid) to booking_app;
grant execute on function public.claim_trip_message_routing(bigint, bigint, bigint, bigint, uuid) to booking_app;
grant execute on function public.complete_trip_message_routing(bigint, bigint, uuid, bigint) to booking_app;
grant execute on function public.release_trip_message_routing(bigint, bigint, uuid) to booking_app;
grant execute on function public.get_published_accommodation_map() to booking_app;
grant execute on function public.get_accommodation_map_draft() to booking_app;
grant execute on function public.save_accommodation_map_draft(jsonb) to booking_app;
grant execute on function public.publish_accommodation_map() to booking_app;
-- Deferred allocation constraint triggers run with the inserting role and call
-- this read-only assertion at commit time. Without this exact EXECUTE grant,
-- a valid pending request is rolled back with SQLSTATE 42501.
grant execute on function public._assert_booking_allocation_state(uuid) to booking_app;

alter table public.booking_requests enable row level security;
alter table public.booking_allocations enable row level security;
alter table public.telegram_trip_routes enable row level security;
alter table public.accommodation_map_config enable row level security;

drop policy if exists booking_app_requests_select on public.booking_requests;
create policy booking_app_requests_select
  on public.booking_requests
  for select
  to booking_app
  using (true);

drop policy if exists booking_app_requests_insert on public.booking_requests;
create policy booking_app_requests_insert
  on public.booking_requests
  for insert
  to booking_app
  with check (
    status = 'pending'
    and telegram_chat_id is null
    and telegram_message_id is null
    and telegram_topic_id is null
    and telegram_routing_claim_token is null
    and telegram_routing_claimed_at is null
    and notification_error is null
    and notified_at is null
    and status_changed_by_telegram_user_id is null
  );

drop policy if exists booking_app_requests_update on public.booking_requests;
create policy booking_app_requests_update
  on public.booking_requests
  for update
  to booking_app
  using (true)
  with check (
    status in ('pending', 'confirmed', 'rejected', 'cancelled', 'notification_failed')
  );

drop policy if exists booking_app_allocations_select on public.booking_allocations;
create policy booking_app_allocations_select
  on public.booking_allocations
  for select
  to booking_app
  using (true);

-- Fail the provisioning transaction if a pre-existing booking_app still owns
-- persistent objects or retained a privilege that bypasses this contract.
do $booking_app_assertions$
declare
  runtime_role pg_catalog.pg_roles%rowtype;
  runtime_role_oid oid;
  runtime_function oid;
begin
  select *
    into runtime_role
    from pg_catalog.pg_roles
   where rolname = 'booking_app';
  runtime_role_oid := runtime_role.oid;

  if runtime_role.rolsuper
     or runtime_role.rolcreatedb
     or runtime_role.rolcreaterole
     or runtime_role.rolinherit
     or runtime_role.rolreplication
     or runtime_role.rolbypassrls then
    raise exception 'booking_app retained a privileged role attribute';
  end if;

  if exists (
    select 1 from pg_catalog.pg_auth_members where member = runtime_role_oid
  ) then
    raise exception 'booking_app retained role memberships';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_database
     where datname = current_database()
       and datdba = runtime_role_oid
  ) or exists (
    select 1
      from pg_catalog.pg_namespace
     where nspowner = runtime_role_oid
  ) or exists (
    select 1
      from pg_catalog.pg_class relation
     where relation.relowner = runtime_role_oid
       and relation.relpersistence <> 't'
  ) or exists (
    select 1
      from pg_catalog.pg_proc routine
     where routine.proowner = runtime_role_oid
  ) then
    raise exception 'booking_app must not own the database or persistent schema objects';
  end if;

  if pg_catalog.has_database_privilege('booking_app', current_database(), 'CREATE')
     or pg_catalog.has_schema_privilege('booking_app', 'public', 'CREATE')
     or pg_catalog.has_table_privilege('booking_app', 'public.booking_allocations', 'INSERT')
     or pg_catalog.has_table_privilege('booking_app', 'public.booking_allocations', 'UPDATE')
     or pg_catalog.has_table_privilege('booking_app', 'public.booking_allocations', 'DELETE')
     or pg_catalog.has_table_privilege('booking_app', 'public.booking_requests', 'DELETE')
     or pg_catalog.has_table_privilege('booking_app', 'public.booking_requests', 'TRUNCATE')
     or pg_catalog.has_table_privilege('booking_app', 'public.telegram_trip_routes', 'SELECT')
     or pg_catalog.has_table_privilege('booking_app', 'public.telegram_trip_routes', 'INSERT')
     or pg_catalog.has_table_privilege('booking_app', 'public.telegram_trip_routes', 'UPDATE')
     or pg_catalog.has_table_privilege('booking_app', 'public.telegram_trip_routes', 'DELETE')
     or pg_catalog.has_table_privilege('booking_app', 'public.telegram_trip_routes', 'TRUNCATE')
     or pg_catalog.has_table_privilege('booking_app', 'public.telegram_trip_routes', 'REFERENCES')
     or pg_catalog.has_table_privilege('booking_app', 'public.telegram_trip_routes', 'TRIGGER')
     or pg_catalog.has_table_privilege('booking_app', 'public.accommodation_map_config', 'SELECT')
     or pg_catalog.has_table_privilege('booking_app', 'public.accommodation_map_config', 'INSERT')
     or pg_catalog.has_table_privilege('booking_app', 'public.accommodation_map_config', 'UPDATE')
     or pg_catalog.has_table_privilege('booking_app', 'public.accommodation_map_config', 'DELETE')
     or pg_catalog.has_table_privilege('booking_app', 'public.accommodation_map_config', 'TRUNCATE')
     or pg_catalog.has_table_privilege('booking_app', 'public.accommodation_map_config', 'REFERENCES')
     or pg_catalog.has_table_privilege('booking_app', 'public.accommodation_map_config', 'TRIGGER') then
    raise exception 'booking_app retained DDL or direct inventory mutation privileges';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_namespace namespace
     where namespace.nspname !~ '^pg_temp_'
       and pg_catalog.has_schema_privilege(
         'booking_app',
         namespace.oid,
         'CREATE'
       )
  ) then
    raise exception 'booking_app can create persistent schema objects';
  end if;

  if not pg_catalog.has_database_privilege('booking_app', current_database(), 'CONNECT')
     or not pg_catalog.has_schema_privilege('booking_app', 'public', 'USAGE')
     or not pg_catalog.has_column_privilege('booking_app', 'public.booking_requests', 'request_key', 'SELECT')
     or not pg_catalog.has_column_privilege('booking_app', 'public.booking_requests', 'id', 'INSERT')
     or not pg_catalog.has_column_privilege('booking_app', 'public.booking_requests', 'status', 'UPDATE')
     or not pg_catalog.has_column_privilege('booking_app', 'public.booking_allocations', 'unit_id', 'SELECT') then
    raise exception 'booking_app is missing a required runtime privilege';
  end if;

  if not pg_catalog.has_function_privilege(
    'booking_app',
    'public._assert_booking_allocation_state(uuid)'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'booking_app cannot execute deferred allocation assertion';
  end if;

  foreach runtime_function in array array[
    'public.booking_availability(date,date)'::regprocedure,
    'public.check_booking_availability(text,smallint,text[],date,date)'::regprocedure,
    'public.confirm_booking_request(uuid,bigint)'::regprocedure,
    'public.transition_booking_request(uuid,text,bigint)'::regprocedure,
    'public.claim_telegram_update(bigint)'::regprocedure,
    'public.complete_telegram_update(bigint)'::regprocedure,
    'public.release_telegram_update(bigint)'::regprocedure,
    'public.cleanup_booking_rate_limits(integer,integer)'::regprocedure,
    'public.reserve_booking_rate_limit(text[],integer)'::regprocedure,
    'public.release_booking_rate_limit(text,uuid)'::regprocedure,
    'public.claim_trip_message_routing(bigint,bigint,bigint,bigint,uuid)'::regprocedure,
    'public.complete_trip_message_routing(bigint,bigint,uuid,bigint)'::regprocedure,
    'public.release_trip_message_routing(bigint,bigint,uuid)'::regprocedure,
    'public.get_published_accommodation_map()'::regprocedure,
    'public.get_accommodation_map_draft()'::regprocedure,
    'public.save_accommodation_map_draft(jsonb)'::regprocedure,
    'public.publish_accommodation_map()'::regprocedure
  ] loop
    if not pg_catalog.has_function_privilege('booking_app', runtime_function, 'EXECUTE') then
      raise exception 'booking_app cannot execute required function %', runtime_function::regprocedure;
    end if;

    if not exists (
      select 1
        from pg_catalog.pg_proc routine
       where routine.oid = runtime_function
         and routine.prosecdef
         and exists (
           select 1
             from unnest(coalesce(routine.proconfig, '{}'::text[])) setting
            where setting like 'search_path=%'
         )
    ) then
      raise exception 'runtime function % must be SECURITY DEFINER with a fixed search_path', runtime_function::regprocedure;
    end if;
  end loop;
end;
$booking_app_assertions$;

commit;
