import path from "node:path";
import { defineConfig } from "prisma/config";

// Load the repo-root .env when present (CI provides env vars directly).
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  /* no .env file */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
