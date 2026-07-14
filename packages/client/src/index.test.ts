import { describe, expect, test } from "bun:test"
import { createRootlineClient } from "./index"

describe("createRootlineClient", () => {
  test("normalizes the base URL and decodes health responses", async () => {
    const requestedUrls: string[] = []
    const client = createRootlineClient({
      baseUrl: "http://rootline.test/",
      fetch: async (input) => {
        requestedUrls.push(String(input))
        return Response.json({ service: "rootline-core", status: "ok", version: "0.0.0" })
      },
    })

    await expect(client.health()).resolves.toEqual({
      service: "rootline-core",
      status: "ok",
      version: "0.0.0",
    })
    expect(requestedUrls).toEqual(["http://rootline.test/healthz"])
  })
})
