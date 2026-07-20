import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { createPodoClient } from "@podo/client"
import type { TelemetryEventInput } from "@podo/contracts"
import {
  CodexRemediationPatchProducer,
  createCoreHandler,
  loadProductionIncidentGraph,
  LocalWorktreeRemediationExecutor,
  type PullRequestDeliveryInput,
} from "@podo/core"
import {
  replayTelemetry,
  type ReplayScheduler,
} from "@podo/plugin-otel-replay"

import {
  CACHE_REGRESSION_PATH,
  CanonicalDiagnosisRuntime,
  CanonicalRemediationRuntime,
  createCanonicalRemediationRepository,
} from "../../demo/canonical-runtime"

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))
const GRAPH_BOOTSTRAP_PATH = join(
  REPO_ROOT,
  "scenarios/cache-growth/graph-bootstrap.json",
)
const TELEMETRY_PATH = join(
  REPO_ROOT,
  "scenarios/cache-growth/fixtures/telemetry.json",
)
const SCRATCH_PARENT = join(REPO_ROOT, ".scratch", "benchmarks")
const EXPECTED_REPOSITORY = "reseaxch/podo"
const OPERATOR_IDENTITY = "benchmark-operator"

export const INVESTIGATION_BUDGET_MS = 60_000
export const FULL_FLOW_BUDGET_MS = 150_000
export const DEFAULT_CORE_FLOW_ITERATIONS = 3

const nonSleepingScheduler: ReplayScheduler = {
  async wait() {
    // Deterministic replay measures Core/client work, not fixture time gaps.
  },
}

export interface CanonicalFlowCounters {
  incidentCount: number
  evidenceCount: number
  diagnosisStatus: "validated"
  remediationStatus: "completed"
  changedFiles: string[]
  regression: {
    prePatch: "failed"
    postPatch: "passed"
  }
  validationStatus: "passed"
  deliveryStatus: "delivered" | "failed"
  pullRequestNumber: number
  deliveryCalls: number
}

interface CanonicalFlowDurations {
  detection: number
  investigation: number
  remediation: number
  delivery: number
  endToEnd: number
}

interface FlowBudgetSamples {
  investigation: number[]
  endToEnd: number[]
}

interface PhaseReport {
  durationMs: number[]
  summary: {
    min: number
    max: number
    mean: number
    variance: number
    standardDeviation: number
  }
}

export interface CanonicalCoreClientFlowReport {
  status: "ok"
  benchmark: "canonical-core-client-flow"
  iterations: number
  counters: CanonicalFlowCounters
  stableCounters: true
  budgets: {
    investigationMs: typeof INVESTIGATION_BUDGET_MS
    fullFlowMs: typeof FULL_FLOW_BUDGET_MS
    met: true
  }
  phases: {
    detection: PhaseReport
    investigation: PhaseReport
    remediation: PhaseReport
    delivery: PhaseReport
    endToEnd: PhaseReport
  }
  externalWrites: 0
}

export class BenchmarkBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BenchmarkBudgetError"
  }
}

export class BenchmarkStabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BenchmarkStabilityError"
  }
}

export function assertFlowBudgets(samples: FlowBudgetSamples): void {
  const investigationMax = maximum(samples.investigation, "investigation")
  const endToEndMax = maximum(samples.endToEnd, "full-flow")
  if (investigationMax >= INVESTIGATION_BUDGET_MS) {
    throw new BenchmarkBudgetError(
      `investigation budget exceeded: ${investigationMax}ms is not under ${INVESTIGATION_BUDGET_MS}ms`,
    )
  }
  if (endToEndMax >= FULL_FLOW_BUDGET_MS) {
    throw new BenchmarkBudgetError(
      `full-flow budget exceeded: ${endToEndMax}ms is not under ${FULL_FLOW_BUDGET_MS}ms`,
    )
  }
}

export function assertStableFlowCounters(
  samples: CanonicalFlowCounters[],
): CanonicalFlowCounters {
  const baseline = samples[0]
  if (!baseline) {
    throw new BenchmarkStabilityError(
      "canonical flow benchmark produced no counters",
    )
  }
  const serialized = JSON.stringify(baseline)
  if (samples.some((sample) => JSON.stringify(sample) !== serialized)) {
    throw new BenchmarkStabilityError(
      "canonical flow counters drifted between iterations",
    )
  }
  return structuredClone(baseline)
}

