// notification-worker — asynchronously delivers checkout notifications.
//
// Consumes NotificationJobs from the queue and "sends" them. In the demo the
// send is a no-op log; the point is the service topology, not delivery.

import { NotificationQueue, type NotificationJob } from "./queue"

export function deliver(job: NotificationJob): { orderId: string; delivered: boolean } {
  // Real implementation would call an email/SMS provider here.
  return { orderId: job.orderId, delivered: true }
}

export function runOnce(queue: NotificationQueue): number {
  let processed = 0
  let job: NotificationJob | undefined
  while ((job = queue.dequeue())) {
    deliver(job)
    processed += 1
  }
  return processed
}
