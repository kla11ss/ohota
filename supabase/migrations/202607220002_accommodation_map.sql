-- Published accommodation-map configuration. The editor keeps a private
-- draft; guests can read only the atomically published JSON document.
create table public.accommodation_map_config (
  singleton boolean primary key default true check (singleton),
  draft jsonb,
  published jsonb,
  draft_updated_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.accommodation_map_config is
  'Editor-only accommodation scheme configuration. No guest contact data belongs here.';

create or replace function public.get_published_accommodation_map()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select config.published
    from public.accommodation_map_config config
   where config.singleton = true
   limit 1;
$$;

create or replace function public.get_accommodation_map_draft()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select config.draft
    from public.accommodation_map_config config
   where config.singleton = true
   limit 1;
$$;

create or replace function public.save_accommodation_map_draft(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  stored_config jsonb;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_accommodation_map_draft';
  end if;

  insert into public.accommodation_map_config as config (
    singleton,
    draft,
    draft_updated_at,
    updated_at
  ) values (
    true,
    p_config,
    now(),
    now()
  )
  on conflict (singleton) do update
     set draft = excluded.draft,
         draft_updated_at = excluded.draft_updated_at,
         updated_at = excluded.updated_at
  returning config.draft into stored_config;

  return stored_config;
end;
$$;

create or replace function public.publish_accommodation_map()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  published_config jsonb;
begin
  update public.accommodation_map_config config
     set published = config.draft,
         published_at = now(),
         updated_at = now()
   where config.singleton = true
     and config.draft is not null
  returning config.published into published_config;

  if published_config is null then
    raise exception using errcode = '22023', message = 'accommodation_map_draft_missing';
  end if;

  return published_config;
end;
$$;

alter table public.accommodation_map_config enable row level security;

revoke all on public.accommodation_map_config from public;
revoke execute on function public.get_published_accommodation_map() from public;
revoke execute on function public.get_accommodation_map_draft() from public;
revoke execute on function public.save_accommodation_map_draft(jsonb) from public;
revoke execute on function public.publish_accommodation_map() from public;

do $accommodation_map_privileges$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'booking_app']::text[] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = role_name) then
      execute format('revoke all on public.accommodation_map_config from %I', role_name);
      execute format('revoke execute on function public.get_published_accommodation_map() from %I', role_name);
      execute format('revoke execute on function public.get_accommodation_map_draft() from %I', role_name);
      execute format('revoke execute on function public.save_accommodation_map_draft(jsonb) from %I', role_name);
      execute format('revoke execute on function public.publish_accommodation_map() from %I', role_name);
    end if;
  end loop;

  if exists (select 1 from pg_catalog.pg_roles where rolname = 'booking_app') then
    grant execute on function public.get_published_accommodation_map() to booking_app;
    grant execute on function public.get_accommodation_map_draft() to booking_app;
    grant execute on function public.save_accommodation_map_draft(jsonb) to booking_app;
    grant execute on function public.publish_accommodation_map() to booking_app;
  end if;
end;
$accommodation_map_privileges$;
