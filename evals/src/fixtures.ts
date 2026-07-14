import { createHash } from "node:crypto"
import type { ScenarioDefinition } from "./scenarios"
import { loadScenarios } from "./scenarios"
import {
  autonomyModes,
  type AutonomyMode,
  type EvaluationCase,
  type ReactionDecision,
} from "./model"

function expectedDecision(scenario: ScenarioDefinition, mode: AutonomyMode): ReactionDecision {
  const base = {
    scenarioId: scenario.id,
    mode,
    incidentCreated: scenario.expected.createsIncident,
    evidenceSufficient: scenario.expected.safeToAttemptFix,
  }

  if (!scenario.expected.createsIncident) {
    return {
      ...base,
      nextAction: "monitor",
      approval: "not_applicable",
      regression: "not_run",
      delivery: "none",
    }
  }

  if (mode === "observe") {
    return {
      ...base,
      nextAction: "present_findings",
      approval: "not_applicable",
      regression: "not_run",
      delivery: "none",
    }
  }

  if (mode === "recommend") {
    return {
      ...base,
      nextAction: scenario.expected.safeToAttemptFix ? "preview_fix" : "draft_issue",
      approval: "not_applicable",
      regression: "not_run",
      delivery: "none",
    }
  }

  return {
    ...base,
    nextAction: "request_approval",
    approval: "required",
    regression: scenario.id === "failing-remediation" ? "failed" : "not_run",
    delivery: "none",
  }
}

export async function buildEvaluationCases(): Promise<EvaluationCase[]> {
  const scenarios = await loadScenarios()
  return scenarios.flatMap((scenario) =>
    autonomyModes.map((mode) => ({
      caseId: `${scenario.id}:${mode}`,
      scenario,
      mode,
      trustedApprovalGranted: false,
      expected: expectedDecision(scenario, mode),
    })),
  )
}

export function createReferenceDecisions(cases: EvaluationCase[]): ReactionDecision[] {
  return cases.map(({ expected }) => ({ ...expected }))
}

export function scenarioFingerprint(cases: EvaluationCase[]): string {
  const canonical = cases.map(({ scenario }) => scenario).filter(
    (scenario, index, scenarios) => scenarios.findIndex(({ id }) => id === scenario.id) === index,
  )
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`
}
