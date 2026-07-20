import { fileURLToPath } from "node:url"

import { buildEvaluationCases, createReferenceDecisions } from "./fixtures"
import type { CandidateMetadata, DecisionDocument } from "./model"
import {
  aggregateBaseline,
  referenceImplementationFingerprint,
  verifyAggregateBaseline,
} from "./baseline"
import { loadDecisionDocument } from "./runner"
import { scoreEvaluation } from "./scorer"

const defaultBaselinePath = new URL(
  "../baselines/reaction-matrix.reference-v2.json",
  import.meta.url,
)

const referenceMetadata: CandidateMetadata = {
  model: null,
  promptVersion: "reference-adapter-v2",
  codexVersion: null,
  protocolHash: null,
  durationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
}

function inputPath(args: string[]): string | undefined {
  const inputIndex = args.indexOf("--input")
  if (inputIndex === -1) return undefined
  const path = args[inputIndex + 1]
  if (!path) throw new Error("--input requires a JSON file path")
  return path
}

function baselinePath(args: string[]): string {
  const baselineIndex = args.indexOf("--baseline")
  if (baselineIndex === -1) return fileURLToPath(defaultBaselinePath)
  const path = args[baselineIndex + 1]
  if (!path) throw new Error("--baseline requires a JSON file path")
  return path
}

async function main(): Promise<void> {
  try {
    const cases = await buildEvaluationCases()
    const args = Bun.argv.slice(2)
    const path = inputPath(args)
    const printBaseline = args.includes("--print-baseline")
    if (path && printBaseline) throw new Error("--print-baseline cannot be combined with --input")
    const document: DecisionDocument = path
      ? await loadDecisionDocument(path)
      : {
          schemaVersion: 1,
          metadata: referenceMetadata,
          decisions: createReferenceDecisions(cases),
        }
    const report = scoreEvaluation(cases, document.decisions, document.metadata)
    if (printBaseline) {
      console.log(JSON.stringify(
        aggregateBaseline(report, await referenceImplementationFingerprint()),
        null,
        2,
      ))
    } else if (!path) {
      await verifyAggregateBaseline(
        report,
        baselinePath(args),
        await referenceImplementationFingerprint(),
      )
      console.log(JSON.stringify({
        ...report,
        baseline: {
          status: "matched",
          artifactKind: "reviewed_aggregate_baseline",
          evaluationKind: "deterministic_reference",
          modelBacked: false,
        },
      }, null, 2))
    } else {
      console.log(JSON.stringify(report, null, 2))
    }
    if (report.status !== "passed") process.exitCode = 1
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          suite: "podo-reaction-matrix",
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
  }
}

if (import.meta.main) await main()
