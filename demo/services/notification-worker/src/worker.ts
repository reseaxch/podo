// notification-worker — asynchronously delivers checkout notifications.
//
// POST /notifications accepts jobs from checkout-service. A polling worker
// drains the in-memory queue and records delivery counters for the live demo.

import { NotificationQueue, type NotificationJob } from "./queue"

export interface NotificationDelivery extends NotificationJob {
  delivered: boolean
}

export interface NotificationWorkerSnapshot {
  queueDepth: number
  accepted: number
  delivered: number
  failed: number
}

export function deliver(job: NotificationJob): NotificationDelivery {
  // Real implementation would call an email/SMS provider here.
  return { ...job, delivered: true }
}

export function createNotificationWorker(
  options: {
    deliver?: (job: NotificationJob) => NotificationDelivery
  } = {},
) {
  const queue = new NotificationQueue()
  const deliverJob = options.deliver ?? deliver
  let accepted = 0
  let delivered = 0
  let failed = 0

  const snapshot = (): NotificationWorkerSnapshot => ({
    queueDepth: queue.depth,
    accepted,
    delivered,
    failed,
  })

  const processPending = (): number => {
    let processed = 0
    let job: NotificationJob | undefined
    while ((job = queue.dequeue())) {
      try {
        const result = deliverJob(job)
        if (!result.delivered) throw new Error("notification was not delivered")
        delivered += 1
      } catch {
        failed += 1
      }
      processed += 1
    }
    return processed
  }

  return {
    snapshot,
    processPending,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/healthz")
        return Response.json({ service: "notification-worker", status: "ok" })
      if (request.method === "GET" && url.pathname === "/status")
        return Response.json(snapshot())
      if (request.method === "POST" && url.pathname === "/notifications") {
        const job = await notificationJob(request)
        if (!job)
          return Response.json(
            { error: "invalid notification job" },
            { status: 400 },
          )
        queue.enqueue(job)
        accepted += 1
        return Response.json(
          { accepted: true, orderId: job.orderId },
          { status: 202 },
        )
      }
      return new Response("not found", { status: 404 })
    },
  }
}

export function startWorker(
  worker: ReturnType<typeof createNotificationWorker>,
  intervalMs = 250,
): ReturnType<typeof setInterval> {
  const processQueue = (): void => {
    const processed = worker.processPending()
    if (processed > 0)
      console.log(`notification-worker delivered ${processed} notification(s)`)
  }
  processQueue()
  return setInterval(processQueue, intervalMs)
}

export function startServer() {
  const port = parsePort(process.env.NOTIFICATION_PORT, 8083)
  const worker = createNotificationWorker()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: worker.fetch,
  })
  const timer = startWorker(worker)
  console.log(
    `notification-worker listening on http://127.0.0.1:${server.port}`,
  )
  return { server, timer, worker }
}

if (import.meta.main) {
  startServer()
}

async function notificationJob(
  request: Request,
): Promise<NotificationJob | null> {
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
    (input.channel !== "email" && input.channel !== "sms")
  )
    return null
  return { orderId: input.orderId.trim(), channel: input.channel }
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Invalid NOTIFICATION_PORT")
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port > 65_535)
    throw new Error("Invalid NOTIFICATION_PORT")
  return port
}
