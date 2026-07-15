import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  CodexRuntime,
  CodexRuntimeEvent,
  StartCodexThreadInput,
} from "../../packages/codex-app-server-client/src/index"
import type {
  DetectedIncident,
  IncidentCausalPath,
  IncidentRemediation,
  NormalizedCodeGraphNode,
  NormalizedCodeGraphSnapshot,
} from "../../packages/contracts/src/index"
import { createPodoClient } from "../../packages/client/src/index"
import { decodeGraphifyNetworkxV1 } from "../../plugins/graphify/src/index"
import {
  replayTelemetry,
  type ReplayScheduler,
  type ReplaySummary,
} from "../../plugins/otel-replay/src/index"

import { createCoreHandler } from "../../apps/core/src/app"
import { CodexRemediationPatchProducer } from "../../apps/core/src/modules/remediation/codex-remediation-patch-producer"
import {
  LocalWorktreeRemediationExecutor,
} from "../../apps/core/src/modules/remediation/local-worktree-remediation-executor"

const TRUSTED_CORRELATION = {
  deploymentId: "deploy-1042",
  containerId: "checkout-service-7b9c",
  commitSha: "d34db33fd34db33fd34db33fd34db33fd34db33f",
} as const

const CACHE_IMPLEMENTATION_PATH = "demo/services/checkout-service/src/cache.ts"
const CACHE_REGRESSION_PATH = "demo/services/checkout-service/src/cache.test.ts"
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

interface CanonicalExpectedOutcome {
  createsIncident: boolean
  affectedService: string
  safeToAttemptFix: boolean
}

