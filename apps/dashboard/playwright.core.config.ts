import { defineConfig, devices } from "@playwright/test"

const dashboardPort = Number(process.env.PODO_DASHBOARD_CORE_E2E_PORT ?? 3020)
const corePort = Number(process.env.PODO_DASHBOARD_CORE_E2E_CORE_PORT ?? 4120)
const baseURL = `http://127.0.0.1:${dashboardPort}`
const coreURL = `http://127.0.0.1:${corePort}`

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/real-core.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: [
    {
      command: "bun run --cwd ../../demo core",
      cwd: ".",
      env: {
        PODO_CORE_PORT: String(corePort),
        PODO_DEMO_TEST_CONTROL: "true",
        PODO_DEMO_SCRATCH_PARENT: "/tmp/podo-dashboard-core-e2e",
      },
      url: `${coreURL}/__demo/status`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `bun run build && bun run start --hostname 127.0.0.1 --port ${dashboardPort}`,
      cwd: ".",
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        PODO_CORE_URL: coreURL,
        PODO_DASHBOARD_MODE: "live",
        PODO_INCIDENT_CWD: "/tmp/podo-dashboard-core-e2e/repository",
      },
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
