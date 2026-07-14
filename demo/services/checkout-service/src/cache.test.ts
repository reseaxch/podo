import { describe, expect, test } from "bun:test"
import { CheckoutCache } from "./cache"

// Regression test for the cache-growth defect.
//
// This test documents the CURRENT (buggy) behavior: the cache retains every
// entry with no eviction. It is the reproduction the remediation flow will
// invert — after a fix that bounds the cache, the growth assertion below should
// be replaced with a bound assertion (cache size stays <= limit).
describe("CheckoutCache (cache-growth defect)", () => {
  test("grows without bound as distinct keys are inserted", () => {
    const cache = new CheckoutCache<number>()
    const inserted = 10_000
    for (let i = 0; i < inserted; i += 1) {
      cache.set(`order-${i}`, i)
    }
    // Defect: every entry is retained. A bounded cache would cap this.
    expect(cache.size).toBe(inserted)
  })
})
