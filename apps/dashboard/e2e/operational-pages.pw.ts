import { expect, test } from "@playwright/test"

test("audit log isolates exceptions and exposes policy context", async ({
  page,
}) => {
  await page.goto("/audit")
  await page.getByRole("tab", { name: /Exceptions/ }).click()
  await page.getByRole("row", { name: /Production write blocked/ }).click()

  const inspector = page.getByRole("complementary", {
    name: "Event inspector",
  })
  await expect(inspector).toContainText("policy.capability_denied")
  await expect(inspector).toContainText("Side effects")
  await expect(inspector).toContainText("None")
})

test("evidence source catalog searches capabilities", async ({ page }) => {
  await page.goto("/evidence-sources")
  await page
    .getByRole("searchbox", { name: "Search evidence sources" })
    .fill("stack traces")

  await expect(
    page.getByRole("button", { name: /^Inspect Sentry\b/ }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: /^Inspect Datadog\b/ }),
  ).toHaveCount(0)
})

test("system graph searches and inspects code evidence", async ({ page }) => {
  await page.goto("/system-graph")
  await page
    .getByRole("searchbox", { name: "Search system graph" })
    .fill("session-cache")
  await page
    .getByRole("button", { name: /^Inspect session-cache\.ts\b/ })
    .click()

  const inspector = page.getByRole("complementary", { name: "Node details" })
  await expect(inspector).toContainText("Heap retainers")
  await expect(inspector).toContainText("63.8 MB")
})

test("system graph wheel zoom stays inside the canvas", async ({ page }) => {
  await page.goto("/system-graph")
  const canvas = page.getByLabel("Pan and zoom system graph")
  await expect(canvas).toBeVisible()
  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect(page.getByText("92%", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Fit graph" }).click()
  const scrollBefore = await page.evaluate(() => window.scrollY)

  await canvas.hover({ position: { x: 240, y: 180 } })
  await page.mouse.wheel(0, 180)

  await expect(
    page.getByLabel("Graph viewport controls").locator("span"),
  ).not.toHaveText("82%")
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
})

test("approval review remains non-mutating until confirmation", async ({
  page,
}) => {
  await page.goto("/safety")
  await page.getByRole("button", { name: "Review approval" }).click()

  const dialog = page.getByRole("dialog", { name: "Confirm approval" })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Approve action" }),
  ).toBeDisabled()
})

test("settings keeps edits local until save", async ({ page }) => {
  await page.goto("/settings")
  const name = page.getByRole("textbox", { name: "Workspace name" })
  await name.fill("Podo Reliability")

  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled()
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(name).toHaveValue("Podo Cloud")
})
