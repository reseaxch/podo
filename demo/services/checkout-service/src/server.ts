// checkout-service — HTTP API for placing orders.
//
// Endpoint: POST /checkout
//   1. reserves inventory via inventory-service;
//   2. caches the checkout session (see cache.ts — the unbounded-cache defect);
//   3. enqueues an asynchronous delivery through notification-worker;
//   4. returns the order confirmation.

import { CheckoutCache } from "./cache"
import { reserveInventory } from "./inventoryClient"
import {
  enqueueNotification,
  type NotificationChannel,
} from "./notificationClient"
import {
  HttpCheckoutTelemetry,
  noCheckoutTelemetry,
  type CheckoutTelemetry,
} from "./telemetry"

export interface CheckoutRequest {
  orderId: string
  sku: string
  quantity: number
}

export interface CheckoutSession {
  orderId: string
  sku: string
  reservedAt: string
}

interface CachedCheckout {
  session: CheckoutSession
  retainedPayload: number[]
}

export interface CheckoutServiceSnapshot {
  cacheEntries: number
  retainedPayloadBytes: number
  productionEquivalentHeapBytes: number
  requests: number
  successes: number
  failures: number
  telemetryErrors: number
  notificationsEnqueued: number
  notificationErrors: number
  deploymentId: "deploy-1042"
  inventoryUrl: string
  notificationUrl: string
}

export function createCheckoutService(options: {
  reserveInventory: typeof reserveInventory
  enqueueNotification?: (
    orderId: string,
    channel: NotificationChannel,
  ) => Promise<void>
  telemetry?: CheckoutTelemetry
  retainedPayloadBytes?: number
  failureThreshold?: number
  productionHeapBaselineBytes?: number
  productionHeapGrowthPerEntryBytes?: number
  inventoryUrl?: string
  notificationUrl?: string
  now?: () => Date
}) {
  const telemetry = options.telemetry ?? noCheckoutTelemetry
  const retainedPayloadBytes = positiveInteger(
    options.retainedPayloadBytes,
    2 * 1024 * 1024,
    "retainedPayloadBytes",
  )
  const failureThreshold = positiveInteger(
    options.failureThreshold,
    11,
    "failureThreshold",
  )
  const productionHeapBaselineBytes = positiveInteger(
    options.productionHeapBaselineBytes,
    180 * 1024 * 1024,
    "productionHeapBaselineBytes",
  )
  const productionHeapGrowthPerEntryBytes = positiveInteger(
    options.productionHeapGrowthPerEntryBytes,
    42 * 1024 * 1024,
    "productionHeapGrowthPerEntryBytes",
  )
  const now = options.now ?? (() => new Date())
  const cache = new CheckoutCache<CachedCheckout>()
  let retainedBytes = 0
  let requests = 0
  let successes = 0
  let failures = 0
  let telemetryErrors = 0
  let notificationsEnqueued = 0
  let notificationErrors = 0
  let started = false

  const recordTelemetry = async (operation: () => Promise<void>) => {
    try {
      await operation()
    } catch {
      telemetryErrors += 1
    }
  }

  const snapshot = (): CheckoutServiceSnapshot => ({
    cacheEntries: cache.size,
    retainedPayloadBytes: retainedBytes,
    productionEquivalentHeapBytes:
      productionHeapBaselineBytes +
      cache.size * productionHeapGrowthPerEntryBytes,
    requests,
    successes,
    failures,
    telemetryErrors,
    notificationsEnqueued,
    notificationErrors,
    deploymentId: "deploy-1042",
    inventoryUrl:
      options.inventoryUrl ??
      process.env.INVENTORY_URL ??
      "http://inventory-service:8082",
    notificationUrl:
      options.notificationUrl ??
      process.env.NOTIFICATION_URL ??
      "http://127.0.0.1:8083",
  })

  const handleCheckout = async (
    request: CheckoutRequest,
  ): Promise<CheckoutSession> => {
    requests += 1
    const cached = cache.get(request.orderId)
    if (cached) {
      successes += 1
      return cached.session
    }
    if (cache.size >= failureThreshold) {
      failures += 1
      throw new CheckoutPressureError()
    }

    const reservation = await options.reserveInventory(
      request.sku,
      request.quantity,
    )
    if (!reservation.reserved) throw new CheckoutOutOfStockError(request.sku)

    const session: CheckoutSession = {
      orderId: request.orderId,
      sku: request.sku,
      reservedAt: now().toISOString(),
    }
    const retainedPayload = new Array<number>(
      Math.max(1, Math.ceil(retainedPayloadBytes / 8)),
    ).fill(cache.size)
    retainedBytes += retainedPayload.length * 8
    cache.set(request.orderId, { session, retainedPayload })
    successes += 1
    await recordTelemetry(() =>
      telemetry.recordCacheSample({
        cacheEntries: cache.size,
        observedHeapBytes:
          productionHeapBaselineBytes +
          cache.size * productionHeapGrowthPerEntryBytes,
      }),
    )
    if (options.enqueueNotification) {
      try {
        await options.enqueueNotification(session.orderId, "email")
        notificationsEnqueued += 1
      } catch {
        notificationErrors += 1
      }
    }
    return session
  }

  return {
    snapshot,
    handleCheckout,
    async start() {
      if (started) return
      started = true
      await recordTelemetry(() => telemetry.recordDeployment())
    },
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      if (req.method === "GET" && url.pathname === "/healthz")
        return Response.json({ service: "checkout-service", status: "ok" })
      if (req.method === "GET" && url.pathname === "/status")
        return Response.json(snapshot())
      if (req.method === "POST" && url.pathname === "/checkout") {
        const body = await checkoutRequest(req)
        if (!body)
          return Response.json(
            { error: "invalid checkout request" },
            { status: 400 },
          )
        const traceId =
          normalizedHeader(req.headers.get("x-trace-id")) ??
          `trace-${crypto.randomUUID()}`
        try {
          return Response.json(await handleCheckout(body))
        } catch (error) {
          if (error instanceof CheckoutPressureError) {
            await recordTelemetry(() => telemetry.recordFailure({ traceId }))
            return Response.json(
              {
                error: "checkout temporarily unavailable",
                traceId,
              },
              { status: 500, headers: { "x-trace-id": traceId } },
            )
          }
          if (error instanceof CheckoutOutOfStockError)
            return Response.json(
              { error: error.message, traceId },
              { status: 409, headers: { "x-trace-id": traceId } },
            )
          return Response.json(
            { error: "inventory dependency unavailable", traceId },
            { status: 502, headers: { "x-trace-id": traceId } },
          )
        }
      }
      return new Response("not found", { status: 404 })
    },
  }
}