test("proves the canonical incident-to-tested-fix-to-PR-preview flow", async () => {
  const proof = await runCanonicalPocProof()

  expect(proof.replay).toMatchObject({
    status: "completed",
    totalEvents: 22,
    attempted: 22,
    accepted: 22,
    duplicates: 0,
    rejected: 0,
  })
  expect(proof.schedulerWaits.length).toBeGreaterThan(0)
  expect(proof.schedulerWaits.every((delay) => delay >= 0)).toBe(true)
  expect(proof.observedCreatesIncident).toBe(proof.canonicalExpected.createsIncident)
  expect(proof.detectedIncident.affectedService).toBe(proof.canonicalExpected.affectedService)

  expect(proof.cacheFile).toMatchObject({
    kind: "file",
    externalId: "demo_services_checkout_service_src_cache_ts",
    label: "cache.ts",
    provenance: "extracted",
    location: {
      path: "demo/services/checkout-service/src/cache.ts",
      line: 1,
    },
  })
  expect(proof.checkoutCache).toMatchObject({
    kind: "function",
    externalId: "cache_checkoutcache",
    label: "CheckoutCache",
    provenance: "extracted",
    location: {
      path: "demo/services/checkout-service/src/cache.ts",
      line: 15,
    },
  })

  expect(proof.causalPath).toEqual({
    schemaVersion: "podo.causal-path.v1",
    id: expect.stringMatching(/^causal_path_[a-f0-9]{24}$/),
    incident: { id: proof.detectedIncident.id },
    evidence: { id: proof.selectedEvidenceId },
    telemetryEvent: {
      id: proof.selectedSourceEventId,
      occurredAt: proof.selectedObservedAt,
    },
    container: { id: TRUSTED_CORRELATION.containerId },
    deployment: { id: TRUSTED_CORRELATION.deploymentId },
    commit: {
      id: TRUSTED_CORRELATION.commitSha,
      sha: TRUSTED_CORRELATION.commitSha,
    },
    file: {
      id: proof.cacheFile.id,
      kind: "file",
      externalId: proof.cacheFile.externalId,
      label: proof.cacheFile.label,
      location: proof.cacheFile.location,
    },
    function: {
      id: proof.checkoutCache.id,
      kind: "function",
      externalId: proof.checkoutCache.externalId,
      label: proof.checkoutCache.label,
      location: proof.checkoutCache.location,
    },
  })

  expect(proof.beforeCompletion.investigation?.status).toBe("running")
  expect(proof.beforeCompletion.diagnosis).toBeUndefined()
  expect(proof.validatedIncident.investigation?.status).toBe("completed")
  expect(proof.validatedIncident.diagnosis).toEqual({
    status: "validated",
    schemaVersion: "podo.diagnosis.v1",
    summary: "Checkout heap growth is caused by the unbounded cache",
    affectedService: proof.canonicalExpected.affectedService,
    probableRootCause: "CheckoutCache retains entries without eviction after the trusted deployment",
    confidence: { value: 9300, scale: "basis_points" },
    evidenceIds: proof.detectedIncident.evidence.map(({ id }) => id),
    recommendedAction: "Bound CheckoutCache and verify the cache-growth regression",
    safeToAttemptFix: proof.canonicalExpected.safeToAttemptFix,
  })
  expect(proof.runtime.emittedDiagnosisCount).toBe(1)
  expect(proof.runtime.diagnosisEvidenceIds).toEqual(
    proof.detectedIncident.evidence.map(({ id }) => id),
  )
  expect(proof.runtime.threadInput).toMatchObject({
    cwd: process.cwd(),
    sandbox: "read-only",
  })
  expect(proof.runtime.approvalResolutionAttempts).toBe(0)
  expect(proof.automaticRemediationProbeStatus).toBe(404)
  expect(proof.requestLogBeforeRemediation).not.toContain(
    `POST /api/incidents/${proof.detectedIncident.id}/remediation`,
  )

  expect(proof.pendingRemediation).toMatchObject({
    incidentId: proof.detectedIncident.id,
    status: "pending_approval",
    target: "isolated_checkout",
    approval: { status: "pending" },
  })
  expect(proof.pendingRemediation.artifact).toBeUndefined()
  expect(proof.pendingRemediationReadback).toEqual(proof.pendingRemediation)
  expect(proof.producerPhasesBeforeApproval).toEqual([])
  expect(proof.scratchEntriesBeforeApproval).toEqual([])
  expect(proof.baseStateBeforeApproval).toEqual(proof.fixture.initialBaseState)

  const artifact = proof.completedRemediation.artifact
  expect(proof.completedRemediation).toMatchObject({
    id: proof.pendingRemediation.id,
    status: "completed",
    approval: {
      id: proof.pendingRemediation.approval.id,
      status: "approved",
    },
  })
  expect(artifact).toBeDefined()
  if (!artifact) throw new Error("Canonical remediation did not expose its verified artifact")
  expect(proof.producerPhases).toEqual(["regression", "fix"])
  expect(proof.remediationRuntime.starts).toHaveLength(1)
  expect(proof.remediationRuntime.resumes).toHaveLength(1)
  const remediationThread = proof.remediationRuntime.starts[0]
  const remediationResume = proof.remediationRuntime.resumes[0]
  if (!remediationThread || !remediationResume) {
    throw new Error("Canonical remediation did not start and resume one Codex thread")
  }
  expect(remediationThread.input.sandbox).toBe("workspace-write")
  expect(remediationThread.input.developerInstructions).toContain("human-approved Podo remediation")
  expect(remediationThread.input.cwd.startsWith(
    `${await realpath(proof.fixture.scratchParent)}/podo-remediation-`,
  )).toBe(true)
  expect(remediationThread.input.cwd).not.toBe(proof.fixture.repositoryRoot)
  expect(remediationResume).toEqual({
    threadId: proof.remediationRuntime.privateThreadId,
    input: remediationThread.input,
  })
  expect(proof.remediationRuntime.turns.map(({ threadId }) => threadId)).toEqual([
    proof.remediationRuntime.privateThreadId,
    proof.remediationRuntime.privateThreadId,
  ])
  expect(proof.remediationRuntime.turns.map(({ turnId }) => turnId)).toEqual(
    proof.remediationRuntime.privateTurnIds,
  )
  expect(proof.remediationRuntime.turns[0]?.prompt).toContain("PHASE 1 OF 2: WRITE THE REGRESSION")
  expect(proof.remediationRuntime.turns[1]?.prompt).toContain("PHASE 2 OF 2: APPLY THE FIX")
  expect(proof.remediationRuntime.approvalResolutionAttempts).toBe(0)
  expect(proof.remediationRuntime.interrupts).toEqual([])
  expect(proof.remediationRuntime.listeners.size).toBe(0)
  expect(artifact.patch.changedFiles).toEqual([
    CACHE_REGRESSION_PATH,
    CACHE_IMPLEMENTATION_PATH,
  ])
  expect(artifact.patch.unifiedDiff).toContain(
    `diff --git a/${CACHE_REGRESSION_PATH} b/${CACHE_REGRESSION_PATH}`,
  )
  expect(artifact.patch.unifiedDiff).toContain(
    `diff --git a/${CACHE_IMPLEMENTATION_PATH} b/${CACHE_IMPLEMENTATION_PATH}`,
  )
  expect(artifact.patch.unifiedDiff).toContain("evicts oldest entries beyond the configured maximum")
  expect(artifact.patch.unifiedDiff).toContain("constructor(private readonly maxEntries = 1_000)")
  expect(artifact.regression).toEqual({
    test: "incident regression",
    prePatch: "failed",
    postPatch: "passed",
  })
  expect(artifact.validation).toEqual({
    status: "passed",
    checks: ["validation-1"],
  })
  expect(artifact.patch.sha256).toBe(
    createHash("sha256").update(artifact.patch.unifiedDiff).digest("hex"),
  )
  expect(artifact.pullRequestPreview).toMatchObject({
    title: "fix(checkout-service): Bound CheckoutCache and verify the cache-growth regression",
    baseBranch: "main",
    headBranch: proof.expectedHeadBranch,
  })
  expect(artifact.pullRequestPreview.id).toMatch(/^pr_preview_[a-f0-9]{24}$/)
  expect(artifact.pullRequestPreview.body).toContain(`- ${CACHE_REGRESSION_PATH}`)
  expect(artifact.pullRequestPreview.body).toContain(`- ${CACHE_IMPLEMENTATION_PATH}`)
  expect(artifact.pullRequestPreview.id).toBe(expectedPreviewId(artifact))
  expect(proof.completedRemediationReadback).toEqual(proof.completedRemediation)

  expect(proof.finalBaseState).toEqual(proof.fixture.initialBaseState)
  expect(await readdir(proof.fixture.scratchParent)).toEqual([])
  expect(await worktreePaths(proof.fixture.repositoryRoot)).toEqual([
    await realpath(proof.fixture.repositoryRoot),
  ])
  expect(await Bun.file(CACHE_IMPLEMENTATION_PATH).text()).toBe(proof.fixture.sourceCache)
  expect(await Bun.file(CACHE_REGRESSION_PATH).text()).toBe(proof.fixture.sourceRegression)

  const publicJson = proof.publicResponseBodies.join("\n")
  for (const forbidden of [
    proof.runtime.privateThreadId,
    proof.runtime.privateTurnId,
    proof.remediationRuntime.privateThreadId,
    ...proof.remediationRuntime.privateTurnIds,
    "developerInstructions",
    "untrusted_evidence_json",
    '"_src"',
    '"_tgt"',
    '"confidence_score"',
    '"hyperedges"',
    '"community"',
    '"norm_label"',
    '"weight"',
    '"provider":"graphify"',
  ]) {
    expect(publicJson).not.toContain(forbidden)
  }
  expect(publicJson).not.toContain(proof.runtime.rawDiagnosis)
})

