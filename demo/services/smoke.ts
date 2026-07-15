// Narrow process-level smoke check for the cache-growth demo topology.
// It proves the two HTTP services listen and serve a checkout request that
// reaches inventory, and that the notification worker processes its seeded job
// when run in finite smoke mode. Child processes are always terminated.
//
// Run from the repo root: bun run demo/services/smoke.ts

export {} // mark as a module so top-level await is allowed under tsc

type Child = ReturnType<typeof Bun.spawn>

const children: Child[] = []

function spawn(cwd: string, env?: Record<string, string>): Child {
  const child = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  children.push(child)
  return child
}

async function post(url: string, body: object): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      return response
    } catch (error) {
      // Service not listening yet — retry until the timeout budget is spent.
      lastError = error
      await Bun.sleep(100)
    }
  }
  throw new Error(`service did not become ready: ${url}`, { cause: lastError })
}

try {
  spawn("demo/services/inventory-service")
  spawn("demo/services/checkout-service", { INVENTORY_URL: "http://127.0.0.1:8082" })

  // 1. inventory-service responds.
  const inventoryResponse = await post("http://127.0.0.1:8082/reserve", {
    sku: "sku-basic",
    quantity: 1,
  })
  if (!inventoryResponse.ok) throw new Error(`inventory returned ${inventoryResponse.status}`)
  const reservation = (await inventoryResponse.json()) as { reserved: boolean }
  if (!reservation.reserved) throw new Error("inventory did not reserve the demo SKU")

  // 2. checkout-service responds AND the request reaches inventory.
  const checkoutResponse = await post("http://127.0.0.1:8081/checkout", {
    orderId: "smoke-order-1",
    sku: "sku-basic",
    quantity: 1,
  })
  if (!checkoutResponse.ok) throw new Error(`checkout returned ${checkoutResponse.status}`)
  const session = (await checkoutResponse.json()) as { orderId: string }
  if (session.orderId !== "smoke-order-1") throw new Error("checkout returned an unexpected session")

  // 3. notification-worker processes one seeded job in finite smoke mode.
  const worker = Bun.spawn(["bun", "run", "src/worker.ts"], {
    cwd: "demo/services/notification-worker",
    env: { ...process.env, DEMO_WORKER_ONCE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  children.push(worker)
  const workerOutput = await new Response(worker.stdout).text()
  const workerExit = await worker.exited
  if (workerExit !== 0 || !workerOutput.includes("delivered 1 notification")) {
    throw new Error("notification worker did not process its seeded job")
  }

  console.log("demo services smoke check passed")
} finally {
  for (const child of children) child.kill()
  await Promise.all(children.map((child) => child.exited))
}
