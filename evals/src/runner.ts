import {
  approvalStates,
  autonomyModes,
  nextActions,
  regressionStates,
  type CandidateMetadata,
  type DecisionDocument,
  type ReactionDecision,
} from "./model"
import type { ScenarioDelivery } from "./scenarios"

const deliveries = ["none", "issue", "pull_request"] as const satisfies readonly ScenarioDelivery[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null
}

function nullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)
}

function parseMetadata(value: unknown): CandidateMetadata {
  if (!isRecord(value)) throw new Error("metadata must be an object")
  const fields = ["model", "promptVersion", "codexVersion", "protocolHash"] as const
  const counters = ["durationMs", "inputTokens", "outputTokens", "toolCalls"] as const
  if (!fields.every((field) => nullableString(value[field]))) {
    throw new Error("metadata string fields must be strings or null")
  }
  if (!counters.every((field) => nullableNonNegativeNumber(value[field]))) {
    throw new Error("metadata counters must be non-negative numbers or null")
  }
  return value as unknown as CandidateMetadata
}

function parseDecision(value: unknown, index: number): ReactionDecision {
  if (
    !isRecord(value) ||
    typeof value.scenarioId !== "string" ||
    !autonomyModes.includes(value.mode as (typeof autonomyModes)[number]) ||
    typeof value.incidentCreated !== "boolean" ||
    typeof value.evidenceSufficient !== "boolean" ||
    !nextActions.includes(value.nextAction as (typeof nextActions)[number]) ||
    !approvalStates.includes(value.approval as (typeof approvalStates)[number]) ||
    !regressionStates.includes(value.regression as (typeof regressionStates)[number]) ||
    !deliveries.includes(value.delivery as (typeof deliveries)[number])
  ) {
    throw new Error(`decisions[${index}] does not match reaction-decision-v1`)
  }
  return value as unknown as ReactionDecision
}

export function parseDecisionDocument(value: unknown): DecisionDocument {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.decisions)) {
    throw new Error("candidate document does not match reaction-decision-document-v1")
  }
  return {
    schemaVersion: 1,
    metadata: parseMetadata(value.metadata),
    decisions: value.decisions.map(parseDecision),
  }
}

export async function loadDecisionDocument(path: string): Promise<DecisionDocument> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`candidate file does not exist: ${path}`)
  return parseDecisionDocument(await file.json())
}
