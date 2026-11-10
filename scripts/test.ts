// Runs the backend test suite against the dedicated test database and test bucket (ADR 0012).
// Usage: bun run test [bun test args...]
import { $ } from "bun";

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) throw new Error("TEST_DATABASE_URL is not set (copy .env.example to .env)");

const env = {
  ...process.env,
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: testDbUrl,
  S3_BUCKET: process.env.TEST_S3_BUCKET ?? "casitrace-evidence-test",
};

await $`bunx prisma migrate deploy`.cwd("packages/db").env(env).quiet();
const args = process.argv.slice(2);
const proc = Bun.spawn(["bun", "test", "--timeout", "20000", ...args], {
  env,
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await proc.exited);
