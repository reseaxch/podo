import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectCodexRuntime } from "@podo/codex-app-server-client";
import { createPodoClient, type PodoClient } from "@podo/client";
import type { DetectedIncident } from "@podo/contracts";
import { replayTelemetry, type ReplaySummary } from "@podo/plugin-otel-replay";

type Environment = Readonly<Record<string, string | undefined>>;
type DemoClient = Pick<
  PodoClient,
  "updateSettings" | "ingestTelemetry" | "listIncidents"
>;

interface DemoChildProcess {
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): void;
}

export interface DemoConfiguration {
  mode: "deterministic" | "live";
  repositoryRoot: string;
  scratchParent: string;
  coreUrl: string;
  dashboardUrl: string;
  telemetryPath: string;
  scenarioPath: string;
  proofCommand: string[];
  coreCommand: string[];
  dashboardCommand: string[];
  coreEnvironment: Record<string, string>;
  dashboardEnvironment: Record<string, string>;
  host: string;
  corePort: number;
  dashboardPort: number;
}

export interface DemoSeedResult {
  incident: DetectedIncident;
  replay: ReplaySummary;
}

interface DemoConfigurationOptions {
  repositoryRoot?: string;
  bunExecutable?: string;
}

interface CanonicalScenarioExpectation {
  createsIncident: true;
  affectedService: string;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sensitiveChildVariables = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "PODO_GITHUB_TOKEN",
]);

export function createDemoConfiguration(
  environment: Environment = process.env,
  options: DemoConfigurationOptions = {},
): DemoConfiguration {
  const root = normalizedAbsolutePath(
    options.repositoryRoot ?? repositoryRoot,
    "repository root",
  );
  const bunExecutable = normalizedAbsolutePath(
    options.bunExecutable ?? process.execPath,
    "Bun executable",
  );
  const mode = parseMode(environment.PODO_DEMO_MODE);
  const host = "127.0.0.1";
  const corePort = parsePort(
    environment.PODO_DEMO_CORE_PORT,
    4100,
    "PODO_DEMO_CORE_PORT",
  );
  const dashboardPort = parsePort(
    environment.PODO_DEMO_DASHBOARD_PORT,
    3000,
    "PODO_DEMO_DASHBOARD_PORT",
  );
  if (mode === "live" && corePort === dashboardPort)
    throw new DemoConfigurationError("Demo ports must be different");

  const scratchParent = normalizedAbsolutePath(
    environment.PODO_DEMO_SCRATCH_PARENT ??
      resolve(tmpdir(), "podo-demo-worktrees"),
    "PODO_DEMO_SCRATCH_PARENT",
  );
  const inherited = sanitizeChildEnvironment(environment);
  const coreUrl = `http://${host}:${corePort}`;
  const dashboardUrl = `http://${host}:${dashboardPort}${mode === "deterministic" ? "/demo" : ""}`;
  const regressionCommand = [
    bunExecutable,
    "test",
    "demo/services/checkout-service",
  ];

  const coreEnvironment = {
    ...inherited,
    PODO_CORE_HOST: host,
    PODO_CORE_PORT: String(corePort),
    PODO_INCIDENT_GRAPH_ENABLED: "true",
    PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: resolve(
      root,
      "scenarios/cache-growth/graph-bootstrap.json",
    ),
    PODO_REMEDIATION_ENABLED: "true",
    PODO_REMEDIATION_REPOSITORY_ROOT: root,
    PODO_REMEDIATION_BASE_REF:
      environment.PODO_DEMO_BASE_REF ?? "refs/heads/main",
    PODO_REMEDIATION_PULL_REQUEST_BASE_BRANCH: "main",
    PODO_REMEDIATION_SCRATCH_PARENT: scratchParent,
    PODO_REMEDIATION_REGRESSION_COMMAND: JSON.stringify(regressionCommand),
    PODO_REMEDIATION_VALIDATION_COMMANDS: JSON.stringify([regressionCommand]),
    PODO_REMEDIATION_COMMAND_TIMEOUT_MS: "120000",
    PODO_REMEDIATION_TURN_TIMEOUT_MS: "90000",
    PODO_REMEDIATION_MAX_OUTPUT_BYTES: "524288",
    PODO_GITHUB_DELIVERY_ENABLED: "false",
    PODO_GITHUB_ISSUE_ENABLED: "false",
  };
  const dashboardEnvironment = {
    ...inherited,
    NEXT_TELEMETRY_DISABLED: "1",
    PODO_CORE_URL: coreUrl,
    PODO_DASHBOARD_MODE: mode === "deterministic" ? "demo" : "live",
    PODO_INCIDENT_CWD: root,
  };

  return {
    mode,
    repositoryRoot: root,
    scratchParent,
    coreUrl,
    dashboardUrl,
    telemetryPath: resolve(
      root,
      "scenarios/cache-growth/fixtures/telemetry.json",
    ),
    scenarioPath: resolve(root, "scenarios/cache-growth/scenario.json"),
    proofCommand: [bunExecutable, "run", "poc"],
    coreCommand: [
      bunExecutable,
      "run",
      "--cwd",
      resolve(root, "apps/core"),
      "start",
    ],
    dashboardCommand: [
      bunExecutable,
      "run",
      "--cwd",
      resolve(root, "apps/dashboard"),
      "dev",
      "--hostname",
      host,
      "--port",
      String(dashboardPort),
    ],
    coreEnvironment,
    dashboardEnvironment,
    host,
    corePort,
    dashboardPort,
  };
}

