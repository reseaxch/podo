import { expect, test } from "@playwright/test"

test("build incident stays read-only without an operator boundary", async ({
  page,
}) => {
  await page.goto("/build-incidents")
  await expect(
    page.getByRole("region", {
      name: "Build incident operational summary",
    }),
  ).toBeVisible()
  await page.getByRole("link", { name: /Open build incident/ }).click()
  await expect(
    page.getByRole("heading", { name: "CI #52 failed" }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Run 1042 · attempt 1" }),
  ).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Build incident summary" }),
  ).toBeVisible()

  await expect(
    page.getByLabel("Next safe action").getByText("Demo workspace"),
  ).toBeVisible()
  await expect(
    page.getByText(
      "This view uses real UI states without dispatching mutations to Core.",
    ),
  ).toBeVisible()
  await page.getByRole("button", { name: "Request exact retry" }).click()
  await expect(page.getByText("Demo approval request")).toBeVisible()
  await page.getByRole("button", { name: "Simulate approval" }).click()
  await expect(
    page.getByText("Demo approval completed — no retry was dispatched"),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Refresh Core state" }),
  ).toBeVisible()
})

test("overview prioritizes actionable work and preserves source boundaries", async ({
  page,
}) => {
  await page.goto("/overview")

  const decisionQueue = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "What needs you now" }),
  })
  await expect(
    decisionQueue.getByRole("button", { name: /^Open decision incident/ }),
  ).toHaveCount(1)
  await expect(
    decisionQueue.getByRole("button", { name: /Workspace unavailable$/ }),
  ).toHaveCount(2)
  await expect(page.getByText("SLO breached", { exact: true })).toBeVisible()
  await expect(page.getByText("Needs approval", { exact: true })).toBeVisible()
  await expect(page.getByText("Escalating", { exact: true })).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Open active incident INC-039/ }),
  ).toHaveCount(0)

  await page.getByRole("button", { name: "My work" }).click()
  await expect(page.getByRole("heading", { name: "1 in view" })).toBeVisible()
  await expect(
    page.getByRole("link", { name: /^Open System graph:/ }),
  ).toHaveAttribute("href", "/system-graph")
  await expect(
    page.getByRole("link", { name: /^Pull request #184 created/ }),
  ).toHaveAttribute("href", "/audit?event=evt-018")
})

test("overview opens the relevant incident context", async ({ page }) => {
  await page.goto("/overview")
  await page
    .getByRole("button", {
      name: "Open decision incident INC-042: Checkout memory growth after deploy",
    })
    .click()

  await expect(page).toHaveURL(/\?incident=INC-042&tab=graph#workspace$/)
  await expect(page.getByRole("tab", { name: "Graph" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
})

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
  await expect(
    inspector.getByRole("link", { name: "Open INC-042 evidence context" }),
  ).toHaveAttribute(
    "href",
    "/?incident=INC-042&tab=evidence&event=evt-013#workspace",
  )
})

test("evidence source catalog searches capabilities", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-chromium",
    "Mobile catalog uses category tabs instead of the desktop command search",
  )
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

test("system graph searches and inspects code evidence", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile-chromium",
    "Mobile graph uses touch navigation and filters instead of topbar search",
  )
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

test("system graph opens the exact incident graph context", async ({
  page,
}) => {
  await page.goto("/system-graph")
  await page
    .getByRole("button", { name: /^Inspect checkout-service\b/ })
    .click()
  await page.getByRole("link", { name: "Open incident INC-042" }).click()

  await expect(page).toHaveURL(
    /\?incident=INC-042&tab=graph&node=code#workspace$/,
  )
  await expect(page.getByRole("tab", { name: "Graph" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(
    page.getByRole("button", { name: /Root cause CheckoutCache\.set/ }),
  ).toHaveAttribute("aria-pressed", "true")
})

test("system graph wheel zoom stays inside the canvas", async ({ page }) => {
  await page.goto("/system-graph")
  const canvas = page.getByLabel("Pan and zoom system graph")
  await expect(canvas).toBeVisible()
  const zoomLabel = page.getByLabel("Graph viewport controls").locator("span")
  const zoomBefore = await zoomLabel.textContent()
  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect(zoomLabel).not.toHaveText(zoomBefore ?? "")
  await page.getByRole("button", { name: "Fit graph" }).click()
  const fittedZoom = await zoomLabel.textContent()
  const scrollBefore = await page.evaluate(() => window.scrollY)

  await canvas.hover({ position: { x: 240, y: 180 } })
  await page.mouse.wheel(0, 180)

  await expect(zoomLabel).not.toHaveText(fittedZoom ?? "")
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
