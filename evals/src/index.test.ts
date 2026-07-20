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
  test("verifies the reviewed aggregate baseline without presenting the reference adapter as a model", async () => {
    const subprocess = Bun.spawn([process.execPath, resolve(import.meta.dir, "index.ts")], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, output] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
    ])
    const report = JSON.parse(output) as {
      status: string
      metadata: { model: string | null; promptVersion: string | null }
      baseline: {
        status: string
        artifactKind: string
        evaluationKind: string
        modelBacked: boolean
      }
    }

    expect(exitCode).toBe(0)
    expect(report.status).toBe("passed")
    expect(report.metadata).toMatchObject({
      model: null,
      promptVersion: "reference-adapter-v2",
    })
    expect(report.baseline).toEqual({
      status: "matched",
      artifactKind: "reviewed_aggregate_baseline",
      evaluationKind: "deterministic_reference",
      modelBacked: false,
    })
  })

  test("reproduces the committed aggregate artifact through the public eval command", async () => {
    const subprocess = Bun.spawn([
      process.execPath,
      resolve(import.meta.dir, "index.ts"),
      "--print-baseline",
    ], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [exitCode, outputText, committedText] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
      Bun.file(resolve(import.meta.dir, "../baselines/reaction-matrix.reference-v2.json")).text(),
    ])
    const output = JSON.parse(outputText) as Record<string, unknown>

    expect(exitCode).toBe(0)
    expect(outputText.trimEnd()).toBe(committedText.trimEnd())
    expect(output).toMatchObject({
      artifactKind: "reviewed_aggregate_baseline",
      evaluationKind: "deterministic_reference",
      modelBacked: false,
      implementationFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
  })

  test("fails closed when the reviewed aggregate baseline drifts or is malformed", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "podo-eval-"))
    temporaryDirectories.push(directory)
    const drifted = resolve(directory, "drifted.json")
    const malformed = resolve(directory, "malformed.json")
    const reviewed = await Bun.file(
      resolve(import.meta.dir, "../baselines/reaction-matrix.reference-v2.json"),
    ).json() as Record<string, unknown>
    await Bun.write(drifted, JSON.stringify({
      ...reviewed,
      implementationFingerprint: `sha256:${"b".repeat(64)}`,
    }))
    await Bun.write(malformed, JSON.stringify({ schemaVersion: 1, aggregate: {} }))

    for (const [path, expectedError] of [
      [drifted, "eval_baseline_drift"],
      [malformed, "invalid_eval_baseline"],
    ] as const) {
      const subprocess = Bun.spawn([
        process.execPath,
        resolve(import.meta.dir, "index.ts"),
        "--baseline",
        path,
      ], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exitCode, output] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
      ])
      const report = JSON.parse(output) as { status: string; error: string }
      expect(exitCode).toBe(1)
      expect(report).toMatchObject({ status: "error", error: expectedError })
    }
  })

  test("returns nonzero and machine-readable JSON for a failed candidate", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "podo-eval-"))
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
