import { describe, expect, it } from "vitest"

import { trustedMutationRequestError } from "./dashboard-client"

describe("trusted mutation request boundary", () => {
  it("accepts same-origin JSON", () => {
    const request = new Request("http://dashboard.test/api/podo/settings", {
      method: "PATCH",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "http://dashboard.test",
      },
    })

    expect(trustedMutationRequestError(request)).toBeNull()
  })

  it("uses the request host when Next normalizes its internal URL", () => {
    const request = new Request("http://localhost:3020/api/podo/settings", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3020",
        origin: "http://127.0.0.1:3020",
        "sec-fetch-site": "same-origin",
      },
    })

    expect(trustedMutationRequestError(request)).toBeNull()
  })

  it("rejects simple and cross-origin requests", () => {
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
})