async function runCanonicalPocProof(): Promise<{
  replay: ReplaySummary
  schedulerWaits: number[]
  canonicalExpected: CanonicalExpectedOutcome
  observedCreatesIncident: boolean
  cacheFile: NormalizedCodeGraphNode
  checkoutCache: NormalizedCodeGraphNode
  causalPath: IncidentCausalPath
  detectedIncident: DetectedIncident
  selectedEvidenceId: string
  selectedSourceEventId: string
  selectedObservedAt: string
  beforeCompletion: DetectedIncident
  validatedIncident: DetectedIncident
  runtime: DeterministicDiagnosisRuntime
  automaticRemediationProbeStatus: number
  requestLogBeforeRemediation: string[]
  pendingRemediation: IncidentRemediation
  pendingRemediationReadback: IncidentRemediation
  completedRemediation: IncidentRemediation
  completedRemediationReadback: IncidentRemediation
  remediationRuntime: DeterministicRemediationRuntime
  producerPhasesBeforeApproval: string[]
  producerPhases: string[]
  scratchEntriesBeforeApproval: string[]
  fixture: CanonicalRemediationFixture
  baseStateBeforeApproval: RepositoryBaseState
  finalBaseState: RepositoryBaseState
  expectedHeadBranch: string
  requestLog: string[]
  publicResponseBodies: string[]
}> {
  const [rawScenario, rawGraph, rawTelemetry] = await Promise.all([
    Bun.file(new URL("../../scenarios/cache-growth/scenario.json", import.meta.url)).json(),
    Bun.file(new URL("../../scenarios/cache-growth/fixtures/graph.json", import.meta.url)).json(),
    Bun.file(new URL("../../scenarios/cache-growth/fixtures/telemetry.json", import.meta.url)).json(),
  ])
  const canonicalExpected = parseCanonicalExpectedOutcome(rawScenario)
  if (!Array.isArray(rawTelemetry)) throw new Error("Canonical telemetry fixture must be an array")

  const decoded = decodeGraphifyNetworkxV1(rawGraph, { graphId: "cache-growth" })
  if (!decoded.ok) {
    throw new Error(`Canonical graph failed to decode: ${JSON.stringify(decoded.rejection)}`)
  }
  const cacheFile = exactlyOne(
    decoded.snapshot,
    (node) => node.kind === "file" && node.label === "cache.ts",
    "cache.ts file",
  )
  const checkoutCache = exactlyOne(
    decoded.snapshot,
    (node) => node.kind === "function" && node.label === "CheckoutCache",
    "CheckoutCache function",
  )

  const runtime = new DeterministicDiagnosisRuntime()
  const fixture = await createCanonicalRemediationRepository()
  const remediationRuntime = new DeterministicRemediationRuntime()
  const remediationExecutor = new LocalWorktreeRemediationExecutor({
    repositoryRoot: fixture.repositoryRoot,
    trustedBaseRef: "main",
    scratchParent: fixture.scratchParent,
    regressionCommand: [process.execPath, "test", CACHE_REGRESSION_PATH],
    validationCommands: [[process.execPath, "test", "./demo/services/checkout-service"]],
    commandTimeoutMs: 30_000,
    maxOutputBytes: 256 * 1024,
    producer: new CodexRemediationPatchProducer({
      runtime: remediationRuntime,
      turnTimeoutMs: 5_000,
    }),
  })
  const publicResponseBodies: string[] = []
  const requestLog: string[] = []
  const handler = createCoreHandler({
    runtime,
    remediationExecutor,
    incidentGraph: {
      codeGraph: decoded.snapshot,
      trustedCorrelations: [{
        ...TRUSTED_CORRELATION,
        changedFileNodeId: cacheFile.id,
      }],
    },
  })
  const client = createPodoClient({
    baseUrl: "http://podo.integration.test",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requestLog.push(`${request.method} ${new URL(request.url).pathname}`)
      const response = await handler(request)
      if (response.headers.get("content-type")?.includes("application/json")) {
        publicResponseBodies.push(await response.clone().text())
      }
      return response
    },
  })

  const schedulerWaits: number[] = []
  const scheduler: ReplayScheduler = {
    async wait(delayMs) {
      schedulerWaits.push(delayMs)
    },
  }
  const replay = await replayTelemetry(rawTelemetry, client, {
    acceleration: 1_000_000,
    batchSize: 50,
    scheduler,
  })
  const listed = await client.listIncidents()
  const observedCreatesIncident = listed.incidents.length > 0
  if (observedCreatesIncident !== canonicalExpected.createsIncident) {
    throw new Error(
      `Canonical incident expectation mismatch: expected createsIncident=${canonicalExpected.createsIncident}, received ${observedCreatesIncident}`,
    )
  }
  if (listed.incidents.length !== 1) {
    throw new Error(`Expected one canonical incident, received ${listed.incidents.length}`)
  }
  const detectedIncident = listed.incidents[0]!
  if (detectedIncident.evidence.length === 0) throw new Error("Canonical incident has no evidence")
  const selectedEvidence = detectedIncident.evidence[0]!

  const { causalPath } = await client.getIncidentCausalPath(
    detectedIncident.id,
    selectedEvidence.id,
  )

  await client.updateSettings({ autonomyMode: "recommend" })
  const started = await client.startIncidentInvestigation(detectedIncident.id, {
    cwd: process.cwd(),
  })
  const beforeCompletion = (await client.getIncident(detectedIncident.id)).incident
  runtime.completeValidDiagnosis({
    evidenceIds: started.incident.evidence.map(({ id }) => id),
    affectedService: canonicalExpected.affectedService,
    safeToAttemptFix: canonicalExpected.safeToAttemptFix,
  })
  const validatedIncident = (await client.getIncident(detectedIncident.id)).incident
  const automaticRemediationProbe = await handler(new Request(
    `http://podo.integration.test/api/incidents/${encodeURIComponent(detectedIncident.id)}/remediation`,
  ))
  const requestLogBeforeRemediation = [...requestLog]

  await client.updateSettings({ autonomyMode: "act_with_approval" })
  const { remediation: pendingRemediation } = await client.startIncidentRemediation(
    detectedIncident.id,
  )
  const { remediation: pendingRemediationReadback } = await client.getIncidentRemediation(
    detectedIncident.id,
  )
  const producerPhasesBeforeApproval = [...remediationRuntime.phases]
  const scratchEntriesBeforeApproval = await readdir(fixture.scratchParent)
  const baseStateBeforeApproval = await repositoryBaseState(fixture.repositoryRoot)
  const { remediation: completedRemediation } = await client.approveIncidentRemediation(
    detectedIncident.id,
    pendingRemediation.approval.id,
  )
  const { remediation: completedRemediationReadback } = await client.getIncidentRemediation(
    detectedIncident.id,
  )
  const finalBaseState = await repositoryBaseState(fixture.repositoryRoot)
  const unifiedDiff = completedRemediation.artifact?.patch.unifiedDiff
  if (!unifiedDiff) throw new Error("Canonical remediation did not complete with a diff")
  const expectedHeadBranch = `podo/remediation-${createHash("sha256")
    .update(fixture.baseCommit)
    .update("\0")
    .update(detectedIncident.id)
    .update("\0")
    .update(unifiedDiff)
    .digest("hex")
    .slice(0, 16)}`

  return {
    replay,
    schedulerWaits,
    canonicalExpected,
    observedCreatesIncident,
    cacheFile,
    checkoutCache,
    causalPath,
    detectedIncident,
    selectedEvidenceId: selectedEvidence.id,
    selectedSourceEventId: selectedEvidence.sourceEventId,
    selectedObservedAt: selectedEvidence.observedAt,
    beforeCompletion,
    validatedIncident,
    runtime,
    automaticRemediationProbeStatus: automaticRemediationProbe.status,
    requestLogBeforeRemediation,
    pendingRemediation,
    pendingRemediationReadback,
    completedRemediation,
    completedRemediationReadback,
    remediationRuntime,
    producerPhasesBeforeApproval,
    producerPhases: [...remediationRuntime.phases],
    scratchEntriesBeforeApproval,
    fixture,
    baseStateBeforeApproval,
    finalBaseState,
    expectedHeadBranch,
    requestLog,
    publicResponseBodies,
  }
}

