// UC-13 Build Incident evaluation CLI.
//
// Runs the deterministic suite over the canonical fixtures and prints a
// machine-readable JSON report. Exits nonzero when the suite does not pass.

import { evaluateBuildIncident } from "./scorer"
import { SUITE } from "./model"

async function main(): Promise<void> {
  try {
    const report = await evaluateBuildIncident()
    console.log(JSON.stringify(report, null, 2))
    if (report.status !== "passed") process.exitCode = 1
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          suite: SUITE,
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
