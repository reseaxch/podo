import { expect, test, type APIRequestContext } from "@playwright/test"

const corePort = Number(process.env.PODO_DASHBOARD_CORE_E2E_CORE_PORT ?? 4120)
const coreURL = `http://127.0.0.1:${corePort}`

async function reset(
  request: APIRequestContext,
  outcome: "success" | "validation_failure",
) {
  const response = await request.post(`${coreURL}/__demo/reset`, {
    data: { outcome },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as {
    incidentId: string
    deliveryCalls: number
    issueCalls: number
  }
}

test.describe.serial("real Core incident workflow", () => {
  test("replay → causal graph → diagnosis → tested fix → delivery approval → PR", async ({
    page,
    request,
  }) => {
    const status = await reset(request, "success")
    await page.goto(`/?incident=${encodeURIComponent(status.incidentId)}`)

    await page.getByRole("tab", { name: "Graph" }).click()
    await expect(
      page.getByRole("heading", { name: "Evidence to affected code" }),
    ).toBeVisible()
    const graph = page.getByLabel(
      "Core causal graph from telemetry to affected code",
    )
    await expect(
      graph.getByRole("button", { name: /CheckoutCache/i }),
    ).toBeVisible()

    await page.getByRole("tab", { name: "Changes" }).click()
    await page.getByRole("button", { name: "Investigate incident" }).click()
    await expect(
      page.getByRole("button", { name: "Prepare tested remediation" }),
    ).toBeVisible({ timeout: 15_000 })
    await page
      .getByRole("button", { name: "Prepare tested remediation" })
      .click()
    await page
      .getByRole("button", { name: "Approve tested remediation" })
      .click()

    await expect(
      page.getByText("failed → passed", { exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole("region", { name: "Verified patch" }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Prepare pull request" }).click()
    await page.getByRole("button", { name: "Approve & create PR" }).click()

    await expect(
      page.getByRole("link", { name: "Open PR #1842" }),
    ).toBeVisible()
    const finalStatus = await request.get(`${coreURL}/__demo/status`)
    await expect(finalStatus).toBeOK()
    expect(await finalStatus.json()).toMatchObject({
      deliveryCalls: 1,
      issueCalls: 0,
    })
  })

  test("failed validation creates an issue and never creates a PR", async ({
    page,
    request,
  }) => {
    const status = await reset(request, "validation_failure")
    await page.goto(`/?incident=${encodeURIComponent(status.incidentId)}`)

    await page.getByRole("tab", { name: "Changes" }).click()
    await page.getByRole("button", { name: "Investigate incident" }).click()
    await expect(
      page.getByRole("button", { name: "Prepare tested remediation" }),
    ).toBeVisible({ timeout: 15_000 })
    await page
      .getByRole("button", { name: "Prepare tested remediation" })
      .click()
    await page
      .getByRole("button", { name: "Approve tested remediation" })
      .click()
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 })
    await page.getByRole("button", { name: "Create GitHub issue" }).click()

    await expect(
      page.getByRole("link", { name: "Open issue #91" }),
    ).toBeVisible()
    await expect(page.getByRole("link", { name: /Open PR/ })).toHaveCount(0)
    const delivery = await request.get(
      `${coreURL}/api/incidents/${encodeURIComponent(status.incidentId)}/remediation/delivery`,
    )
    expect(delivery.status()).toBe(404)
    const finalStatus = await request.get(`${coreURL}/__demo/status`)
    expect(await finalStatus.json()).toMatchObject({
      deliveryCalls: 0,
      issueCalls: 1,
    })
  })
})
