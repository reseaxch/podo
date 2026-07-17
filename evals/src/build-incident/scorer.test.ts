import { describe, expect, test } from "bun:test"

import type { BuildIncident, BuildRemediationVerification } from "@podo/contracts"

import type { IncidentDelivery, IncidentRemediation } from "@podo/contracts"

import { loadFixtures } from "./fixtures"
import { createHarness, FOREIGN_DELIVERED_HEAD_SHA, jsonInit } from "./harness"
import { checkNames } from "./model"
import {
  captureDiagnosedIncident,
  enableActWithApproval,
  evaluateBuildIncident,
} from "./scorer"

// Pinned canonical UC-13 corpus version (sorted names + LF-normalized raw bytes
// of the five fixtures). Any fixture drift changes this and fails the test,
// preserving reproducibility per evals/AGENTS.md.
const EXPECTED_FIXTURE_FINGERPRINT =
  "sha256:3dd0a1ef191feb23aa7c07d1a317bb8f36b8b755d1ac01e646f0bc7dd2aad7be"

describe("UC-13 Build Incident evaluation suite", () => {
  test("passes deterministically over the canonical fixtures", async () => {
    const report = await evaluateBuildIncident()

    expect(report.status).toBe("passed")
    expect(report.hardFailures).toEqual([])
    for (const name of checkNames) {
      expect(report.checks[name]).toBe(true)
    }
    // Exactly one write: the single post-approval rerun-failed-jobs POST.
    expect(report.observed.githubWrites).toHaveLength(1)
    expect(report.observed.githubWrites[0]?.method).toBe("POST")
    expect(report.observed.githubWrites[0]?.url).toContain("/rerun-failed-jobs")
  })

  test("pins the canonical fixture fingerprint", async () => {
    const { fixtureFingerprint } = await loadFixtures()
    expect(fixtureFingerprint).toBe(EXPECTED_FIXTURE_FINGERPRINT)

    const report = await evaluateBuildIncident()
    expect(report.fixtureFingerprint).toBe(EXPECTED_FIXTURE_FINGERPRINT)
  })

  // Executable end-to-end gate through the PUBLIC Core handler. Matches the real
  // contract: POST /remediation/verification does NOT reject the request; Core
  // creates the verification, observes the foreign-head CI mismatch, and returns
  // a terminal failed verification. We do NOT assert a non-2xx response and do
  // NOT modify Core.
  test("fails a foreign delivered head closed without ever verifying it", async () => {
    const fixtures = await loadFixtures()
    const harness = createHarness(fixtures, { deliveredHeadSha: FOREIGN_DELIVERED_HEAD_SHA })
    await enableActWithApproval(harness)
    const incident: BuildIncident = await captureDiagnosedIncident(harness, "uc13-test-foreign")
    const path = (suffix: string) => `/api/build-incidents/${encodeURIComponent(incident.id)}${suffix}`

    const pendingRemediation = await harness.request<{ remediation: IncidentRemediation }>(
      path("/remediation"),
      jsonInit("POST", {}),
    )
    await harness.request<{ remediation: IncidentRemediation }>(
      path(`/remediation/approvals/${encodeURIComponent(pendingRemediation.body.remediation.approval.id)}`),
      jsonInit("POST", { decision: "approve" }),
    )
    const pendingDelivery = await harness.request<{ delivery: IncidentDelivery }>(
      path("/remediation/delivery"),
      jsonInit("POST", {}),
    )
    await harness.request<{ delivery: IncidentDelivery }>(
      path(`/remediation/delivery/approvals/${encodeURIComponent(pendingDelivery.body.delivery.approval.id)}`),
      jsonInit("POST", { decision: "approve" }),
    )

    // The verification request completes through the public handler (2xx). Core
    // does NOT reject a head/CI mismatch; it returns a terminal failed
    // verification. We assert observed state, not a non-2xx status.
    const verified = await harness.request<{ incident: BuildIncident; verification: BuildRemediationVerification }>(
      path("/remediation/verification"),
      jsonInit("POST", {}),
    )

    expect(verified.status).toBeGreaterThanOrEqual(200)
    expect(verified.status).toBeLessThan(300)
    expect(verified.body.verification.status).toBe("failed")
    expect(verified.body.verification.error?.code).toBe("ci_result_mismatch")
    expect(verified.body.incident.status).not.toBe("verified")
    expect(verified.body.incident.ciResult?.mode).not.toBe("remediation")

    // The delivered foreign head was queried; the failed source head never was.
    expect(harness.listedHeads).toContain(FOREIGN_DELIVERED_HEAD_SHA)
    expect(harness.listedHeads).not.toContain(fixtures.failureRun.head_sha)
    // No GitHub write on the remediation/verification path.
    expect(harness.writes).toEqual([])
    // No request escaped the fixture transport, and the journal recorded work.
    expect(harness.unexpectedRequests).toEqual([])
    expect(harness.requests.length).toBeGreaterThan(0)
    expect(harness.requests.every((entry) => entry.expected)).toBe(true)
  })

  // The journal records unexpected requests BEFORE handling, so an escape is
  // observable even though the fetch also throws (and Core may catch it).
  test("records an unexpected GitHub request in the fail-closed journal", async () => {
    const fixtures = await loadFixtures()
    const harness = createHarness(fixtures)
    const owner = fixtures.failureRun.repository.owner.login
    const name = fixtures.failureRun.repository.name
    const strayUrl = `https://api.github.com/repos/${owner}/${name}/actions/runs/999999/logs`

    // The stray request throws...
    await expect(harness.githubFetch(strayUrl)).rejects.toThrow("unexpected fixture GitHub request")
    // ...and is recorded as an escape regardless (observable even if caught).
    expect(harness.unexpectedRequests).toHaveLength(1)
    expect(harness.unexpectedRequests[0]).toMatchObject({ method: "GET", expected: false })
    expect(harness.requests.at(-1)?.expected).toBe(false)

    // An unexpected write is also journaled and counted as a write escape.
    await expect(harness.githubFetch(strayUrl, { method: "POST" })).rejects.toThrow()
    expect(harness.unexpectedRequests).toHaveLength(2)
    expect(harness.writes.some((write) => write.method === "POST" && write.url === strayUrl)).toBe(true)
  })

  // Only the canonical remediation head and the foreign-head control are
  // expected on the head-list endpoint. An old/source or unknown head, or a
  // malformed pagination query, must fail closed rather than return an empty
  // CI list that could masquerade as an ordinary mismatch.
  test("fails closed on unexpected or malformed head-list requests", async () => {
    const fixtures = await loadFixtures()
    const owner = fixtures.failureRun.repository.owner.login
    const name = fixtures.failureRun.repository.name
    const runsUrl = `https://api.github.com/repos/${owner}/${name}/actions/runs`
    const query = "per_page=100&page=1"

    // The old/source head is NOT an expected list head.
    const sourceHarness = createHarness(fixtures)
    await expect(sourceHarness.githubFetch(`${runsUrl}?head_sha=${fixtures.failureRun.head_sha}&${query}`))
      .rejects.toThrow("unexpected fixture GitHub request")
    expect(sourceHarness.unexpectedRequests).toHaveLength(1)
    expect(sourceHarness.listedHeads).toEqual([])

    // A drifted pagination query for an otherwise-expected head fails closed.
    const driftHarness = createHarness(fixtures)
    await expect(driftHarness.githubFetch(`${runsUrl}?head_sha=${fixtures.remediationSuccessRun.head_sha}&per_page=50&page=1`))
      .rejects.toThrow("unexpected fixture GitHub request")
    expect(driftHarness.unexpectedRequests).toHaveLength(1)
    expect(driftHarness.listedHeads).toEqual([])

    // The canonical remediation head with the exact pagination is served.
    const okHarness = createHarness(fixtures)
    const ok = await okHarness.githubFetch(`${runsUrl}?head_sha=${fixtures.remediationSuccessRun.head_sha}&${query}`)
    expect(ok.status).toBe(200)
    expect(okHarness.unexpectedRequests).toEqual([])
    expect(okHarness.listedHeads).toEqual([fixtures.remediationSuccessRun.head_sha])
  })
})
