// Local/CI database setup (not for production). Idempotent.
//  1. creates the test database
//  2. applies migrations to the dev and test databases as the owner
//  3. gives the casitrace_app runtime role a login and lets it create the pg-boss schema
import { $, SQL } from "bun";

const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (copy .env.example to .env)`);
  return v;
};

const devOwner = required("MIGRATE_DATABASE_URL");
const testOwner = required("TEST_MIGRATE_DATABASE_URL");
const appUrl = new URL(required("DATABASE_URL"));
const appPassword = decodeURIComponent(appUrl.password);
if (appUrl.username !== "casitrace_app") throw new Error("DATABASE_URL must connect as casitrace_app");

const testDbName = new URL(testOwner).pathname.slice(1);
{
  const admin = new SQL(devOwner);
  const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${testDbName}`;
  if (!exists) await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
  await admin.close();
}

for (const ownerUrl of [devOwner, testOwner]) {
  await $`bunx prisma migrate deploy`
    .cwd("packages/db")
    .env({ ...process.env, MIGRATE_DATABASE_URL: ownerUrl })
    .quiet();
  const db = new SQL(ownerUrl);
  const dbName = new URL(ownerUrl).pathname.slice(1);
  await db.unsafe(`ALTER ROLE casitrace_app LOGIN PASSWORD '${appPassword.replaceAll("'", "''")}'`);
  await db.unsafe(`GRANT CONNECT, CREATE ON DATABASE "${dbName}" TO casitrace_app`);
  await db.unsafe("REVOKE ALL ON _prisma_migrations FROM casitrace_app");
  // pg-boss creates and owns its schema; drop a copy created earlier by another role (dev/test only).
  const [boss] =
    await db`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'pgboss'`;
  if (boss && boss.owner !== "casitrace_app") await db.unsafe("DROP SCHEMA pgboss CASCADE");
  await db.close();
  console.log(`ready: ${dbName}`);
}
