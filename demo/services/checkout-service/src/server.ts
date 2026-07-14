// checkout-service — HTTP API for placing orders.
//
// Endpoint: POST /checkout
//   1. reserves inventory via inventory-service;
//   2. caches the checkout session (see cache.ts — the unbounded-cache defect);
//   3. returns the order confirmation.

import { CheckoutCache } from "./cache"
import { reserveInventory } from "./inventoryClient"

interface CheckoutRequest {
  orderId: string
  sku: string
  quantity: number
}

interface CheckoutSession {
  orderId: string
  sku: string
  reservedAt: string
}

const cache = new CheckoutCache<CheckoutSession>()

export async function handleCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
  const cached = cache.get(request.orderId)
  if (cached) return cached

  const reservation = await reserveInventory(request.sku, request.quantity)
  if (!reservation.reserved) {
    throw new Error(`out of stock: ${request.sku}`)
  }

  const session: CheckoutSession = {
    orderId: request.orderId,
    sku: request.sku,
    reservedAt: new Date().toISOString(),
  }
  cache.set(request.orderId, session)
  return session
}

export function createServer(): { port: number; fetch: (req: Request) => Promise<Response> } {
  return {
    port: 8081,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (req.method === "POST" && url.pathname === "/checkout") {
        const body = (await req.json()) as CheckoutRequest
        const session = await handleCheckout(body)
        return Response.json(session)
      }
      return new Response("not found", { status: 404 })
    },
  }
}

export function startServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve(createServer())
  console.log(`checkout-service listening on http://127.0.0.1:${server.port}`)
  return server
}

if (import.meta.main) {
  startServer()
}
