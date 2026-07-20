import { defineConfig, devices } from "@playwright/test"

const dashboardPort = Number(process.env.PODO_DASHBOARD_E2E_PORT ?? 3000)
const corePort = Number(process.env.PODO_DASHBOARD_E2E_CORE_PORT ?? 4101)
const baseURL = `http://127.0.0.1:${dashboardPort}`
const coreURL = `http://127.0.0.1:${corePort}`

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  // Core mutations require the trusted server composition and are covered by
  // playwright.core.config.ts against an actual Core process.
  testIgnore: ["**/live-core.pw.ts", "**/real-core.pw.ts"],
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: [
    {
      command: `PODO_DASHBOARD_E2E_CORE_PORT=${corePort} node e2e/fake-core.mjs`,
      url: `${coreURL}/healthz`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `PODO_DASHBOARD_MODE=demo PODO_CORE_URL=${coreURL} bun run build && PODO_DASHBOARD_MODE=demo PODO_CORE_URL=${coreURL} bun run start --hostname 127.0.0.1 --port ${dashboardPort}`,
      url: `${baseURL}/demo`,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
})
