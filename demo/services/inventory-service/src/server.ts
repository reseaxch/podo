// inventory-service — stock check and reservation.
//
// Endpoint: POST /reserve  { sku, quantity } -> { reserved, sku }

import { reserve } from "./stock"

interface ReserveRequest {
  sku: string
  quantity: number
}

export function handleReserve(request: ReserveRequest): { reserved: boolean; sku: string } {
  return { reserved: reserve(request.sku, request.quantity), sku: request.sku }
}

export function createServer(): { port: number; fetch: (req: Request) => Promise<Response> } {
  return {
    port: 8082,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (req.method === "POST" && url.pathname === "/reserve") {
        const body = (await req.json()) as ReserveRequest
        return Response.json(handleReserve(body))
      }
      return new Response("not found", { status: 404 })
    },
  }
}
