import { resolve } from "node:path";

import { createPodoClient } from "@podo/client";
import type { DetectedIncident } from "@podo/contracts";
import {
  CodexRemediationPatchProducer,
  createCoreHandler,
  type IssueDeliveryInput,
  LocalWorktreeRemediationExecutor,
  loadProductionIncidentGraph,
  type PullRequestDeliveryInput,
} from "@podo/core";
import { replayTelemetry } from "@podo/plugin-otel-replay";
import {
  CACHE_REGRESSION_PATH,
  CanonicalDiagnosisRuntime,
  CanonicalRemediationRuntime,
  createCanonicalRemediationRepository,
  type CanonicalRemediationRepository,
} from "./canonical-runtime";

export type DemoOutcome = "success" | "validation_failure";

interface DemoMetrics {
  deliveryCalls: number;
  issueCalls: number;
}

interface DemoCoreState {
  handler: ReturnType<typeof createCoreHandler>;
  incident: DetectedIncident;
  metrics: DemoMetrics;
  outcome: DemoOutcome;
}

export interface DemoCoreStatus {
  status: "ready";
  outcome: DemoOutcome;
  incidentId: string;
  repositoryRoot: string;
  deliveryCalls: number;
  issueCalls: number;
}

export interface DemoCoreOptions {
  sourceRoot: string;
  bunExecutable: string;
  fixture: CanonicalRemediationRepository;
  outcome: DemoOutcome;
}

const expectedRepository = "reseaxch/podo";

export async function createDemoCoreState(
  options: DemoCoreOptions,
): Promise<DemoCoreState> {
  const incidentGraph = await loadProductionIncidentGraph({
    PODO_INCIDENT_GRAPH_ENABLED: "true",
    PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: resolve(
      options.sourceRoot,
      "scenarios/cache-growth/graph-bootstrap.json",
    ),
  });
  if (!incidentGraph)
    throw new Error("Canonical incident graph is unavailable");

  const diagnosisRuntime = new CanonicalDiagnosisRuntime();
  const remediationRuntime = new CanonicalRemediationRuntime(
    options.outcome === "success",
  );
  const metrics: DemoMetrics = { deliveryCalls: 0, issueCalls: 0 };
  const remediationExecutor = new LocalWorktreeRemediationExecutor({
    repositoryRoot: options.fixture.repositoryRoot,
    trustedBaseRef: "refs/heads/main",
    pullRequestBaseBranch: "main",
    scratchParent: options.fixture.scratchParent,
    regressionCommand: [options.bunExecutable, "test", CACHE_REGRESSION_PATH],
    validationCommands: [
      [options.bunExecutable, "test", "demo/services/checkout-service"],
      [
        options.bunExecutable,
        "build",
        "demo/services/checkout-service/src/server.ts",
        "--target",
        "bun",
        "--outfile",
        "/dev/null",
      ],
    ],
    commandTimeoutMs: 120_000,
    maxOutputBytes: 512 * 1024,
    producer: new CodexRemediationPatchProducer({
      runtime: remediationRuntime,
      turnTimeoutMs: 30_000,
    }),
  });
  const handler = createCoreHandler({
    runtime: diagnosisRuntime,
    remediationExecutor,
    incidentGraph,
    pullRequestDelivery: {
      expectedRepository,
      operatorIdentity: "judge-demo-operator",
      port: {
        async deliver(input: PullRequestDeliveryInput) {
          metrics.deliveryCalls += 1;
          return pullRequestResult(input);
        },
      },
    },
    issueDelivery: {
      expectedRepository,
      port: {
        async create(input: IssueDeliveryInput) {
          metrics.issueCalls += 1;
          return issueResult(input);
        },
      },
    },
  });
  const client = createPodoClient({
    baseUrl: "http://podo.demo.internal",
    fetch: (input, init) => handler(new Request(input, init)),
  });
  const telemetry = await Bun.file(
    resolve(
      options.sourceRoot,
      "scenarios/cache-growth/fixtures/telemetry.json",
    ),
  ).json();
  if (!Array.isArray(telemetry))
    throw new Error("Canonical telemetry fixture must be an array");
  await client.updateSettings({ autonomyMode: "act_with_approval" });
  const replay = await replayTelemetry(telemetry, client, {
    acceleration: 1_000_000,
    batchSize: 50,
  });
  if (replay.status !== "completed" || replay.rejected !== 0)
    throw new Error("Canonical telemetry replay failed");
  const { incidents } = await client.listIncidents();
  if (incidents.length !== 1)
    throw new Error("Canonical telemetry must create exactly one incident");
  const incident = incidents[0]!;
  diagnosisRuntime.prepareAutomaticDiagnosis({
    evidenceIds: incident.evidence.map(({ id }) => id),
    affectedService: incident.affectedService,
    safeToAttemptFix: true,
  });
  return { handler, incident, metrics, outcome: options.outcome };
}

