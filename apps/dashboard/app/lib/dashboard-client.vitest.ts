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
