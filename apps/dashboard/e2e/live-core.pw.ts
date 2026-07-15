import { expect, test } from "@playwright/test"

const corePort = Number(process.env.PODO_DASHBOARD_E2E_CORE_PORT ?? 4101)
const coreOrigin = `http://127.0.0.1:${corePort}`

test.beforeEach(async ({ request }) => {
  await request.post(`${coreOrigin}/__reset`)
})

test("live Core flow stays approval-gated through pull request delivery", async ({
  page,
}) => {
  await page.goto("/?mode=live")
  await expect(
    page.getByRole("heading", { name: "Investigation not started" }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Investigate incident" }).click()
  await expect(
    page.getByRole("button", { name: "Prepare tested remediation" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Prepare tested remediation" }).click()
  await expect(
    page.getByRole("button", { name: "Approve tested fix" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Approve tested fix" }).click()
  await expect(
    page.getByRole("region", { name: "Verified remediation artifact" }),
  ).toContainText("Regression before patchfailed")
  await expect(
    page.getByRole("region", { name: "Verified remediation artifact" }),
  ).toContainText("Regression after patchpassed")
  await expect(
    page.getByRole("button", { name: "Prepare pull request delivery" }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Prepare pull request delivery" })
    .click()
  await expect(
    page.getByRole("button", { name: "Approve & create PR" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Approve & create PR" }).click()

  await expect(
    page.getByRole("link", { name: "Open PR #1842" }),
  ).toHaveAttribute("href", "https://github.com/reseaxch/podo/pull/1842")
})

test("unsafe remediation creates a Core-owned issue without an extra approval", async ({
  page,
}, testInfo) => {
  const incidentId = `incident_unsafe_${testInfo.project.name}`
  await page.goto(`/?mode=live&incident=${encodeURIComponent(incidentId)}`)

  await expect(
    page.getByRole("button", { name: "Create GitHub issue" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0)
  await page.getByRole("button", { name: "Create GitHub issue" }).click()

  await expect(
    page.getByRole("link", { name: "Open issue #91" }),
  ).toHaveAttribute("href", "https://github.com/reseaxch/podo/issues/91")
})
