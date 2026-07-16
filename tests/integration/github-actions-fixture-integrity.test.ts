import { describe, expect, test } from "bun:test"

const fixtureRoot = new URL("../../scenarios/github-actions-failure/fixtures/", import.meta.url)

async function read(name: string): Promise<Record<string, any>> {
  return Bun.file(new URL(name, fixtureRoot)).json()
}

describe("GitHub Actions failure scenario fixtures", () => {
  test("binds a failed run, its jobs, and a successful retry to one exact commit", async () => {
    const [webhook, failed, jobs, retried] = await Promise.all([
      read("failure-webhook.json"),
      read("failure-run.json"),
      read("failure-jobs.json"),
      read("retry-success-run.json"),
    ])

    expect(webhook).toMatchObject({
      action: "completed",
      repository: { full_name: "reseaxch/podo" },
      workflow_run: {
        event: "push",
        head_branch: "main",
        status: "completed",
        conclusion: "failure",
      },
    })
    expect(webhook.workflow_run.id).toBe(failed.id)
    expect(webhook.workflow_run.run_attempt).toBe(failed.run_attempt)
    expect(webhook.workflow_run.head_sha).toBe(failed.head_sha)
    expect(jobs.jobs).toHaveLength(jobs.total_count)
    expect(jobs.jobs.every((job: Record<string, unknown>) => job.run_id === failed.id)).toBe(true)
    expect(jobs.jobs.some((job: Record<string, unknown>) => job.conclusion === "failure")).toBe(true)

    expect(retried).toMatchObject({
      id: failed.id,
      workflow_id: failed.workflow_id,
      run_attempt: failed.run_attempt + 1,
      head_sha: failed.head_sha,
      status: "completed",
      conclusion: "success",
    })
  })

  test("keeps remediation verification on a distinct delivered head", async () => {
    const [failed, remediated] = await Promise.all([
      read("failure-run.json"),
      read("remediation-success-run.json"),
    ])

    expect(remediated).toMatchObject({
      workflow_id: failed.workflow_id,
      status: "completed",
      conclusion: "success",
    })
    expect(remediated.id).not.toBe(failed.id)
    expect(remediated.head_sha).not.toBe(failed.head_sha)
    expect(remediated.head_branch).toMatch(/^podo\/remediation-[a-f0-9]{16,64}$/)
    expect(remediated.head_branch).not.toBe("main")
  })

  test("contains no credential-shaped fixture material", async () => {
    const names = [
      "failure-webhook.json",
      "failure-run.json",
      "failure-jobs.json",
      "retry-success-run.json",
      "remediation-success-run.json",
    ]
    const content = (await Promise.all(names.map((name) => Bun.file(new URL(name, fixtureRoot)).text()))).join("\n")

    expect(content).not.toMatch(/authorization|bearer|github_pat_|gh[opsu]_/i)
  })
})
