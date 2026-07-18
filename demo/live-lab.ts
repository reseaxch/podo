import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createPodoClient } from "@podo/client";
import type { IngestTelemetryResponse } from "@podo/contracts";
import {
  createCanonicalRemediationRepository,
  type CanonicalRemediationRepository,
} from "./canonical-runtime";
import { createDemoCoreRuntime } from "./core";

type Child = ReturnType<typeof Bun.spawn>;

interface LabConfiguration {
  root: string;
  host: string;
  corePort: number;
  dashboardPort: number;
  checkoutPort: number;
  inventoryPort: number;
  notificationPort: number;
  coreUrl: string;
  dashboardUrl: string;
  checkoutUrl: string;
  inventoryUrl: string;
  notificationUrl: string;
  scratchParent: string;
}

const childEnvironmentKeys = [
  "BUN_INSTALL",
  "COLORTERM",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TERM",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

export function createLabConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LabConfiguration {
  const root = resolve(import.meta.dir, "..");
  const host = "127.0.0.1";
  const corePort = parsePort(environment.PODO_LAB_CORE_PORT, 4100);
  const dashboardPort = parsePort(environment.PODO_LAB_DASHBOARD_PORT, 3000);
  const checkoutPort = parsePort(environment.PODO_LAB_CHECKOUT_PORT, 8081);
  const inventoryPort = parsePort(environment.PODO_LAB_INVENTORY_PORT, 8082);
  const notificationPort = parsePort(
    environment.PODO_LAB_NOTIFICATION_PORT,
    8083,
  );
  const ports = [
    corePort,
    dashboardPort,
    checkoutPort,
    inventoryPort,
    notificationPort,
  ];
  if (new Set(ports).size !== ports.length)
    throw new Error("Live lab ports must be unique");
  return {
    root,
    host,
    corePort,
    dashboardPort,
    checkoutPort,
    inventoryPort,
    notificationPort,
    coreUrl: `http://${host}:${corePort}`,
    dashboardUrl: `http://${host}:${dashboardPort}`,
    checkoutUrl: `http://${host}:${checkoutPort}`,
    inventoryUrl: `http://${host}:${inventoryPort}`,
    notificationUrl: `http://${host}:${notificationPort}`,
    scratchParent:
      environment.PODO_LAB_SCRATCH_PARENT ??
      resolve(tmpdir(), "podo-live-lab-worktrees"),
  };
}

async function run(): Promise<void> {
  const config = createLabConfiguration();
  await Promise.all([
    assertPortAvailable(config.host, config.corePort, "Podo Core"),
    assertPortAvailable(config.host, config.dashboardPort, "Dashboard"),
    assertPortAvailable(config.host, config.checkoutPort, "checkout-service"),
    assertPortAvailable(config.host, config.inventoryPort, "inventory-service"),
    assertPortAvailable(
      config.host,
      config.notificationPort,
      "notification-worker",
    ),
  ]);

  await runFinite(
    [process.execPath, "run", "--cwd", "apps/dashboard", "build"],
    config.root,
    childEnvironment(),
    "Dashboard build",
  );

  await mkdir(config.scratchParent, { recursive: true });
  let fixture: CanonicalRemediationRepository | null = null;
  let coreServer: ReturnType<typeof Bun.serve> | null = null;
  const children: Child[] = [];
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    fixture = await createCanonicalRemediationRepository(
      config.root,
      config.scratchParent,
    );
    const runtime = await createDemoCoreRuntime({
      sourceRoot: config.root,
      bunExecutable: process.execPath,
      fixture,
      outcome: "success",
    });
    const preparedIncidents = new Set<string>();
    coreServer = Bun.serve({
      hostname: config.host,
      port: config.corePort,
      idleTimeout: 60,
      async fetch(request) {
        const url = new URL(request.url);
        const response = await runtime.handler(request);
        if (
          request.method === "POST" &&
          url.pathname === "/api/telemetry/events" &&
          response.ok
        ) {
          const result = (await response
            .clone()
            .json()) as IngestTelemetryResponse;
          const incident = result.incident;
          if (incident && !preparedIncidents.has(incident.id)) {
            preparedIncidents.add(incident.id);
            runtime.prepareIncidentDiagnosis(incident);
          }
        }
        return response;
      },
    });
    const client = createPodoClient({ baseUrl: config.coreUrl });
    await client.updateSettings({ autonomyMode: "act_with_approval" });

    const inventory = spawn(
      [process.execPath, "src/server.ts"],
      resolve(config.root, "demo/services/inventory-service"),
      {
        ...childEnvironment(),
        INVENTORY_PORT: String(config.inventoryPort),
      },
    );
    children.push(inventory);
    const checkout = spawn(
      [process.execPath, "src/server.ts"],
      resolve(config.root, "demo/services/checkout-service"),
      {
        ...childEnvironment(),
        CHECKOUT_PORT: String(config.checkoutPort),
        INVENTORY_URL: config.inventoryUrl,
        NOTIFICATION_URL: config.notificationUrl,
        PODO_CORE_URL: config.coreUrl,
      },
    );
    children.push(checkout);
    const worker = spawn(
      [process.execPath, "src/worker.ts"],
      resolve(config.root, "demo/services/notification-worker"),
      {
        ...childEnvironment(),
        NOTIFICATION_PORT: String(config.notificationPort),
      },
    );
    children.push(worker);
    const dashboard = spawn(
      [
        process.execPath,
        "run",
        "--cwd",
        "apps/dashboard",
        "start",
        "--hostname",
        config.host,
        "--port",
        String(config.dashboardPort),
      ],
      config.root,
      {
        ...childEnvironment(),
        NEXT_TELEMETRY_DISABLED: "1",
        PODO_CORE_URL: config.coreUrl,
        PODO_DASHBOARD_MODE: "live",
        PODO_INCIDENT_CWD: config.root,
      },
    );
    children.push(dashboard);

    await Promise.all([
      waitForHealth(`${config.inventoryUrl}/healthz`, inventory),
      waitForHealth(`${config.checkoutUrl}/healthz`, checkout),
      waitForHealth(`${config.notificationUrl}/healthz`, worker),
      waitForHealth(`${config.coreUrl}/healthz`, null),
      waitForHealth(config.dashboardUrl, dashboard),
    ]);

    console.log("");
    console.log("Podo live-service lab is ready.");
    console.log(`Dashboard: ${config.dashboardUrl}`);
    console.log(`checkout-service: ${config.checkoutUrl}/status`);
    console.log(`inventory-service: ${config.inventoryUrl}/healthz`);
    console.log(`notification-worker: ${config.notificationUrl}/status`);
    console.log("");
    console.log("Generate the incident in a second terminal:");
    console.log(
      `  PODO_LAB_DASHBOARD_URL=${config.dashboardUrl} PODO_LAB_CORE_URL=${config.coreUrl} PODO_LAB_CHECKOUT_URL=${config.checkoutUrl} PODO_LAB_NOTIFICATION_URL=${config.notificationUrl} bun run lab:load`,
    );
    console.log("");
    console.log("The load command prints the exact incident URL.");
    console.log("Press Ctrl-C here to stop only this lab.");

    await Promise.race([
      aborted(controller.signal),
      ...children.map((child) =>
        child.exited.then(() => {
          throw new Error("A live lab process exited unexpectedly");
        }),
      ),
    ]);
  } finally {
    controller.abort();
    for (const child of children.toReversed()) {
      if (child.exitCode === null) child.kill("SIGTERM");
    }
    await Promise.all(children.map((child) => child.exited));
    coreServer?.stop(true);
    if (fixture) await fixture.dispose();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function childEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of childEnvironmentKeys) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  return environment;
}

