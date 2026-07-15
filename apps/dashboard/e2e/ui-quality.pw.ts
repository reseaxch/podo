import { expect, test } from "@playwright/test"

const routes = [
  "/overview",
  "/incidents",
  "/#workspace",
  "/audit",
  "/evidence-sources",
  "/system-graph",
  "/safety",
  "/settings",
]

test("dark theme keeps the neutral graphite palette", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("podo-theme", "dark")
  })
  await page.goto("/demo")

  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement)
    return {
      background: styles.getPropertyValue("--background").trim(),
      surface: styles.getPropertyValue("--surface").trim(),
      elevated: styles.getPropertyValue("--surface-elevated").trim(),
      muted: styles.getPropertyValue("--surface-muted").trim(),
      border: styles.getPropertyValue("--border").trim(),
    }
  })

  expect(tokens).toEqual({
    background: "#0c0f12",
    surface: "#13171b",
    elevated: "#191e23",
    muted: "#21272d",
    border: "#343d45",
  })
})

for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme reflows every UI route without browser errors`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("podo-theme", selectedTheme)
    }, theme)

    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
      const layout = await page.evaluate(() => ({
        rootWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }))
      expect(
        layout.rootScrollWidth,
        `${route} root overflow`,
      ).toBeLessThanOrEqual(layout.rootWidth)
      expect(
        layout.bodyScrollWidth,
        `${route} body overflow`,
      ).toBeLessThanOrEqual(layout.bodyWidth)
    }

    expect(errors).toEqual([])
  })
}