export function createServer(): {
  port: number
  fetch: (req: Request) => Promise<Response>
  start: () => Promise<void>
} {
  const inventoryUrl = process.env.INVENTORY_URL ?? "http://127.0.0.1:8082"
  const notificationUrl =
    process.env.NOTIFICATION_URL ?? "http://127.0.0.1:8083"
  const coreUrl = process.env.PODO_CORE_URL
  const service = createCheckoutService({
    reserveInventory: (sku, quantity) =>
      reserveInventory(sku, quantity, inventoryUrl),
    enqueueNotification: (orderId, channel) =>
      enqueueNotification(orderId, channel, notificationUrl),
    inventoryUrl,
    notificationUrl,
    ...(coreUrl ? { telemetry: new HttpCheckoutTelemetry({ coreUrl }) } : {}),
    retainedPayloadBytes: environmentInteger(
      process.env.CHECKOUT_RETAINED_PAYLOAD_BYTES,
      2 * 1024 * 1024,
      "CHECKOUT_RETAINED_PAYLOAD_BYTES",
    ),
    failureThreshold: environmentInteger(
      process.env.CHECKOUT_FAILURE_THRESHOLD,
      11,
      "CHECKOUT_FAILURE_THRESHOLD",
    ),
  })
  return {
    port: environmentInteger(process.env.CHECKOUT_PORT, 8081, "CHECKOUT_PORT"),
    fetch: service.fetch,
    start: service.start,
  }
}

export async function startServer(): Promise<ReturnType<typeof Bun.serve>> {
  const application = createServer()
  await application.start()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: application.port,
    fetch: application.fetch,
  })
  console.log(`checkout-service listening on http://127.0.0.1:${server.port}`)
  return server
}

if (import.meta.main) {
  await startServer()
}

class CheckoutPressureError extends Error {}

class CheckoutOutOfStockError extends Error {
  constructor(sku: string) {
    super(`out of stock: ${sku}`)
  }
}

async function checkoutRequest(
  request: Request,
): Promise<CheckoutRequest | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const input = body as Record<string, unknown>
  if (
    typeof input.orderId !== "string" ||
    !input.orderId.trim() ||
    typeof input.sku !== "string" ||
    !input.sku.trim() ||
    !Number.isSafeInteger(input.quantity) ||
    Number(input.quantity) < 1
  )
    return null
  return {
    orderId: input.orderId.trim(),
    sku: input.sku.trim(),
    quantity: Number(input.quantity),
  }
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized < 1)
    throw new Error(`${name} must be a positive safe integer`)
  return normalized
}

function environmentInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} is invalid`)
  return positiveInteger(Number(value), fallback, name)
}

function normalizedHeader(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