function spawn(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): Child {
  return Bun.spawn(command, {
    cwd,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function runFinite(
  command: string[],
  cwd: string,
  env: Record<string, string>,
  label: string,
): Promise<void> {
  const child = spawn(command, cwd, env);
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${label} failed (${exitCode})`);
}

async function waitForHealth(
  url: string,
  child: Child | null,
  accept: (response: Response) => boolean = (response) => response.ok,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (liveLabProcessExited(child))
      throw new Error(`${url} process exited before readiness`);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(500),
      });
      if (accept(response)) {
        await response.body?.cancel();
        return;
      }
      await response.body?.cancel();
    } catch {
      // The process may still be binding its port.
    }
    await Bun.sleep(100);
  }
  throw new Error(`${url} did not become ready`);
}

export function liveLabProcessExited(
  child: Pick<Child, "exitCode"> | null,
): boolean {
  return child !== null && child.exitCode !== null;
}

async function assertPortAvailable(
  host: string,
  port: number,
  label: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", () =>
      reject(new Error(`${label} port ${port} is unavailable`)),
    );
    server.listen(port, host, () =>
      server.close((error) =>
        error
          ? reject(new Error(`${label} port check failed`))
          : resolvePromise(),
      ),
    );
  });
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Lab port is invalid");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535)
    throw new Error("Lab port is invalid");
  return port;
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolvePromise) =>
    signal.addEventListener("abort", () => resolvePromise(), { once: true }),
  );
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(
      `Podo live lab failed: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
    process.exitCode = 1;
  });
}
