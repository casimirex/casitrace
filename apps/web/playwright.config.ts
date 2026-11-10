import { defineConfig, devices } from "@playwright/test";

// Starts the API, the worker (it sends the emails the flows depend on) and the web dev server.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Rate limiting is covered by API tests; the browser suite creates many accounts from one IP.
      command: "AUTH_RATE_LIMIT=off bun --cwd ../api --env-file=../../.env src/main.ts",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "bun --cwd ../worker --env-file=../../.env src/main.ts",
      wait: { stdout: /worker started/ },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "bun run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
