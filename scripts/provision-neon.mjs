import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

import { persistEnvFile } from "./env-file.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const envPath = path.join(workspaceRoot, ".env");
const migrationDirectory = path.join(workspaceRoot, "supabase", "migrations");
const rolePath = path.join(workspaceRoot, "database", "booking-app-role.sql");

const ownerDatabaseUrl = process.env.NEON_OWNER_DATABASE_URL?.trim();
if (!ownerDatabaseUrl) {
  throw new Error("NEON_OWNER_DATABASE_URL is required in .env");
}

const ownerUrl = new URL(ownerDatabaseUrl);
ownerUrl.searchParams.delete("channel_binding");
ownerUrl.searchParams.set("sslmode", "require");

const owner = postgres(ownerUrl.toString(), {
  max: 1,
  prepare: false,
  connect_timeout: 45,
  idle_timeout: 20,
});

let runtime = null;

try {
  const [state] = await owner`
    select
      to_regclass('public.booking_requests')::text as booking_schema,
      exists (
        select 1 from pg_catalog.pg_roles where rolname = 'booking_app'
      ) as booking_role
  `;

  if (state.booking_schema || state.booking_role) {
    throw new Error(
      "Booking schema or runtime role already exists; refusing a partial re-provision",
    );
  }

  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (migrationNames.length === 0) {
    throw new Error("No Neon migrations found");
  }

  const [migrationSqlFiles, roleSql] = await Promise.all([
    Promise.all(migrationNames.map((name) => (
      readFile(path.join(migrationDirectory, name), "utf8")
    ))),
    readFile(rolePath, "utf8"),
  ]);

  await owner.begin(async (transaction) => {
    for (const migrationSql of migrationSqlFiles) {
      await transaction.unsafe(migrationSql);
    }
  });
  await owner.unsafe(roleSql);

  const runtimePassword = randomBytes(32).toString("base64url");
  await owner.unsafe(
    `alter role booking_app password '${runtimePassword}'`,
  );

  const runtimeUrl = new URL(ownerUrl);
  runtimeUrl.username = "booking_app";
  runtimeUrl.password = runtimePassword;
  runtimeUrl.hostname = runtimeUrl.hostname.replace(
    /^([^.]+)/,
    "$1-pooler",
  );
  runtimeUrl.searchParams.delete("channel_binding");
  runtimeUrl.searchParams.set("sslmode", "require");

  runtime = postgres(runtimeUrl.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 45,
    idle_timeout: 20,
  });

  const [verification] = await runtime`
    select
      current_user as role,
      (select count(*)::integer from public.booking_units) as unit_count,
      to_regprocedure(
        'public.confirm_booking_request(uuid,bigint)'
      ) is not null as confirm_function,
      not has_schema_privilege(
        current_user,
        'public',
        'CREATE'
      ) as ddl_blocked
  `;

  if (
    verification.role !== "booking_app"
    || verification.unit_count !== 9
    || !verification.confirm_function
    || !verification.ddl_blocked
  ) {
    throw new Error("Runtime role verification failed");
  }

  await persistEnvFile(envPath, {
    DATABASE_URL: runtimeUrl.toString(),
    NEON_OWNER_DATABASE_URL: "",
  });

  console.log("Neon booking database is ready.");
  console.log("Runtime role: booking_app");
  console.log("Inventory units: 9");
  console.log("Owner credential removed from .env");
} finally {
  if (runtime) await runtime.end({ timeout: 2 }).catch(() => {});
  await owner.end({ timeout: 2 }).catch(() => {});
}
