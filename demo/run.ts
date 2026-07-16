import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

interface DemoLifecycle {
  readonly signal: AbortSignal;
  dispose(): void;
}

export interface DemoConfiguration {
  mode: "deterministic" | "live";
  repositoryRoot: string;
  scratchParent: string;
  coreUrl: string;
  dashboardUrl: string;
  telemetryPath: string;
  scenarioPath: string;
  smokeCommand: string[];
  coreCommand: string[];
  dashboardBuildCommand: string[];
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

export interface DemoCoreStatus {
  status: "ready";
  outcome: "success" | "validation_failure";
  incidentId: string;
  repositoryRoot: string;
  deliveryCalls: number;
  issueCalls: number;
}

export interface DemoRunOptions {
  verify: boolean;
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
const allowedChildVariables = new Set([
  "BUN_INSTALL",
  "CI",
  "CODEX_BIN",
  "CODEX_HOME",
  "COLORTERM",
  "FORCE_COLOR",
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
  if (corePort === dashboardPort)
    throw new DemoConfigurationError("Demo ports must be different");

  const scratchParent = normalizedAbsolutePath(
    environment.PODO_DEMO_SCRATCH_PARENT ??
      resolve(tmpdir(), "podo-demo-worktrees"),
    "PODO_DEMO_SCRATCH_PARENT",
  );
  const inherited = sanitizeChildEnvironment(environment);
  const coreUrl = `http://${host}:${corePort}`;
  const dashboardUrl = `http://${host}:${dashboardPort}`;
  const regressionCommand = [
    bunExecutable,
    "test",
    "demo/services/checkout-service",
  ];

  const liveCoreEnvironment = {
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
  const deterministicCoreEnvironment = {
    ...inherited,
    PODO_CORE_PORT: String(corePort),
    PODO_DEMO_OUTCOME: parseOutcome(environment.PODO_DEMO_OUTCOME),
    PODO_DEMO_SCRATCH_PARENT: scratchParent,
  };
  const dashboardEnvironment = {
    ...inherited,
    NEXT_TELEMETRY_DISABLED: "1",
    PODO_CORE_URL: coreUrl,
    PODO_DASHBOARD_MODE: "live",
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
    smokeCommand: [bunExecutable, "run", "codex:smoke"],
    coreCommand:
      mode === "deterministic"
        ? [bunExecutable, "run", "--cwd", resolve(root, "demo"), "core"]
        : [bunExecutable, "run", "--cwd", resolve(root, "apps/core"), "start"],
    dashboardBuildCommand: [
      bunExecutable,
      "run",
      "--cwd",
      resolve(root, "apps/dashboard"),
      "build",
    ],
    dashboardCommand: [
      bunExecutable,
      "run",
      "--cwd",
      resolve(root, "apps/dashboard"),
      "start",
      "--hostname",
      host,
      "--port",
      String(dashboardPort),
    ],
    coreEnvironment:
      mode === "deterministic"
        ? deterministicCoreEnvironment
        : liveCoreEnvironment,
    dashboardEnvironment,
    host,
    corePort,
    dashboardPort,
  };
}

/**
 * Parse the tiny public command-line contract for the judge demo before it
 * creates child processes. `--verify` proves the full ready state and then
 * exits; the default remains the interactive presentation.
 */
export function parseDemoRunOptions(
  arguments_: readonly string[],
): DemoRunOptions {
  if (arguments_.length === 0) return { verify: false };
  if (arguments_.length === 1 && arguments_[0] === "--verify")
    return { verify: true };

  const unexpected = arguments_.find((argument) => argument !== "--verify");
  throw new DemoConfigurationError(
    unexpected
      ? `Unknown demo option: ${unexpected}`
      : "Demo accepts --verify at most once",
  );
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
  options: DemoRunOptions = { verify: false },
): Promise<void> {
  const config = createDemoConfiguration(environment);
  const children: DemoChildProcess[] = [];
  const lifecycle = createDemoLifecycle();

  try {
    await Promise.all([
      assertPortAvailable(config.host, config.corePort, "Core"),
      assertPortAvailable(config.host, config.dashboardPort, "Dashboard"),
      mkdir(config.scratchParent, { recursive: true }),
    ]);

    const smoke = spawn(
      config.smokeCommand,
      config.repositoryRoot,
      config.coreEnvironment,
    );
    children.push(smoke);
    await requireSuccessfulExit(
      smoke,
      "Codex app-server smoke check",
      lifecycle,
    );
    children.pop();

    const dashboardBuild = spawn(
      config.dashboardBuildCommand,
      config.repositoryRoot,
      config.dashboardEnvironment,
    );
    children.push(dashboardBuild);
    await requireSuccessfulExit(
      dashboardBuild,
      "Dashboard production build",
      lifecycle,
    );
    children.pop();

    const core = spawn(
      config.coreCommand,
      config.repositoryRoot,
      config.coreEnvironment,
    );
    children.push(core);

    const client = createPodoClient({ baseUrl: config.coreUrl });
    let incident: DetectedIncident;
    let dashboardEnvironment = config.dashboardEnvironment;
    let replay: ReplaySummary | null = null;

    if (config.mode === "deterministic") {
      const status = await waitForDemoCore(
        core,
        config.coreUrl,
        lifecycle.signal,
      );
      const { incident: coreIncident } = await client.getIncident(
        status.incidentId,
      );
      incident = coreIncident;
      dashboardEnvironment = {
        ...dashboardEnvironment,
        PODO_INCIDENT_CWD: status.repositoryRoot,
      };
    } else {
      await waitForEndpoint(
        core,
        `${config.coreUrl}/readyz`,
        "Core",
        lifecycle.signal,
      );
      const [telemetry, scenario] = await Promise.all([
        Bun.file(config.telemetryPath).json(),
        Bun.file(config.scenarioPath).json(),
      ]);
      const seeded = await seedCanonicalIncident(
        client,
        telemetry as readonly unknown[],
        parseCanonicalScenario(scenario),
      );
      incident = seeded.incident;
      replay = seeded.replay;
    }

    const incidentUrl = `${config.dashboardUrl}/?incident=${encodeURIComponent(incident.id)}`;
    const dashboard = spawn(
      config.dashboardCommand,
      config.repositoryRoot,
      dashboardEnvironment,
    );
    children.push(dashboard);
    await waitForEndpoint(
      dashboard,
      incidentUrl,
      "Dashboard",
      lifecycle.signal,
      60_000,
    );

    console.log("");
    console.log(
      config.mode === "deterministic"
        ? "Podo judge demo is ready."
        : "Podo live diagnostic demo is ready.",
    );
    console.log(`Dashboard: ${incidentUrl}`);
    console.log(`Incident: ${incident.id} (${incident.affectedService})`);
    if (replay)
      console.log(
        `Replay: ${replay.accepted} accepted events, ${replay.rejected} rejected`,
      );
    console.log(
      config.mode === "deterministic"
        ? "Core owns the complete local incident → evidence → diagnosis → tested fix → PR flow. GitHub delivery is deterministic and performs no external writes."
        : "GitHub writes are disabled. Live Codex may correctly stop at issue fallback when code provenance is insufficient.",
    );
    if (options.verify) {
      console.log("Verification complete; stopping Core and Dashboard.");
      return;
    }
    console.log("Press Ctrl-C to stop Core and Dashboard.");
    await waitForShutdown(children, lifecycle);
  } catch (error) {
    if (!lifecycle.signal.aborted) throw error;
  } finally {
    lifecycle.dispose();
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

async function requireSuccessfulExit(
  child: DemoChildProcess,
  label: string,
  lifecycle: DemoLifecycle,
): Promise<void> {
  const exitCode = await Promise.race([
    child.exited,
    aborted(lifecycle.signal).then(() => null),
  ]);
  if (exitCode === null) throw new DemoRuntimeError(`${label} interrupted`);
  if (exitCode !== 0) throw new DemoRuntimeError(`${label} failed`);
}

async function waitForDemoCore(
  child: DemoChildProcess,
  coreUrl: string,
  signal: AbortSignal,
): Promise<DemoCoreStatus> {
  let status: DemoCoreStatus | null = null;
  await waitForEndpoint(
    child,
    `${coreUrl}/__demo/status`,
    "Demo Core",
    signal,
    30_000,
    async (response) => {
      const value = (await response.json()) as unknown;
      status = parseDemoCoreStatus(value);
      return true;
    },
  );
  if (!status) throw new DemoRuntimeError("Demo Core returned no status");
  return status;
}

export function parseDemoCoreStatus(value: unknown): DemoCoreStatus {
  if (
    !isRecord(value) ||
    value.status !== "ready" ||
    (value.outcome !== "success" && value.outcome !== "validation_failure") ||
    !isBoundedText(value.incidentId, 256) ||
    !isBoundedText(value.repositoryRoot, 4096) ||
    !isAbsolute(value.repositoryRoot) ||
    !Number.isSafeInteger(value.deliveryCalls) ||
    !Number.isSafeInteger(value.issueCalls)
  ) {
    throw new DemoRuntimeError("Demo Core readiness response is invalid");
  }
  return value as unknown as DemoCoreStatus;
}

async function waitForEndpoint(
  child: DemoChildProcess,
  url: string,
  label: string,
  signal: AbortSignal,
  timeoutMs = 30_000,
  validate: (response: Response) => Promise<boolean> = async () => true,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted)
      throw new DemoRuntimeError(`${label} startup interrupted`);
    if (child.exitCode !== null)
      throw new DemoRuntimeError(`${label} exited before becoming ready`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && (await validate(response))) return;
    } catch (error) {
      if (error instanceof DemoRuntimeError) throw error;
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

function createDemoLifecycle(): DemoLifecycle {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return {
    signal: controller.signal,
    dispose() {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
  };
}

async function waitForShutdown(
  children: DemoChildProcess[],
  lifecycle: DemoLifecycle,
): Promise<void> {
  await Promise.race([
    aborted(lifecycle.signal),
    Promise.race(
      children.map((child) =>
        child.exited.then(() => {
          throw new DemoRuntimeError("A demo process exited unexpectedly");
        }),
      ),
    ),
  ]);
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
    if (typeof value === "string" && allowedChildVariables.has(key))
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

function parseOutcome(
  value: string | undefined,
): "success" | "validation_failure" {
  if (value === undefined || value === "success") return "success";
  if (value === "validation_failure") return "validation_failure";
  throw new DemoConfigurationError(
    "PODO_DEMO_OUTCOME must be success or validation_failure",
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

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolvePromise) =>
    signal.addEventListener("abort", () => resolvePromise(), { once: true }),
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

async function main(): Promise<void> {
  await runDemo(process.env, parseDemoRunOptions(process.argv.slice(2)));
}

if (import.meta.main) {
  main().catch((error) => {
    const message =
      error instanceof Error ? error.message : "unknown demo failure";
    console.error(`Podo demo failed: ${message}`);
    process.exitCode = 1;
  });
}