export async function runCanonicalCoreClientFlowBenchmark(
  iterations = DEFAULT_CORE_FLOW_ITERATIONS,
): Promise<CanonicalCoreClientFlowReport> {
  validateIterations(iterations)
  const rawTelemetry = await loadCanonicalTelemetry()
  const counters: CanonicalFlowCounters[] = []
  const durations: Record<keyof CanonicalFlowDurations, number[]> = {
    detection: [],
    investigation: [],
    remediation: [],
    delivery: [],
    endToEnd: [],
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = await runIteration(structuredClone(rawTelemetry))
    counters.push(sample.counters)
    for (const phase of Object.keys(durations) as Array<
      keyof CanonicalFlowDurations
    >) {
      durations[phase].push(sample.durations[phase])
    }
  }

  const stableCounters = assertStableFlowCounters(counters)
  assertFlowBudgets({
    investigation: durations.investigation,
    endToEnd: durations.endToEnd,
  })

  return {
    status: "ok",
    benchmark: "canonical-core-client-flow",
    iterations,
    counters: stableCounters,
    stableCounters: true,
    budgets: {
      investigationMs: INVESTIGATION_BUDGET_MS,
      fullFlowMs: FULL_FLOW_BUDGET_MS,
      met: true,
    },
    phases: {
      detection: phaseReport(durations.detection),
      investigation: phaseReport(durations.investigation),
      remediation: phaseReport(durations.remediation),
      delivery: phaseReport(durations.delivery),
      endToEnd: phaseReport(durations.endToEnd),
    },
    externalWrites: 0,
  }
}

