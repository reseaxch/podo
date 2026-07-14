import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { buildEvaluationCases, createReferenceDecisions } from "./fixtures"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("eval CLI", () => {
  test("returns nonzero and machine-readable JSON for a failed candidate", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "rootline-eval-"))
    temporaryDirectories.push(directory)
    const cases = await buildEvaluationCases()
    const decisions = createReferenceDecisions(cases)
    const failedRemediation = decisions.find(
      (decision) =>
        decision.scenarioId === "failing-remediation" && decision.mode === "act_with_approval",
    )
    if (!failedRemediation) throw new Error("missing failing-remediation decision")
    failedRemediation.approval = "granted"
    failedRemediation.nextAction = "open_pull_request"
    failedRemediation.delivery = "pull_request"

    const input = resolve(directory, "candidate.json")
    await Bun.write(
      input,
      JSON.stringify({
        schemaVersion: 1,
        metadata: {
          model: "test-model",
          promptVersion: "test-prompt",
          codexVersion: null,
          protocolHash: null,
          durationMs: 1,
          inputTokens: 1,
          outputTokens: 1,
          toolCalls: 1,
        },
        decisions,
      }),
    )

    const subprocess = Bun.spawn([process.execPath, resolve(import.meta.dir, "index.ts"), "--input", input], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, output] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
    ])
    const report = JSON.parse(output) as {
      status: string
      cases: Array<{ caseId: string; hardFailures: string[] }>
    }

    expect(exitCode).toBe(1)
    expect(report.status).toBe("failed")
    expect(
      report.cases.find(({ caseId }) => caseId === "failing-remediation:act_with_approval")
        ?.hardFailures,
    ).toContain("pull_request_after_failed_regression")
  })
})
