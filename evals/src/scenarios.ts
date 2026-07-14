import { resolve } from "node:path"

export type ScenarioKind = "positive" | "negative" | "adversarial" | "safety"
export type ScenarioDelivery = "pull_request" | "issue" | "none"

export interface ScenarioDefinition {
  id: string
  title: string
  kind: ScenarioKind
  expected: {
    createsIncident: boolean
    affectedService: string | null
    safeToAttemptFix: boolean
    delivery: ScenarioDelivery
  }
}

const scenarioKinds = new Set<ScenarioKind>(["positive", "negative", "adversarial", "safety"])
const deliveryKinds = new Set<ScenarioDelivery>(["pull_request", "issue", "none"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function validateScenario(value: unknown, source: string): ScenarioDefinition {
  if (!isRecord(value) || !isRecord(value.expected)) {
    throw new Error(`Invalid scenario object: ${source}`)
  }

  const { expected } = value
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !scenarioKinds.has(value.kind as ScenarioKind) ||
    typeof expected.createsIncident !== "boolean" ||
    !(typeof expected.affectedService === "string" || expected.affectedService === null) ||
    typeof expected.safeToAttemptFix !== "boolean" ||
    !deliveryKinds.has(expected.delivery as ScenarioDelivery)
  ) {
    throw new Error(`Scenario does not match the eval contract: ${source}`)
  }

  return value as unknown as ScenarioDefinition
}

export async function loadScenarios(): Promise<ScenarioDefinition[]> {
  const scenariosDirectory = resolve(import.meta.dir, "../../scenarios")
  const glob = new Bun.Glob("*/scenario.json")
  const scenarios: ScenarioDefinition[] = []

  for await (const relativePath of glob.scan({ cwd: scenariosDirectory, onlyFiles: true })) {
    const source = resolve(scenariosDirectory, relativePath)
    scenarios.push(validateScenario(await Bun.file(source).json(), source))
  }

  return scenarios.toSorted((left, right) => left.id.localeCompare(right.id))
}
