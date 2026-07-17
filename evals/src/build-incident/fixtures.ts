// UC-13 canonical fixture loading and expected-binding derivation.
//
// Reads ONLY the committed canonical fixtures from
// scenarios/github-actions-failure/fixtures/ (never copied or mutated) and
// derives the expected exact bindings plus a deterministic corpus fingerprint.

import { createHash } from "node:crypto"
import { SUITE, type BuildIncidentCase } from "./model"

const fixtureRoot = new URL(
  "../../../scenarios/github-actions-failure/fixtures/",
  import.meta.url,
)

// All five UC-13 fixtures, sorted, that define the scenario corpus version.
export const fixtureNames = [
  "failure-jobs.json",
  "failure-run.json",
  "failure-webhook.json",
  "remediation-success-run.json",
  "retry-success-run.json",
] as const

interface RepositoryPayload {
  name: string
  owner: { login: string }
}

interface RunPayload {
  id: number
  workflow_id: number
  run_attempt: number
  head_sha: string
  head_branch: string | null
  repository: RepositoryPayload
}

interface StepPayload {
  number: number
  name: string
  conclusion: string
}

interface JobPayload {
  id: number
  name: string
  conclusion: string
  steps: StepPayload[]
}

interface JobsPayload {
  jobs: JobPayload[]
}

export interface LoadedFixtures {
  webhookBody: string
  failureRun: RunPayload
  failureJobs: JobsPayload
  retrySuccessRun: RunPayload
  remediationSuccessRun: RunPayload
  fixtureFingerprint: string
  case: BuildIncidentCase
}

async function readText(name: string): Promise<string> {
  return Bun.file(new URL(name, fixtureRoot)).text()
}

async function readJson<T>(name: string): Promise<T> {
  return Bun.file(new URL(name, fixtureRoot)).json() as Promise<T>
}

function lfNormalize(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

// Deterministic corpus version: sha256 over sorted names + LF-normalized raw
// bytes, stable across checkout line-endings.
export async function computeFixtureFingerprint(): Promise<string> {
  const entries: Array<[string, string]> = []
  for (const name of [...fixtureNames].sort()) {
    entries.push([name, lfNormalize(await readText(name))])
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`
}

export async function loadFixtures(): Promise<LoadedFixtures> {
  const [webhookBody, failureRun, failureJobs, retrySuccessRun, remediationSuccessRun, fixtureFingerprint] =
    await Promise.all([
      readText("failure-webhook.json"),
      readJson<RunPayload>("failure-run.json"),
      readJson<JobsPayload>("failure-jobs.json"),
      readJson<RunPayload>("retry-success-run.json"),
      readJson<RunPayload>("remediation-success-run.json"),
      computeFixtureFingerprint(),
    ])

  const failedJob = failureJobs.jobs.find((job) => job.conclusion === "failure")
  const failedStep = failedJob?.steps.find((step) => step.conclusion === "failure")
  if (!failedJob || !failedStep) {
    throw new Error("uc13 fixtures missing a failed job or failed step")
  }

  const repository = {
    owner: failureRun.repository.owner.login,
    name: failureRun.repository.name,
  }

  const evaluationCase: BuildIncidentCase = {
    suite: SUITE,
    repository,
    expected: {
      evidenceSourceTypes: [
        "github_actions_workflow_run",
        "github_actions_job",
        "github_actions_step",
      ],
      sourceRun: { id: failureRun.id, attempt: failureRun.run_attempt, headSha: failureRun.head_sha },
      failedJob: { id: failedJob.id, name: failedJob.name, conclusion: "failure" },
      failedStep: { number: failedStep.number, name: failedStep.name, conclusion: "failure" },
      retry: {
        runId: retrySuccessRun.id,
        nextAttempt: retrySuccessRun.run_attempt,
        headSha: retrySuccessRun.head_sha,
      },
      remediation: { head: remediationSuccessRun.head_sha, runId: remediationSuccessRun.id },
    },
  }

  return {
    webhookBody,
    failureRun,
    failureJobs,
    retrySuccessRun,
    remediationSuccessRun,
    fixtureFingerprint,
    case: evaluationCase,
  }
}
