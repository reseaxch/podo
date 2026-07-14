# Demo monorepo — cache-growth scenario

Three TypeScript services used as the fixed input for the canonical
`cache-growth` incident. This is demo fixture code, not a Rootline package; it is
intentionally outside the root Bun workspace.

## Services

| Service | Port | Responsibility |
| --- | --- | --- |
| `checkout-service` | 8081 | HTTP order API. Reserves inventory, caches sessions. |
| `inventory-service` | 8082 | Stock check and reservation. |
| `notification-worker` | — | Async delivery of checkout notifications. |

## Topology (extracted into the graph)

```text
checkout-service --calls--> inventory-service   (reserveInventory)
checkout-service            notification-worker  (async notifications)
```

## The defect

`checkout-service/src/cache.ts` (`CheckoutCache`) inserts an entry per checkout
and **never evicts**: no max-size bound, no TTL. Under sustained traffic the map
grows without limit → heap usage climbs → the process eventually OOMs and
`POST /checkout` starts returning HTTP 500.

`src/cache.test.ts` reproduces the unbounded growth. A remediation would bound
the cache (max entries and/or TTL) and invert that assertion.

## Reproduction

```bash
bun test demo/services/checkout-service
```

## Run and smoke-check the topology

Start each service in a separate terminal:

```bash
bun run --cwd demo/services/inventory-service start
bun run --cwd demo/services/checkout-service start
bun run --cwd demo/services/notification-worker start
```

The HTTP services stay running on ports 8082 and 8081 respectively. The worker
starts a polling loop and processes its seeded demo job. To verify all three
process entrypoints without leaving servers running, execute:

```bash
bun run demo/services/smoke.ts
```
