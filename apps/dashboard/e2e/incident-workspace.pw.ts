import { expect, test } from "@playwright/test"

test("incident workspace supports its primary investigation flow", async ({
  page,
}) => {
  await page.goto("/")
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
      page.getByRole("button", { name: "Expand Heap usage increasing" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Deploy v2.8.1 to production/ }),
    ).toHaveCount(0)
  } else {
    await page.keyboard.press("Escape")
  }
  await page.getByRole("tab", { name: "Graph" }).click()
  await expect(
    page.getByRole("heading", { name: "Why this is the root cause" }),
  ).toBeVisible()
  const runtimeNode = page.getByRole("button", { name: /GC pressure 6×/ })
  await runtimeNode.click()
  await expect(page.locator(".graph-inspector")).toBeVisible()
  await page.locator(".causal-canvas").click({ position: { x: 20, y: 20 } })
  await expect(page.locator(".graph-inspector")).toHaveCount(0)

  const themeToggle = page.getByRole("button", {
    name: "Switch to dark theme",
  })
  await themeToggle.click()
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
