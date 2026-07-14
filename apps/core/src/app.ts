import { inspectCodexRuntime, type CodexRuntimeInfo } from "@rootline/codex-app-server-client"
import type { HealthResponse, SystemStatusResponse } from "@rootline/contracts"

export interface CoreHandlerOptions {
  inspectCodex?: () => Promise<CodexRuntimeInfo>
}

const serviceVersion = "0.0.0"

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  })
}

export function createCoreHandler(options: CoreHandlerOptions = {}): (request: Request) => Promise<Response> {
  const inspectCodex = options.inspectCodex ?? (() => inspectCodexRuntime())

  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405)
    }

    if (url.pathname === "/healthz") {
      const response: HealthResponse = {
        service: "rootline-core",
        status: "ok",
        version: serviceVersion,
      }
      return json(response)
    }

    if (url.pathname === "/readyz" || url.pathname === "/api/system") {
      let response: SystemStatusResponse
      try {
        const runtime = await inspectCodex()
        response = {
          service: "rootline-core",
          status: "ready",
          version: serviceVersion,
          codex: {
            available: true,
            binary: runtime.binary,
            transport: "stdio",
            version: runtime.version,
          },
        }
      } catch (error) {
        response = {
          service: "rootline-core",
          status: "degraded",
          version: serviceVersion,
          codex: {
            available: false,
            binary: process.env.CODEX_BIN ?? "codex",
            transport: "stdio",
            version: null,
            error: error instanceof Error ? error.message : String(error),
          },
        }
      }

      return json(response, url.pathname === "/readyz" && response.status !== "ready" ? 503 : 200)
    }

    return json({ error: "not_found" }, 404)
  }
}