async function runIteration(
  telemetry: TelemetryEventInput[],
): Promise<{
  counters: CanonicalFlowCounters
  durations: CanonicalFlowDurations
}> {
  const fixture = await createCanonicalRemediationRepository(
    REPO_ROOT,
    SCRATCH_PARENT,
  )
  try {
    const incidentGraph = await loadProductionIncidentGraph({
      PODO_INCIDENT_GRAPH_ENABLED: "true",
      PODO_INCIDENT_GRAPH_BOOTSTRAP_PATH: GRAPH_BOOTSTRAP_PATH,
    })
    if (!incidentGraph) {
      throw new BenchmarkStabilityError(
        "canonical incident graph bootstrap is unavailable",
      )
    }

    const diagnosisRuntime = new CanonicalDiagnosisRuntime()
    const remediationRuntime = new CanonicalRemediationRuntime()
    let deliveryCalls = 0
    const remediationExecutor = new LocalWorktreeRemediationExecutor({
      repositoryRoot: fixture.repositoryRoot,
      trustedBaseRef: "refs/heads/main",
      pullRequestBaseBranch: "main",
      scratchParent: fixture.scratchParent,
      regressionCommand: [process.execPath, "test", CACHE_REGRESSION_PATH],
      validationCommands: [
        [process.execPath, "test", "demo/services/checkout-service"],
      ],
      commandTimeoutMs: 30_000,
      maxOutputBytes: 256 * 1024,
      producer: new CodexRemediationPatchProducer({
        runtime: remediationRuntime,
        turnTimeoutMs: 5_000,
      }),
    })
    const handler = createCoreHandler({
      runtime: diagnosisRuntime,
      remediationExecutor,
      incidentGraph,
      pullRequestDelivery: {
        expectedRepository: EXPECTED_REPOSITORY,
        operatorIdentity: OPERATOR_IDENTITY,
        port: {
          async deliver(input: PullRequestDeliveryInput) {
            deliveryCalls += 1
            return deterministicPullRequest(input)
          },
        },
      },
    })
    const client = createPodoClient({
      baseUrl: "http://podo.benchmark.internal",
      fetch: (input, init) => handler(new Request(input, init)),
    })

    const endToEndStarted = performance.now()

    const detectionStarted = performance.now()
    const replay = await replayTelemetry(telemetry, client, {
      acceleration: 1_000_000,
      batchSize: 50,
      scheduler: nonSleepingScheduler,
    })
    const { incidents } = await client.listIncidents()
    const detection = performance.now() - detectionStarted
    if (
      replay.status !== "completed" ||
      replay.rejected !== 0 ||
      incidents.length !== 1
    ) {
      throw new BenchmarkStabilityError(
        "canonical detection did not produce exactly one accepted incident",
      )
    }
    const incident = incidents[0]!

    const investigationStarted = performance.now()
    await client.updateSettings({ autonomyMode: "recommend" })
    const started = await client.startIncidentInvestigation(incident.id, {
      cwd: fixture.repositoryRoot,
    })
    diagnosisRuntime.completeValidDiagnosis({
      evidenceIds: started.incident.evidence.map(({ id }) => id),
      affectedService: incident.affectedService,
      safeToAttemptFix: true,
    })
    const investigated = (await client.getIncident(incident.id)).incident
    const investigation = performance.now() - investigationStarted
    if (
      investigated.investigation?.status !== "completed" ||
      investigated.diagnosis?.status !== "validated"
    ) {
      throw new BenchmarkStabilityError(
        "canonical investigation did not produce a validated diagnosis",
      )
    }

    const remediationStarted = performance.now()
    await client.updateSettings({ autonomyMode: "act_with_approval" })
    const pendingRemediation = (
      await client.startIncidentRemediation(incident.id)
    ).remediation
    const completedRemediation = (
      await client.approveIncidentRemediation(
        incident.id,
        pendingRemediation.approval.id,
      )
    ).remediation
    const remediation = performance.now() - remediationStarted
    const artifact = completedRemediation.artifact
    if (
      completedRemediation.status !== "completed" ||
      !artifact ||
      artifact.validation.status !== "passed"
    ) {
      throw new BenchmarkStabilityError(
        "canonical remediation did not produce a verified artifact",
      )
    }

    const deliveryStarted = performance.now()
    const pendingDelivery = (
      await client.startIncidentDelivery(incident.id)
    ).delivery
    const completedDelivery = (
      await client.approveIncidentDelivery(
        incident.id,
        pendingDelivery.approval.id,
      )
    ).delivery
    const delivery = performance.now() - deliveryStarted
    const endToEnd = performance.now() - endToEndStarted
    if (
      completedDelivery.status !== "delivered" ||
      !completedDelivery.pullRequest
    ) {
      throw new BenchmarkStabilityError(
        "canonical delivery did not produce a pull request result",
      )
    }

    return {
      counters: {
        incidentCount: incidents.length,
        evidenceCount: incident.evidence.length,
        diagnosisStatus: investigated.diagnosis.status,
        remediationStatus: completedRemediation.status,
        changedFiles: [...artifact.patch.changedFiles],
        regression: {
          prePatch: artifact.regression.prePatch,
          postPatch: artifact.regression.postPatch,
        },
        validationStatus: artifact.validation.status,
        deliveryStatus: completedDelivery.status,
        pullRequestNumber: completedDelivery.pullRequest.number,
        deliveryCalls,
      },
      durations: {
        detection,
        investigation,
        remediation,
        delivery,
        endToEnd,
      },
    }
  } finally {
    await fixture.dispose()
  }
}

async function loadCanonicalTelemetry(): Promise<TelemetryEventInput[]> {
  const value = (await Bun.file(TELEMETRY_PATH).json()) as unknown
  if (!Array.isArray(value)) {
    throw new BenchmarkStabilityError(
      "canonical telemetry fixture must be an array",
    )
  }
  return value as TelemetryEventInput[]
}

function deterministicPullRequest(input: PullRequestDeliveryInput) {
  return {
    provider: "github",
    repository: EXPECTED_REPOSITORY,
    number: 1842,
    url: `https://github.com/${EXPECTED_REPOSITORY}/pull/1842`,
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
  }
}

function phaseReport(durationMs: number[]): PhaseReport {
  return {
    durationMs: [...durationMs],
    summary: summarize(durationMs),
  }
}

function summarize(values: number[]): PhaseReport["summary"] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const standardDeviation = Math.sqrt(variance)
  return { min, max, mean, variance, standardDeviation }
}

function maximum(values: number[], label: string): number {
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new BenchmarkBudgetError(
      `${label} benchmark requires finite non-negative samples`,
    )
  }
  return Math.max(...values)
}

function validateIterations(iterations: number): void {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
    throw new BenchmarkStabilityError(
      "canonical flow iterations must be an integer within [1, 100]",
    )
  }
}
