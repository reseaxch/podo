import { afterEach, describe, expect, it } from "vitest"

import {
  isTrustedOperatorMode,
  trustedMutationRequestError,
} from "./dashboard-client"

describe("trusted mutation request boundary", () => {
  afterEach(() => {
    delete process.env.PODO_DASHBOARD_MODE
    delete process.env.PODO_TRUSTED_OPERATOR_MODE
    delete process.env.PODO_DASHBOARD_ORIGIN
  })

  it("accepts same-origin JSON", () => {
    process.env.PODO_DASHBOARD_ORIGIN = "http://dashboard.test"
    const request = new Request("http://dashboard.test/api/podo/settings", {
      method: "PATCH",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "http://dashboard.test",
      },
    })

    expect(trustedMutationRequestError(request)).toBeNull()
  })

  it("uses the configured public origin when a proxy normalizes the internal URL", () => {
    process.env.PODO_DASHBOARD_ORIGIN = "https://podo.example"
    const request = new Request("http://localhost:3020/api/podo/settings", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3020",
        origin: "https://podo.example",
        "sec-fetch-site": "same-origin",
      },
    })

    expect(trustedMutationRequestError(request)).toBeNull()
  })

  it("rejects simple and cross-origin requests", () => {
    process.env.PODO_DASHBOARD_ORIGIN = "http://dashboard.test"
    expect(
      trustedMutationRequestError(
        new Request("http://dashboard.test/api/podo/settings", {
          method: "PATCH",
          headers: { "content-type": "text/plain" },
        }),
      ),
    ).toEqual({ status: 415, error: "json_required" })
    expect(
      trustedMutationRequestError(
        new Request("http://dashboard.test/api/podo/settings", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            origin: "https://attacker.test",
          },
        }),
      ),
    ).toEqual({ status: 403, error: "cross_origin_request" })
  })

  it("rejects a missing origin and a matching attacker-controlled Host", () => {
    process.env.PODO_DASHBOARD_ORIGIN = "http://127.0.0.1:3020"

    expect(
      trustedMutationRequestError(
        new Request("http://127.0.0.1:3020/api/podo/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
        }),
      ),
    ).toEqual({ status: 403, error: "trusted_origin_required" })

    expect(
      trustedMutationRequestError(
        new Request("http://attacker.test/api/podo/settings", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            host: "attacker.test",
            origin: "http://attacker.test",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toEqual({ status: 403, error: "cross_origin_request" })
  })

  it("enables trusted operator mode only with an exact valid origin", () => {
    process.env.PODO_DASHBOARD_MODE = "live"
    process.env.PODO_TRUSTED_OPERATOR_MODE = "true"

    expect(isTrustedOperatorMode()).toBe(false)

    process.env.PODO_DASHBOARD_ORIGIN = "not a URL"
    expect(isTrustedOperatorMode()).toBe(false)

    process.env.PODO_DASHBOARD_ORIGIN = "https://podo.example"
    expect(isTrustedOperatorMode()).toBe(true)
  })
})