export function parseDemoOutcome(value: string | undefined): DemoOutcome {
  if (value === undefined || value === "success") return "success";
  if (value === "validation_failure") return "validation_failure";
  throw new Error("PODO_DEMO_OUTCOME must be success or validation_failure");
}

function pullRequestResult(input: PullRequestDeliveryInput) {
  return {
    provider: "github",
    repository: expectedRepository,
    number: 1842,
    url: `https://github.com/${expectedRepository}/pull/1842`,
    baseCommit: input.artifact.provenance.baseCommit,
    baseBranch: input.artifact.pullRequestPreview.baseBranch,
    headBranch: input.artifact.pullRequestPreview.headBranch,
    headSha: "d".repeat(40),
    artifactId: input.artifact.pullRequestPreview.id,
    proof: {
      providerStatus: "created",
      idempotencyKey: input.deliveryId,
      resultTreeOid: input.artifact.provenance.resultTreeOid,
      patchSha256: input.artifact.patch.sha256,
      validationChecks: [...input.artifact.validation.checks],
      evidenceIds: [...input.artifact.evidenceIds],
      authorization: {
        approvalId: input.authorization.approvalId,
        approvedBy: input.authorization.approvedBy,
        approvedAt: input.authorization.approvedAt,
      },
    },
  };
}

function issueResult(input: IssueDeliveryInput) {
  return {
    provider: "github",
    status: "created",
    repository: expectedRepository,
    number: 91,
    url: `https://github.com/${expectedRepository}/issues/91`,
    state: "open",
    draft: {
      id: input.draft.id,
      idempotencyKey: input.draft.idempotencyKey,
      contentSha256: input.draft.contentSha256,
    },
    authorization: {
      id: input.authorization.authorizationId,
      authorizedAt: input.authorization.authorizedAt,
    },
    incident: {
      id: input.draft.content.incidentId,
      reason: input.draft.content.reason,
      evidenceIds: [...input.draft.content.evidenceIds],
    },
  };
}

async function runServer(): Promise<void> {
  const sourceRoot = resolve(import.meta.dir, "..");
  const bunExecutable = process.execPath;
  const port = parsePort(process.env.PODO_CORE_PORT, 4100);
  const host = "127.0.0.1";
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  let fixture: CanonicalRemediationRepository | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    fixture = await createCanonicalRemediationRepository(
      sourceRoot,
      process.env.PODO_DEMO_SCRATCH_PARENT,
    );
    if (controller.signal.aborted) return;
    let state = await createDemoCoreState({
      sourceRoot,
      bunExecutable,
      fixture,
      outcome: parseDemoOutcome(process.env.PODO_DEMO_OUTCOME),
    });
    if (controller.signal.aborted) return;
    const testControl = process.env.PODO_DEMO_TEST_CONTROL === "true";
    let reset: Promise<void> | null = null;

    server = Bun.serve({
      hostname: host,
      port,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/__demo/status" && request.method === "GET")
          return Response.json(status(state, fixture!));
        if (
          url.pathname === "/__demo/reset" &&
          request.method === "POST" &&
          testControl
        ) {
          if (!reset) {
            reset = (async () => {
              const body = (await request.json()) as { outcome?: unknown };
              const outcome = parseDemoOutcome(
                typeof body.outcome === "string" ? body.outcome : undefined,
              );
              state = await createDemoCoreState({
                sourceRoot,
                bunExecutable,
                fixture: fixture!,
                outcome,
              });
            })().finally(() => {
              reset = null;
            });
          }
          await reset;
          return Response.json(status(state, fixture!));
        }
        return state.handler(request);
      },
    });
    console.log(`Podo demo core listening on http://${host}:${server.port}`);
    await aborted(controller.signal);
  } finally {
    server?.stop(true);
    if (fixture) await fixture.dispose();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolvePromise) =>
    signal.addEventListener("abort", () => resolvePromise(), { once: true }),
  );
}

function status(
  state: DemoCoreState,
  fixture: CanonicalRemediationRepository,
): DemoCoreStatus {
  return {
    status: "ready",
    outcome: state.outcome,
    incidentId: state.incident.id,
    repositoryRoot: fixture.repositoryRoot,
    deliveryCalls: state.metrics.deliveryCalls,
    issueCalls: state.metrics.issueCalls,
  };
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Invalid PODO_CORE_PORT");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 65_535)
    throw new Error("Invalid PODO_CORE_PORT");
  return parsed;
}

if (import.meta.main) {
  runServer().catch((error) => {
    console.error(
      `Podo demo core failed: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
    process.exitCode = 1;
  });
}