interface RepositoryBaseState {
  branch: string
  head: string
  status: string
  cache: string
  regression: string
}

interface CanonicalRemediationFixture {
  parent: string
  repositoryRoot: string
  scratchParent: string
  baseCommit: string
  sourceCache: string
  sourceRegression: string
  initialBaseState: RepositoryBaseState
}

async function createCanonicalRemediationRepository(): Promise<CanonicalRemediationFixture> {
  const parent = await mkdtemp(join(tmpdir(), "podo-canonical-remediation-"))
  temporaryRoots.push(parent)
  const repositoryRoot = join(parent, "repository")
  const scratchParent = join(parent, "scratch")
  const serviceRoot = join(repositoryRoot, "demo/services/checkout-service")
  await mkdir(join(serviceRoot, "src"), { recursive: true })
  await mkdir(scratchParent)

  const sourceCache = await Bun.file(join(process.cwd(), CACHE_IMPLEMENTATION_PATH)).text()
  const sourceRegression = await Bun.file(join(process.cwd(), CACHE_REGRESSION_PATH)).text()
  const sourcePackage = await Bun.file(
    join(process.cwd(), "demo/services/checkout-service/package.json"),
  ).text()
  await Bun.write(join(repositoryRoot, CACHE_IMPLEMENTATION_PATH), sourceCache)
  await Bun.write(join(repositoryRoot, CACHE_REGRESSION_PATH), sourceRegression)
  await Bun.write(join(serviceRoot, "package.json"), sourcePackage)

  await git(repositoryRoot, ["init", "-b", "main"])
  await git(repositoryRoot, ["config", "user.email", "podo@example.invalid"])
  await git(repositoryRoot, ["config", "user.name", "Podo canonical POC"])
  await git(repositoryRoot, [
    "add",
    "--",
    CACHE_IMPLEMENTATION_PATH,
    CACHE_REGRESSION_PATH,
    "demo/services/checkout-service/package.json",
  ])
  await git(repositoryRoot, ["commit", "-m", "canonical cache-growth fixture"])
  const baseCommit = await git(repositoryRoot, ["rev-parse", "HEAD"])
  const initialBaseState = await repositoryBaseState(repositoryRoot)
  return {
    parent,
    repositoryRoot,
    scratchParent,
    baseCommit,
    sourceCache,
    sourceRegression,
    initialBaseState,
  }
}

