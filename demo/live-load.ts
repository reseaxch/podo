type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CheckoutLoadSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  averageLatencyMs: number;
  statuses: Record<string, number>;
}

export async function runCheckoutLoad(options: {
  checkoutUrl: string;
  requests: number;
  delayMs: number;
  fetch?: Fetch;
  onProgress?: (input: {
    index: number;
    total: number;
    status: number;
    latencyMs: number;
  }) => void;
}): Promise<CheckoutLoadSummary> {
  if (!Number.isInteger(options.requests) || options.requests < 1)
    throw new Error("requests must be a positive integer");
  if (
    !Number.isFinite(options.delayMs) ||
    options.delayMs < 0 ||
    options.delayMs > 60_000
  )
    throw new Error("delayMs must be between 0 and 60000");

  const request = options.fetch ?? fetch;
  const checkoutUrl = options.checkoutUrl.replace(/\/+$/, "");
  const startedAt = performance.now();
  let succeeded = 0;
  let failed = 0;
  let totalLatencyMs = 0;
  const statuses: Record<string, number> = {};

  for (let index = 0; index < options.requests; index += 1) {
    const requestStartedAt = performance.now();
    const response = await request(`${checkoutUrl}/checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trace-id": `trace-${String(index + 1).padStart(4, "0")}`,
      },
      body: JSON.stringify({
        orderId: `video-order-${String(index + 1).padStart(4, "0")}`,
        sku: index % 2 === 0 ? "sku-basic" : "sku-pro",
        quantity: 1,
      }),
    });
    const latencyMs = performance.now() - requestStartedAt;
    totalLatencyMs += latencyMs;
    statuses[String(response.status)] =
      (statuses[String(response.status)] ?? 0) + 1;
    if (response.ok) succeeded += 1;
    else failed += 1;
    await response.body?.cancel();
    options.onProgress?.({
      index: index + 1,
      total: options.requests,
      status: response.status,
      latencyMs,
    });
    if (options.delayMs > 0 && index + 1 < options.requests)
      await Bun.sleep(options.delayMs);
  }

  return {
    attempted: options.requests,
    succeeded,
    failed,
    durationMs: performance.now() - startedAt,
    averageLatencyMs: totalLatencyMs / options.requests,
    statuses,
  };
}

async function waitForIncident(
  coreUrl: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${coreUrl.replace(/\/+$/, "")}/api/incidents`,
    );
    if (response.ok) {
      const body = (await response.json()) as {
        incidents?: Array<{ id?: unknown }>;
      };
      const id = body.incidents?.find(
        (incident) => typeof incident.id === "string",
      )?.id;
      if (id) return id as string;
    }
    await Bun.sleep(100);
  }
  throw new Error("Podo did not open an incident after the load run");
}

async function waitForNotifications(
  notificationUrl: string,
  expected: number,
  timeoutMs: number,
): Promise<{ delivered: number; failed: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${notificationUrl.replace(/\/+$/, "")}/status`,
    );
    if (response.ok) {
      const body = (await response.json()) as {
        queueDepth?: unknown;
        delivered?: unknown;
        failed?: unknown;
      };
      if (
        body.queueDepth === 0 &&
        typeof body.delivered === "number" &&
        body.delivered >= expected &&
        typeof body.failed === "number"
      )
        return { delivered: body.delivered, failed: body.failed };
    }
    await Bun.sleep(100);
  }
  throw new Error("notification-worker did not drain the checkout queue");
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value))
    throw new Error("load configuration must use positive integers");
  return Number(value);
}

if (import.meta.main) {
  const checkoutUrl =
    process.env.PODO_LAB_CHECKOUT_URL ?? "http://127.0.0.1:8081";
  const coreUrl = process.env.PODO_LAB_CORE_URL ?? "http://127.0.0.1:4100";
  const dashboardUrl =
    process.env.PODO_LAB_DASHBOARD_URL ?? "http://127.0.0.1:3000";
  const notificationUrl =
    process.env.PODO_LAB_NOTIFICATION_URL ?? "http://127.0.0.1:8083";
  try {
    const summary = await runCheckoutLoad({
      checkoutUrl,
      requests: positiveInteger(process.env.PODO_LAB_REQUESTS, 14),
      delayMs: positiveInteger(process.env.PODO_LAB_DELAY_MS, 150),
      onProgress({ index, total, status, latencyMs }) {
        console.log(
          `[${String(index).padStart(2, "0")}/${total}] POST /checkout → ${status} (${latencyMs.toFixed(0)}ms)`,
        );
      },
    });
    const incidentId = await waitForIncident(coreUrl, 5_000);
    const notifications = await waitForNotifications(
      notificationUrl,
      summary.succeeded,
      5_000,
    );
    console.log(
      `Load complete: ${summary.succeeded} succeeded, ${summary.failed} failed`,
    );
    console.log(
      `Notifications: ${notifications.delivered} delivered, ${notifications.failed} failed`,
    );
    console.log(
      `Podo incident: ${dashboardUrl}/?incident=${encodeURIComponent(incidentId)}`,
    );
  } catch (error) {
    console.error(
      `Live load failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  }
}
