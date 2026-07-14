import { buildEvaluationCases, createReferenceDecisions } from "./fixtures"
import type { CandidateMetadata, DecisionDocument } from "./model"
import { loadDecisionDocument } from "./runner"
import { scoreEvaluation } from "./scorer"

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

async function main(): Promise<void> {
  try {
    const cases = await buildEvaluationCases()
    const path = inputPath(Bun.argv.slice(2))
    const document: DecisionDocument = path
      ? await loadDecisionDocument(path)
      : {
          schemaVersion: 1,
          metadata: referenceMetadata,
          decisions: createReferenceDecisions(cases),
        }
    const report = scoreEvaluation(cases, document.decisions, document.metadata)
    console.log(JSON.stringify(report, null, 2))
    if (report.status !== "passed") process.exitCode = 1
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          suite: "rootline-reaction-matrix",
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
