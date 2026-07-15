import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync("app/styles/base.css", "utf8")

function tokenValues(name: string): string[] {
  return [
    ...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "g")),
  ].map((match) => match[1]!.toLowerCase())
}

function luminance(hex: string): number {
  const channels = hex
    .match(/[0-9a-f]{2}/gi)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(left: string, right: string): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort(
    (a, b) => b - a,
  )
  return (lighter! + 0.05) / (darker! + 0.05)
}

describe("dashboard palette", () => {
  it("keeps every filled primary and critical pair at WCAG AA contrast", () => {
    const primary = tokenValues("primary-solid")
    const primaryHover = tokenValues("primary-solid-hover")
    const onPrimary = tokenValues("on-primary-solid")
    const critical = tokenValues("critical-solid")
    const onCritical = tokenValues("on-critical-solid")

    for (const values of [
      primary,
      primaryHover,
      onPrimary,
      critical,
      onCritical,
    ])
      expect(values).toHaveLength(3)

    for (const index of [0, 1, 2]) {
      expect(
        contrast(primary[index]!, onPrimary[index]!),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(primaryHover[index]!, onPrimary[index]!),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(critical[index]!, onCritical[index]!),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})
