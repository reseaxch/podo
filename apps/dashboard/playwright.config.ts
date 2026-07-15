import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node e2e/fake-core.mjs",
      url: "http://127.0.0.1:4101/healthz",
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "PODO_DASHBOARD_MODE=demo PODO_CORE_URL=http://127.0.0.1:4101 ./node_modules/.bin/next dev",
      url: "http://localhost:3000/demo",
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
})