export async function seedCanonicalIncident(
  client: DemoClient,
  telemetry: readonly unknown[],
  expectation: CanonicalScenarioExpectation,
): Promise<DemoSeedResult> {
  await client.updateSettings({ autonomyMode: "act_with_approval" });
  const replay = await replayTelemetry(
    telemetry,
    {
      ingestTelemetry: (events) => client.ingestTelemetry(events),
    },
    {
      acceleration: 1_000_000,
      batchSize: 50,
    },
  );
  if (replay.status !== "completed" || replay.rejected !== 0) {
    throw new DemoRuntimeError(
      "Canonical telemetry replay did not complete cleanly",
    );
  }

  const { incidents } = await client.listIncidents();
  if (
    incidents.length !== 1 ||
    incidents[0]?.affectedService !== expectation.affectedService
  ) {
    throw new DemoRuntimeError(
      "Canonical telemetry did not produce the expected incident",
    );
  }
  return { incident: incidents[0], replay };
}

export function parseCanonicalScenario(
  value: unknown,
): CanonicalScenarioExpectation {
  if (
    !isRecord(value) ||
    !isRecord(value.expected) ||
    value.expected.createsIncident !== true ||
    !isBoundedText(value.expected.affectedService, 256)
  ) {
    throw new DemoConfigurationError(
      "Canonical scenario expectation is invalid",
    );
  }
  return {
    createsIncident: true,
    affectedService: value.expected.affectedService,
  };
}

export async function runDemo(
  environment: Environment = process.env,
): Promise<void> {
  const config = createDemoConfiguration(environment);
  const children: DemoChildProcess[] = [];

  try {
    if (config.mode === "deterministic") {
      await assertPortAvailable(config.host, config.dashboardPort, "Dashboard");
      const proof = spawn(
        config.proofCommand,
        config.repositoryRoot,
        config.coreEnvironment,
      );
      children.push(proof);
      const exitCode = await proof.exited;
      children.pop();
      if (exitCode !== 0)
        throw new DemoRuntimeError("Canonical POC gate failed");

      const dashboard = spawn(
        config.dashboardCommand,
        config.repositoryRoot,
        config.dashboardEnvironment,
      );
      children.push(dashboard);
      await waitForEndpoint(
        dashboard,
        config.dashboardUrl,
        "Dashboard",
        60_000,
      );

      console.log("");
      console.log("Podo judge demo is ready.");
      console.log(`Dashboard: ${config.dashboardUrl}`);
      console.log(
        "Backend proof: canonical incident → evidence → diagnosis → tested fix → PR preview passed.",
      );
      console.log(
        "GitHub writes are disabled; the explicit demo UI is deterministic and local-only.",
      );
      console.log("Press Ctrl-C to stop the Dashboard.");
      await waitForShutdown(children);
      return;
    }

    await Promise.all([
      assertPortAvailable(config.host, config.corePort, "Core"),
      assertPortAvailable(config.host, config.dashboardPort, "Dashboard"),
      mkdir(config.scratchParent, { recursive: true }),
    ]);

    const runtime = await inspectCodexRuntime(
      config.coreEnvironment.CODEX_BIN ?? "codex",
    );
    console.log(`Podo live demo: Codex ${runtime.version} (${runtime.binary})`);

    const core = spawn(
      config.coreCommand,
      config.repositoryRoot,
      config.coreEnvironment,
    );
    children.push(core);
    await waitForEndpoint(core, `${config.coreUrl}/healthz`, "Core");

    const client = createPodoClient({ baseUrl: config.coreUrl });
    const [telemetry, scenario] = await Promise.all([
      Bun.file(config.telemetryPath).json(),
      Bun.file(config.scenarioPath).json(),
    ]);
    const seeded = await seedCanonicalIncident(
      client,
      telemetry as readonly unknown[],
      parseCanonicalScenario(scenario),
    );

    const dashboard = spawn(
      config.dashboardCommand,
      config.repositoryRoot,
      config.dashboardEnvironment,
    );
    children.push(dashboard);
    await waitForEndpoint(
      dashboard,
      `${config.dashboardUrl}/?incident=${encodeURIComponent(seeded.incident.id)}`,
      "Dashboard",
      60_000,
    );

    console.log("");
    console.log("Podo live diagnostic demo is ready.");
    console.log(
      `Dashboard: ${config.dashboardUrl}/?incident=${encodeURIComponent(seeded.incident.id)}`,
    );
    console.log(
      `Incident: ${seeded.incident.id} (${seeded.incident.affectedService})`,
    );
    console.log(
      `Replay: ${seeded.replay.accepted} accepted events, ${seeded.replay.rejected} rejected`,
    );
    console.log(
      "GitHub writes are disabled. Live Codex may correctly stop at issue fallback when code provenance is insufficient.",
    );
    console.log("Press Ctrl-C to stop Core and Dashboard.");

    await waitForShutdown(children);
  } finally {
    await stopChildren(children);
  }
}