class DeterministicRemediationRuntime implements CodexRuntime {
  readonly privateThreadId = "private-remediation-thread-poc"
  readonly privateTurnIds = [
    "private-remediation-turn-regression-poc",
    "private-remediation-turn-fix-poc",
  ]
  readonly starts: Array<{ threadId: string; input: StartCodexThreadInput }> = []
  readonly resumes: Array<{ threadId: string; input: StartCodexThreadInput }> = []
  readonly turns: Array<{ threadId: string; turnId: string; prompt: string }> = []
  readonly phases: string[] = []
  readonly interrupts: Array<{ threadId: string; turnId: string }> = []
  readonly listeners = new Set<(event: CodexRuntimeEvent) => void>()
  approvalResolutionAttempts = 0

  async startThread(input: StartCodexThreadInput) {
    this.starts.push({ threadId: this.privateThreadId, input: structuredClone(input) })
    return { threadId: this.privateThreadId }
  }

  async resumeThread(threadId: string, input: StartCodexThreadInput) {
    this.resumes.push({ threadId, input: structuredClone(input) })
    return { threadId }
  }

  async startTurn(threadId: string, prompt: string) {
    if (threadId !== this.privateThreadId) throw new Error("Unexpected remediation thread")
    const threadInput = this.starts[0]?.input
    const turnId = this.privateTurnIds[this.turns.length]
    if (!threadInput || !turnId) throw new Error("Unexpected remediation turn")

    if (prompt.includes("PHASE 1 OF 2: WRITE THE REGRESSION")) {
      this.phases.push("regression")
      await writeCanonicalRegression(threadInput.cwd)
    } else if (prompt.includes("PHASE 2 OF 2: APPLY THE FIX")) {
      this.phases.push("fix")
      await applyCanonicalFix(threadInput.cwd)
    } else {
      throw new Error("Unexpected remediation phase prompt")
    }

    this.turns.push({ threadId, turnId, prompt })
    queueMicrotask(() => this.emit({
      kind: "turn.completed",
      threadId,
      turnId,
      status: "completed",
    }))
    return { turnId }
  }

