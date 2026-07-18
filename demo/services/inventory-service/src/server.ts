// inventory-service — stock check and reservation.
//
// Endpoint: POST /reserve  { sku, quantity } -> { reserved, sku }

import { reserve } from "./stock"

interface ReserveRequest {
  sku: string
  quantity: number
}

export function handleReserve(request: ReserveRequest): {
  reserved: boolean
  sku: string
} {
  return { reserved: reserve(request.sku, request.quantity), sku: request.sku }
}

export function createServer(): {
  port: number
  fetch: (req: Request) => Promise<Response>
} {
  return {
    port: parsePort(process.env.INVENTORY_PORT, 8082),
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (req.method === "GET" && url.pathname === "/healthz")
        return Response.json({ service: "inventory-service", status: "ok" })
      if (req.method === "POST" && url.pathname === "/reserve") {
        const body = (await req.json()) as ReserveRequest
        return Response.json(handleReserve(body))
      }
      return new Response("not found", { status: 404 })
    },
  }
}

export function startServer(): ReturnType<typeof Bun.serve> {
  const application = createServer()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: application.port,
    fetch: application.fetch,
  })
  console.log(`inventory-service listening on http://127.0.0.1:${server.port}`)
  return server
}

if (import.meta.main) {
  startServer()
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Invalid INVENTORY_PORT")
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port > 65_535)
    throw new Error("Invalid INVENTORY_PORT")
  return port
}