function spawn(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): DemoChildProcess {
  return Bun.spawn(command, {
    cwd,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function waitForEndpoint(
  child: DemoChildProcess,
  url: string,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new DemoRuntimeError(`${label} exited before becoming ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Startup polling deliberately ignores transient connection errors.
    }
    await delay(100);
  }
  throw new DemoRuntimeError(
    `${label} did not become ready within ${timeoutMs}ms`,
  );
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
      reject(
        new DemoConfigurationError(`${label} port ${port} is unavailable`),
      ),
    );
    server.listen(port, host, () => {
      server.close((error) =>
        error
          ? reject(new DemoConfigurationError(`${label} port check failed`))
          : resolvePromise(),
      );
    });
  });
}

async function waitForShutdown(children: DemoChildProcess[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const finish = (operation: () => void) => {
      if (timer) clearInterval(timer);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      operation();
    };
    const onSignal = () => finish(resolvePromise);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    timer = setInterval(() => {
      if (children.some((child) => child.exitCode !== null)) {
        finish(() =>
          reject(new DemoRuntimeError("A demo process exited unexpectedly")),
        );
      }
    }, 100);
    timer.unref();
  });
}

async function stopChildren(children: DemoChildProcess[]): Promise<void> {
  await Promise.all(
    children.toReversed().map(async (child) => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      const stopped = await Promise.race([
        child.exited.then(() => true),
        delay(5_000).then(() => false),
      ]);
      if (!stopped && child.exitCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }),
  );
}

function sanitizeChildEnvironment(
  environment: Environment,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string" && !sensitiveChildVariables.has(key))
      sanitized[key] = value;
  }
  return sanitized;
}

function parsePort(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value))
    throw new DemoConfigurationError(`${name} must be an integer port`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 65_535)
    throw new DemoConfigurationError(`${name} must be an integer port`);
  return parsed;
}

function parseMode(value: string | undefined): "deterministic" | "live" {
  if (value === undefined || value === "deterministic") return "deterministic";
  if (value === "live") return "live";
  throw new DemoConfigurationError(
    "PODO_DEMO_MODE must be deterministic or live",
  );
}

function normalizedAbsolutePath(value: string, name: string): string {
  if (!isAbsolute(value) || resolve(value) !== value)
    throw new DemoConfigurationError(
      `${name} must be a normalized absolute path`,
    );
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim()
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

export class DemoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoConfigurationError";
  }
}

export class DemoRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoRuntimeError";
  }
}

if (import.meta.main) {
  runDemo().catch((error) => {
    const message =
      error instanceof Error ? error.message : "unknown demo failure";
    console.error(`Podo demo failed: ${message}`);
    process.exitCode = 1;
  });
}