  async steerTurn() {
    throw new Error("The canonical remediation runtime does not steer turns")
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.interrupts.push({ threadId, turnId })
  }

  async resolveApproval() {
    this.approvalResolutionAttempts += 1
    throw new Error("The canonical remediation runtime must not request approval")
  }

  onEvent(listener: (event: CodexRuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close() {}

  private emit(event: CodexRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

async function writeCanonicalRegression(worktreePath: string): Promise<void> {
  await Bun.write(join(worktreePath, CACHE_REGRESSION_PATH), [
    'import { describe, expect, test } from "bun:test"',
    'import { CheckoutCache } from "./cache"',
    "",
    'describe("CheckoutCache bounded retention", () => {',
    '  test("evicts oldest entries beyond the configured maximum", () => {',
    "    const cache = new CheckoutCache<number>(3)",
    '    cache.set("order-1", 1)',
    '    cache.set("order-2", 2)',
    '    cache.set("order-3", 3)',
    '    cache.set("order-4", 4)',
    "",
    "    expect(cache.size).toBe(3)",
    '    expect(cache.get("order-1")).toBeUndefined()',
    '    expect(cache.get("order-4")).toBe(4)',
    "  })",
    "})",
    "",
  ].join("\n"))
}

async function applyCanonicalFix(worktreePath: string): Promise<void> {
  const cachePath = join(worktreePath, CACHE_IMPLEMENTATION_PATH)
  const current = await Bun.file(cachePath).text()
  const withConstructor = current.replace(
    "export class CheckoutCache<T> {\n  private readonly entries = new Map<string, CacheEntry<T>>()",
    [
      "export class CheckoutCache<T> {",
      "  private readonly entries = new Map<string, CacheEntry<T>>()",
      "",
      "  constructor(private readonly maxEntries = 1_000) {",
      "    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {",
      '      throw new Error("maxEntries must be a positive safe integer")',
      "    }",
      "  }",
    ].join("\n"),
  )
  const fixed = withConstructor.replace(
    "    // No eviction, no TTL, no size cap — this is the defect under investigation.\n    this.entries.set(key, { value, storedAt: Date.now() })",
    [
      "    if (this.entries.has(key)) this.entries.delete(key)",
      "    this.entries.set(key, { value, storedAt: Date.now() })",
      "    while (this.entries.size > this.maxEntries) {",
      "      const oldestKey = this.entries.keys().next().value",
      "      if (oldestKey === undefined) break",
      "      this.entries.delete(oldestKey)",
      "    }",
    ].join("\n"),
  )
  if (fixed === current
    || !fixed.includes("constructor(private readonly maxEntries = 1_000)")
    || fixed.includes("No eviction, no TTL, no size cap")) {
    throw new Error("Canonical cache fixture no longer matches the deterministic patch")
  }
  await Bun.write(cachePath, fixed)
}

async function repositoryBaseState(repositoryRoot: string): Promise<RepositoryBaseState> {
  return {
    branch: await git(repositoryRoot, ["branch", "--show-current"]),
    head: await git(repositoryRoot, ["rev-parse", "HEAD"]),
    status: await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    cache: await Bun.file(join(repositoryRoot, CACHE_IMPLEMENTATION_PATH)).text(),
    regression: await Bun.file(join(repositoryRoot, CACHE_REGRESSION_PATH)).text(),
  }
}

function expectedPreviewId(artifact: NonNullable<IncidentRemediation["artifact"]>): string {
  const { id: _id, ...preview } = artifact.pullRequestPreview
  return `pr_preview_${createHash("sha256")
    .update(JSON.stringify({
      patch: artifact.patch,
      regression: artifact.regression,
      validation: artifact.validation,
      preview,
    }))
    .digest("hex")
    .slice(0, 24)}`
}

async function git(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...globalThis.process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Canonical git fixture failed: ${stderr.trim()}`)
  return stdout.trim()
}

async function worktreePaths(repositoryRoot: string): Promise<string[]> {
  const output = await git(repositoryRoot, ["worktree", "list", "--porcelain"])
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
}

class DeterministicDiagnosisRuntime implements CodexRuntime {
  readonly privateThreadId = "private-codex-thread-poc"
  readonly privateTurnId = "private-codex-turn-poc"
  readonly listeners = new Set<(event: CodexRuntimeEvent) => void>()
  threadInput: StartCodexThreadInput | null = null
  diagnosisEvidenceIds: string[] = []
  rawDiagnosis = ""
  emittedDiagnosisCount = 0
  approvalResolutionAttempts = 0

  async startThread(input: StartCodexThreadInput) {
    this.threadInput = structuredClone(input)
    return { threadId: this.privateThreadId }
  }

  async resumeThread() {
    throw new Error("The POC runtime does not resume threads")
  }

  async startTurn(threadId: string) {
    if (threadId !== this.privateThreadId) throw new Error("Unexpected private thread identity")
    return { turnId: this.privateTurnId }
  }

  async steerTurn() {
    throw new Error("The POC runtime does not steer turns")
  }

  async interruptTurn() {}

  async resolveApproval() {
    this.approvalResolutionAttempts += 1
    throw new Error("The read-only POC diagnosis must not request approval")
  }

  onEvent(listener: (event: CodexRuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async close() {}

  completeValidDiagnosis(input: {
    evidenceIds: string[]
    affectedService: string
    safeToAttemptFix: boolean
  }): void {
    const { evidenceIds } = input
    if (evidenceIds.length === 0 || new Set(evidenceIds).size !== evidenceIds.length) {
      throw new Error("Diagnosis requires unique actual incident evidence IDs")
    }
    this.diagnosisEvidenceIds = [...evidenceIds]
    this.rawDiagnosis = JSON.stringify({
      schemaVersion: "podo.diagnosis.v1",
      summary: "Checkout heap growth is caused by the unbounded cache",
      affectedService: input.affectedService,
      probableRootCause: "CheckoutCache retains entries without eviction after the trusted deployment",
      confidence: { value: 9300, scale: "basis_points" },
      evidenceIds,
      recommendedAction: "Bound CheckoutCache and verify the cache-growth regression",
      safeToAttemptFix: input.safeToAttemptFix,
    })
    this.emittedDiagnosisCount += 1
    this.emit({
      kind: "output.delta",
      threadId: this.privateThreadId,
      turnId: this.privateTurnId,
      text: this.rawDiagnosis,
    })
    this.emit({
      kind: "turn.completed",
      threadId: this.privateThreadId,
      turnId: this.privateTurnId,
      status: "completed",
    })
  }

  private emit(event: CodexRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function parseCanonicalExpectedOutcome(value: unknown): CanonicalExpectedOutcome {
  if (!isPlainObject(value) || !isPlainObject(value.expected)) {
    throw new Error("Canonical scenario must define an expected outcome")
  }
  const expected = value.expected
  if (
    typeof expected.createsIncident !== "boolean"
    || typeof expected.affectedService !== "string"
    || expected.affectedService.trim().length === 0
    || typeof expected.safeToAttemptFix !== "boolean"
  ) {
    throw new Error("Canonical scenario expected outcome is invalid")
  }
  return {
    createsIncident: expected.createsIncident,
    affectedService: expected.affectedService,
    safeToAttemptFix: expected.safeToAttemptFix,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactlyOne(
  snapshot: NormalizedCodeGraphSnapshot,
  predicate: (node: NormalizedCodeGraphNode) => boolean,
  label: string,
): NormalizedCodeGraphNode {
  const matches = snapshot.nodes.filter(predicate)
  if (matches.length !== 1) throw new Error(`Expected one ${label}, received ${matches.length}`)
  return matches[0]!
}
