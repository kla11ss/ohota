import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROLE_SQL = readFileSync(
  new URL("../database/booking-app-role.sql", import.meta.url),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  new URL("../supabase/migrations/202607210001_booking_inventory.sql", import.meta.url),
  "utf8",
);
const TRIP_ROUTING_MIGRATION_SQL = readFileSync(
  new URL("../supabase/migrations/202607220001_trip_review_routing.sql", import.meta.url),
  "utf8",
);
const ACCOMMODATION_MAP_MIGRATION_SQL = readFileSync(
  new URL("../supabase/migrations/202607220002_accommodation_map.sql", import.meta.url),
  "utf8",
);
const REPOSITORY_SOURCE = readFileSync(
  new URL("../server/booking-database.js", import.meta.url),
  "utf8",
);
const PROVISION_SOURCE = readFileSync(
  new URL("../scripts/provision-neon.mjs", import.meta.url),
  "utf8",
);

test("booking_app provisioning is idempotent and contains no embedded credential", () => {
  assert.match(ROLE_SQL, /if not exists[\s\S]+pg_catalog\.pg_roles[\s\S]+create role booking_app/i);
  assert.match(ROLE_SQL, /drop policy if exists booking_app_requests_select/i);
  assert.match(ROLE_SQL, /drop policy if exists booking_app_allocations_select/i);
  assert.doesNotMatch(ROLE_SQL, /\bpassword\b/i);
  assert.doesNotMatch(ROLE_SQL, /postgres(?:ql)?:\/\//i);
});

test("booking_app has no ownership or broad DDL and inventory grants", () => {
  assert.match(
    ROLE_SQL,
    /alter role booking_app with[\s\S]+login[\s\S]+nocreatedb[\s\S]+nocreaterole[\s\S]+noinherit[\s\S]+connection limit 20/i,
  );
  assert.match(
    ROLE_SQL,
    /runtime_role\.rolsuper[\s\S]+runtime_role\.rolcreatedb[\s\S]+runtime_role\.rolcreaterole[\s\S]+runtime_role\.rolinherit[\s\S]+runtime_role\.rolreplication[\s\S]+runtime_role\.rolbypassrls/i,
  );
  assert.match(ROLE_SQL, /revoke create on schema public from public/i);
  assert.match(ROLE_SQL, /grant usage on schema public to booking_app/i);
  assert.doesNotMatch(ROLE_SQL, /grant\s+all(?:\s+privileges)?[\s\S]+to\s+booking_app/i);
  assert.doesNotMatch(
    ROLE_SQL,
    /grant\s+(?:insert|update|delete|truncate)[\s\S]{0,100}on\s+public\.booking_allocations\s+to\s+booking_app/i,
  );
});

test("direct request access is column-scoped and protected by RLS", () => {
  assert.match(ROLE_SQL, /grant select\s*\([\s\S]+\) on public\.booking_requests to booking_app/i);
  assert.match(ROLE_SQL, /grant insert\s*\([\s\S]+\) on public\.booking_requests to booking_app/i);
  assert.match(ROLE_SQL, /grant update\s*\([\s\S]+\) on public\.booking_requests to booking_app/i);
  assert.match(ROLE_SQL, /create policy booking_app_requests_insert[\s\S]+with check/i);
  assert.match(ROLE_SQL, /create policy booking_app_requests_update[\s\S]+using \(true\)[\s\S]+with check/i);
  assert.match(ROLE_SQL, /create policy booking_app_allocations_select[\s\S]+for select/i);
});

test("runtime mutations remain behind fixed-path SECURITY DEFINER functions", () => {
  const requiredFunctions = [
    "booking_availability",
    "check_booking_availability",
    "confirm_booking_request",
    "transition_booking_request",
    "claim_telegram_update",
    "complete_telegram_update",
    "release_telegram_update",
    "cleanup_booking_rate_limits",
    "reserve_booking_rate_limit",
    "release_booking_rate_limit",
    "claim_trip_message_routing",
    "complete_trip_message_routing",
    "release_trip_message_routing",
  ];

  for (const functionName of requiredFunctions) {
    assert.match(ROLE_SQL, new RegExp(`grant execute on function public\\.${functionName}\\(`, "i"));
  }
  assert.match(ROLE_SQL, /routine\.prosecdef[\s\S]+setting like 'search_path=%'/i);
});

test("deferred allocation integrity checks can run for booking_app at commit", () => {
  assert.match(
    ROLE_SQL,
    /grant execute on function public\._assert_booking_allocation_state\(uuid\) to booking_app/i,
  );
  assert.doesNotMatch(
    ROLE_SQL,
    /grant execute on function public\._check_booking_request_(?:allocation|status)_state/i,
  );
});

test("every stored function called by the runtime repository is granted", () => {
  const runtimeFunctionCalls = [
    ...REPOSITORY_SOURCE.matchAll(
      /select(?:\s+\*)?\s+(?:from\s+)?public\.([a-z_]+)\s*\(/g,
    ),
  ].map((match) => match[1]);

  assert.ok(runtimeFunctionCalls.length > 0);
  for (const functionName of new Set(runtimeFunctionCalls)) {
    assert.match(
      ROLE_SQL,
      new RegExp(`grant execute on function public\\.${functionName}\\(`, "i"),
    );
  }
});

test("the inventory migration keeps half-open stays and database overlap protection", () => {
  assert.match(MIGRATION_SQL, /daterange\(check_in, check_out, '\[\)'\)/i);
  assert.match(
    MIGRATION_SQL,
    /exclude using gist \(unit_id with =, stay_period with &&\)/i,
  );
  assert.match(MIGRATION_SQL, /confirmed_booking_allocation_count_mismatch/i);
  assert.match(MIGRATION_SQL, /unconfirmed_booking_has_allocations/i);
});

test("trip routing migration stores only technical ids behind an expiring lease", () => {
  const tableDefinition = /create table public\.telegram_trip_routes \(([\s\S]+?)\n\);/i
    .exec(TRIP_ROUTING_MIGRATION_SQL)?.[1] ?? "";
  assert.ok(tableDefinition);
  assert.match(
    tableDefinition,
    /primary key \(source_chat_id, source_message_id\)/i,
  );
  assert.match(tableDefinition, /target_message_id bigint/i);
  assert.match(tableDefinition, /claim_token uuid/i);
  assert.match(TRIP_ROUTING_MIGRATION_SQL, /interval '2 minutes'/i);
  assert.doesNotMatch(
    tableDefinition,
    /\b(phone|name|comment|message_text|original_text)\b/i,
  );
});

test("trip routing mutations are SECURITY DEFINER only with no runtime table access", () => {
  for (const functionName of [
    "claim_trip_message_routing",
    "complete_trip_message_routing",
    "release_trip_message_routing",
  ]) {
    assert.match(
      TRIP_ROUTING_MIGRATION_SQL,
      new RegExp(`function public\\.${functionName}\\([\\s\\S]+?security definer`, "i"),
    );
    assert.match(
      TRIP_ROUTING_MIGRATION_SQL,
      new RegExp(`revoke execute on function public\\.${functionName}\\(`, "i"),
    );
    assert.match(
      ROLE_SQL,
      new RegExp(`grant execute on function public\\.${functionName}\\(`, "i"),
    );
  }
  assert.match(
    ROLE_SQL,
    /has_table_privilege\('booking_app', 'public\.telegram_trip_routes', 'SELECT'\)/i,
  );
  assert.doesNotMatch(
    ROLE_SQL,
    /grant\s+(?:select|insert|update|delete|truncate)[\s\S]{0,80}on\s+public\.telegram_trip_routes\s+to\s+booking_app/i,
  );
});

test("accommodation map keeps draft and published values behind SECURITY DEFINER functions", () => {
  assert.match(ACCOMMODATION_MAP_MIGRATION_SQL, /create table public\.accommodation_map_config/i);
  assert.match(ACCOMMODATION_MAP_MIGRATION_SQL, /draft jsonb/i);
  assert.match(ACCOMMODATION_MAP_MIGRATION_SQL, /published jsonb/i);
  assert.match(ACCOMMODATION_MAP_MIGRATION_SQL, /set published = config\.draft/i);
  assert.match(ACCOMMODATION_MAP_MIGRATION_SQL, /function public\.get_published_accommodation_map\(\)[\s\S]+?security definer/i);
  assert.match(ACCOMMODATION_MAP_MIGRATION_SQL, /function public\.save_accommodation_map_draft\(p_config jsonb\)[\s\S]+?security definer/i);
  assert.match(ROLE_SQL, /grant execute on function public\.publish_accommodation_map\(\) to booking_app/i);
  assert.match(ROLE_SQL, /has_table_privilege\('booking_app', 'public\.accommodation_map_config', 'SELECT'\)/i);
  assert.doesNotMatch(
    ROLE_SQL,
    /grant\s+(?:select|insert|update|delete|truncate)[\s\S]{0,100}on\s+public\.accommodation_map_config\s+to\s+booking_app/i,
  );
});

test("clean Neon provisioning applies every SQL migration in sorted order", () => {
  assert.match(PROVISION_SOURCE, /readdir\(migrationDirectory\)/i);
  assert.match(PROVISION_SOURCE, /\.filter\(\(name\) => name\.endsWith\("\.sql"\)\)/i);
  assert.match(PROVISION_SOURCE, /\.sort\(/i);
  assert.match(PROVISION_SOURCE, /for \(const migrationSql of migrationSqlFiles\)/i);
});
