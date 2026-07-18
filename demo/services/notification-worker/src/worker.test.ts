import { describe, expect, test } from "bun:test"

import { createNotificationWorker, type NotificationDelivery } from "./worker"

describe("notification-worker HTTP queue", () => {
  test("accepts a checkout notification and delivers it asynchronously", async () => {
    const delivered: NotificationDelivery[] = []
    const worker = createNotificationWorker({
      deliver(job) {
        delivered.push({ ...job, delivered: true })
        return { ...job, delivered: true }
      },
    })

    const accepted = await worker.fetch(
      new Request("http://notification.test/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: "order-1",
          channel: "email",
        }),
      }),
    )

    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({
      accepted: true,
      orderId: "order-1",
    })
    expect(worker.snapshot()).toMatchObject({
      queueDepth: 1,
      accepted: 1,
      delivered: 0,
      failed: 0,
    })

    expect(worker.processPending()).toBe(1)
    expect(delivered).toEqual([
      { orderId: "order-1", channel: "email", delivered: true },
    ])
    expect(worker.snapshot()).toMatchObject({
      queueDepth: 0,
      accepted: 1,
      delivered: 1,
      failed: 0,
    })
  })

  test("rejects malformed jobs without mutating the queue", async () => {
    const worker = createNotificationWorker()
    const response = await worker.fetch(
      new Request("http://notification.test/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: "", channel: "push" }),
      }),
    )

    expect(response.status).toBe(400)
    expect(worker.snapshot()).toMatchObject({
      queueDepth: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
    })
  })
})
