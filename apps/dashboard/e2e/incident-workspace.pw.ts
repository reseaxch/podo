import { expect, test } from "@playwright/test"

test("incident workspace supports its primary investigation flow", async ({
  page,
}) => {
  await page.goto("/demo")
  await expect(page.locator(".app-shell")).toHaveAttribute("data-ready", "true")
  await expect(
    page.getByRole("heading", { name: "Checkout memory growth after deploy" }),
  ).toBeVisible()
  const mobileDiagnosis = page.getByRole("dialog", {
    name: "Working diagnosis",
  })
  if (await mobileDiagnosis.isVisible())
    await page.getByRole("button", { name: "Close diagnosis" }).click()
  await page.getByRole("button", { name: "More incident actions" }).click()
  await expect(
    page.getByRole("menuitem", { name: /Export summary/ }),
  ).toBeVisible()
  const search = page.getByRole("searchbox", { name: "Search evidence" })
  if (await search.isVisible()) {
    await search.fill("Datadog")
    await expect(
      page.getByRole("button", { name: /^Expand Heap usage increasing\b/ }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Deploy v2.8.1 to production/ }),
    ).toHaveCount(0)
  } else {
    await page.keyboard.press("Escape")
  }
  const graphTab = page.getByRole("tab", { name: "Graph" })
  await graphTab.click()
  await expect(graphTab).toHaveCSS("outline-style", "none")
  await expect(
    page.getByRole("heading", { name: "Why this is the root cause" }),
  ).toBeVisible()
  await expect
    .poll(async () =>
      page.locator(".causal-canvas").evaluate((canvas) => {
        const viewport = canvas.getBoundingClientRect()
        return Array.from(
          canvas.querySelectorAll<HTMLElement>(
            ".graph-node, .ruled-out-node, .context-node",
          ),
        )
          .filter((node) => node.offsetParent !== null)
          .every((node) => {
            const bounds = node.getBoundingClientRect()
            return (
              bounds.left >= viewport.left - 2 &&
              bounds.right <= viewport.right + 2 &&
              bounds.top >= viewport.top - 2 &&
              bounds.bottom <= viewport.bottom + 2
            )
          })
      }),
    )
    .toBe(true)
  const runtimeNode = page.getByRole("button", { name: /GC pressure 6×/ })
  await runtimeNode.click()
  await expect(page.locator(".graph-inspector")).toBeVisible()
  await page.locator(".causal-canvas").click({ position: { x: 20, y: 20 } })
  await expect(page.locator(".graph-inspector")).toHaveCount(0)

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await page.getByRole("button", { name: "Switch to light theme" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.getByRole("button", { name: "Switch to dark theme" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
})

test("empty server state remains understandable", async ({ page }) => {
  await page.goto("/?state=empty")
  await expect(
    page.getByRole("heading", { name: "Incident not found" }),
  ).toBeVisible()
})

test("persisted dark theme hydrates without a mismatch", async ({ page }) => {
  const hydrationErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration/i.test(message.text()))
      hydrationErrors.push(message.text())
  })
  await page.addInitScript(() => {
    window.localStorage.setItem("podo-theme-v2", "dark")
  })

  await page.goto("/demo")

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  expect(hydrationErrors).toEqual([])
})

test("incident overview filters the inbox and opens the primary incident", async ({
  page,
}) => {
  await page.goto("/incidents")
  await expect(
    page.getByRole("heading", { name: "Incidents", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: /Open INC-042: Checkout memory growth after deploy/,
    }),
  ).toBeVisible()

  await page.getByRole("tab", { name: /^Resolved/ }).click()
  const resolvedSummary = page.getByRole("button", {
    name: /INC-039: Elevated checkout 500 rate\. Workspace unavailable/,
  })
  await expect(resolvedSummary).toBeVisible()
  await expect(resolvedSummary).toBeDisabled()

  await page.getByRole("tab", { name: /^All/ }).click()
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(
    page.getByRole("button", {
      name: /INC-035: Order export jobs timing out\. Workspace unavailable/,
    }),
  ).toBeDisabled()

  await page.getByRole("tab", { name: /^Active/ }).click()
  await page
    .getByRole("button", {
      name: /Open INC-042: Checkout memory growth after deploy/,
    })
    .click()
  await expect(
    page.getByRole("heading", { name: "Checkout memory growth after deploy" }),
  ).toBeVisible()
  await expect(page).toHaveURL(/incident=INC-042/)
})

test("approved demo remediation exposes the actual pull request URL", async ({
  page,
}) => {
  await page.goto("/?mode=demo&incident=INC-042&tab=changes#workspace")
  await page.getByRole("button", { name: "Approve & create PR" }).click()
  await expect(
    page.getByRole("link", { name: "Open PR #1842" }),
  ).toHaveAttribute("href", "https://github.com/podo/podo/pull/1842")
})
