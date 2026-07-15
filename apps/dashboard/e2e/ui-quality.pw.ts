import { expect, test } from "@playwright/test"

const routes = [
  "/incidents",
  "/#workspace",
  "/audit",
  "/evidence-sources",
  "/system-graph",
  "/safety",
  "/settings",
]

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
