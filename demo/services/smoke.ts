// Narrow process-level smoke check for the cache-growth demo topology.
// It proves the two HTTP services listen and serve a checkout request that
// reaches inventory and enqueues a job that the notification worker delivers.
// Child processes are always terminated.
//
// Run from the repo root: bun run demo/services/smoke.ts

export {}; // mark as a module so top-level await is allowed under tsc

type Child = ReturnType<typeof Bun.spawn>;

const children: Child[] = [];
const readinessTimeoutMs = 120_000;
const readinessPollMs = 100;
const checkoutPort = smokePort("PODO_SMOKE_CHECKOUT_PORT", 18_081);
const inventoryPort = smokePort("PODO_SMOKE_INVENTORY_PORT", 18_082);
const notificationPort = smokePort("PODO_SMOKE_NOTIFICATION_PORT", 18_083);
const checkoutUrl = `http://127.0.0.1:${checkoutPort}`;
const inventoryUrl = `http://127.0.0.1:${inventoryPort}`;
const notificationUrl = `http://127.0.0.1:${notificationPort}`;

function spawn(
  cwd: string,
  env?: Record<string, string>,
  entrypoint = "src/server.ts",
): Child {
  const child = Bun.spawn([process.execPath, entrypoint], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  return child;
}

async function post(
  url: string,
  body: object,
  child: Child,
  deadline: number,
): Promise<Response> {
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const stderr =
        child.stderr instanceof ReadableStream
          ? await new Response(child.stderr).text()
          : "";
      throw new Error(
        `service exited before becoming ready: ${url}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      );
    }
    try {
      const remainingMs = deadline - Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(readinessPollMs, remainingMs)),
        ),
      });
      return response;
    } catch (error) {
      // Service not listening yet — retry until the timeout budget is spent.
      lastError = error;
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0)
        await Bun.sleep(Math.min(readinessPollMs, remainingMs));
    }
  }
  throw new Error(`service did not become ready: ${url}`, { cause: lastError });
}

async function waitForNotification(
  child: Child,
  deadline: number,
): Promise<void> {
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const stderr =
        child.stderr instanceof ReadableStream
          ? await new Response(child.stderr).text()
          : "";
      throw new Error(
        `notification-worker exited before delivery${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      );
    }
    try {
      const response = await fetch(`${notificationUrl}/status`, {
        signal: AbortSignal.timeout(readinessPollMs),
      });
      if (response.ok) {
        const status = (await response.json()) as {
          queueDepth?: unknown;
          accepted?: unknown;
          delivered?: unknown;
          failed?: unknown;
        };
        if (
          status.queueDepth === 0 &&
          status.accepted === 1 &&
          status.delivered === 1 &&
          status.failed === 0
        )
          return;
      } else {
        await response.body?.cancel();
      }
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(readinessPollMs);
  }
  throw new Error("notification-worker did not deliver checkout job", {
    cause: lastError,
  });
}

try {
  const readinessDeadline = Date.now() + readinessTimeoutMs;
  const inventory = spawn("demo/services/inventory-service", {
    INVENTORY_PORT: String(inventoryPort),
  });
  const worker = spawn(
    "demo/services/notification-worker",
    {
      NOTIFICATION_PORT: String(notificationPort),
    },
    "src/worker.ts",
  );
  const checkout = spawn("demo/services/checkout-service", {
    CHECKOUT_PORT: String(checkoutPort),
    INVENTORY_URL: inventoryUrl,
    NOTIFICATION_URL: notificationUrl,
  });

  // 1. inventory-service responds.
  const inventoryResponse = await post(
    `${inventoryUrl}/reserve`,
    {
      sku: "sku-basic",
      quantity: 1,
    },
    inventory,
    readinessDeadline,
  );
  if (!inventoryResponse.ok)
    throw new Error(`inventory returned ${inventoryResponse.status}`);
  const reservation = (await inventoryResponse.json()) as { reserved: boolean };
  if (!reservation.reserved)
    throw new Error("inventory did not reserve the demo SKU");

  // 2. checkout-service responds AND the request reaches inventory.
  const checkoutResponse = await post(
    `${checkoutUrl}/checkout`,
    {
      orderId: "smoke-order-1",
      sku: "sku-basic",
      quantity: 1,
    },
    checkout,
    readinessDeadline,
  );
  if (!checkoutResponse.ok)
    throw new Error(`checkout returned ${checkoutResponse.status}`);
  const session = (await checkoutResponse.json()) as { orderId: string };
  if (session.orderId !== "smoke-order-1")
    throw new Error("checkout returned an unexpected session");

  // 3. checkout enqueues one real job and notification-worker drains it.
  await waitForNotification(worker, readinessDeadline);

  console.log("demo services smoke check passed");
} finally {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  await Promise.all(children.map((child) => child.exited));
}

function smokePort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} is invalid`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535)
    throw new Error(`${name} is invalid`);
  return port;
}
