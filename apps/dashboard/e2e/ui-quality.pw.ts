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

test("dark theme is the product default", async ({ page }) => {
  await page.goto("/incidents")

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(
    page.getByRole("button", { name: "Switch to light theme" }),
  ).toBeVisible()
})

test("dark theme keeps the Vercel graphite palette", async ({ page }) => {
  await page.goto("/incidents")

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
      window.localStorage.setItem("podo-theme-v2", selectedTheme)
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

test("primary navigation remains available on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto("/overview")
  if (testInfo.project.name === "mobile-chromium") {
    const trigger = page.getByRole("button", {
      name: "Open primary navigation",
    })
    await expect(trigger).toBeVisible()
    await trigger.click()
    const dialog = page.getByRole("dialog", { name: "Primary navigation" })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole("link", { name: "Safety & approvals" }),
    ).toHaveAttribute("href", "/safety")
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    return
  }

  await expect(
    page.getByRole("complementary", { name: "Primary navigation" }),
  ).toBeVisible()
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`overview content reflows at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium")
    await page.setViewportSize(viewport)
    await page.goto("/overview")

    const clipping = await page.locator("main > section").evaluate((root) => {
      const viewportWidth = document.documentElement.clientWidth
      return Array.from(
        root.querySelectorAll<HTMLElement>("h1, h2, p, a, button, strong"),
      )
        .filter((element) => element.offsetParent !== null)
        .map((element) => {
          const bounds = element.getBoundingClientRect()
          return {
            text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80),
            left: bounds.left,
            right: bounds.right,
          }
        })
        .filter(
          (element) => element.left < -1 || element.right > viewportWidth + 1,
        )
    })

    expect(clipping).toEqual([])
  })
}
