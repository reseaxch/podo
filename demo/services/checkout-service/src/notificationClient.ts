export type NotificationChannel = "email" | "sms"

export interface NotificationEnqueueResponse {
  accepted: true
  orderId: string
}

export async function enqueueNotification(
  orderId: string,
  channel: NotificationChannel,
  baseUrl = process.env.NOTIFICATION_URL ?? "http://127.0.0.1:8083",
): Promise<void> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/notifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, channel }),
  })
  if (!response.ok)
    throw new Error(`notification enqueue failed: ${response.status}`)
  const result = (await response.json()) as Partial<NotificationEnqueueResponse>
  if (result.accepted !== true || result.orderId !== orderId)
    throw new Error("notification enqueue returned an invalid response")
}
