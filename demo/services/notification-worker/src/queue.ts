// Minimal in-memory work queue for checkout notifications.

export interface NotificationJob {
  orderId: string
  channel: "email" | "sms"
}

export class NotificationQueue {
  private readonly jobs: NotificationJob[] = []

  enqueue(job: NotificationJob): void {
    this.jobs.push(job)
  }

  dequeue(): NotificationJob | undefined {
    return this.jobs.shift()
  }

  get depth(): number {
    return this.jobs.length
  }
}
