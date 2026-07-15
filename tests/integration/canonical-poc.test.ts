import { expect, test } from "bun:test"
import type {
  CodexRuntime,
  CodexRuntimeEvent,
  StartCodexThreadInput,
} from "../../packages/codex-app-server-client/src/index"
import type {
  DetectedIncident,
  IncidentCausalPath,
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

const TRUSTED_CORRELATION = {
  deploymentId: "deploy-1042",
  containerId: "checkout-service-7b9c",
  commitSha: "d34db33fd34db33fd34db33fd34db33fd34db33f",
} as const

interface CanonicalExpectedOutcome {
  createsIncident: boolean
  affectedService: string
  safeToAttemptFix: boolean
}

test("proves the canonical incident-to-causal-path-to-diagnosis flow", async () => {
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
  expect(proof.requestLog).not.toContain(
    `POST /api/incidents/${proof.detectedIncident.id}/remediation`,
  )

  const publicJson = proof.publicResponseBodies.join("\n")
  for (const forbidden of [
    proof.runtime.privateThreadId,
    proof.runtime.privateTurnId,
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
  const publicResponseBodies: string[] = []
  const requestLog: string[] = []
  const handler = createCoreHandler({
    runtime,
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
    requestLog,
    publicResponseBodies,
  }
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
