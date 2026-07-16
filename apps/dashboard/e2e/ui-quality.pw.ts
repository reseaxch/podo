import { expect, test, type Locator, type Page } from "@playwright/test"

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

test("keyboard focus stays visible across controls in both themes", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("podo-theme", selectedTheme)
    }, theme)

    await page.goto("/demo")
    const button = page.getByRole("button", { name: /podo-cloud/i })
    await tabTo(page, button)
    await expect(button).not.toHaveCSS("box-shadow", "none")

    await page.goto("/demo")
    const link = page.getByRole("link", { name: "Overview" })
    await tabTo(page, link)
    await expect(link).not.toHaveCSS("box-shadow", "none")

    await page.goto("/demo")
    const tab = page.getByRole("tab", { name: "Evidence" })
    await tabTo(page, tab)
    await expect(tab).not.toHaveCSS("box-shadow", "none")

    await page.goto("/settings")
    const input = page.locator("input:not([type='hidden'])").first()
    await tabTo(page, input)
    const colors = await input.evaluate((element) => {
      const root = getComputedStyle(document.documentElement)
      const field = getComputedStyle(element)
      return {
        focus: root.getPropertyValue("--focus"),
        background: field.backgroundColor,
      }
    })
    expect(
      contrastRatio(colors.focus, colors.background),
    ).toBeGreaterThanOrEqual(3)
    await expect(input).not.toHaveCSS("box-shadow", "none")
  }
})

test("forced colors restores a native keyboard outline", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" })
  await page.goto("/demo")
  const tab = page.getByRole("tab", { name: "Evidence" })
  await tabTo(page, tab)
  await expect(tab).toHaveCSS("outline-style", "solid")
  await expect(tab).toHaveCSS("outline-width", "2px")
  await expect(tab).toHaveCSS("box-shadow", "none")
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

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((element) => element === document.activeElement))
      return
  }
  throw new Error("Keyboard focus did not reach the expected control")
}

function contrastRatio(foreground: string, background: string): number {
  const parse = (value: string) => {
    const normalizedValue = value.trim()
    const channels = /^#[0-9a-f]{6}$/i.test(normalizedValue)
      ? [1, 3, 5].map((offset) =>
          Number.parseInt(normalizedValue.slice(offset, offset + 2), 16),
        )
      : value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number)
    if (!channels || channels.length !== 3)
      throw new Error("Expected an RGB color")
    return channels.map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    })
  }
  const luminance = (value: string) => {
    const [red = 0, green = 0, blue = 0] = parse(value)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}
