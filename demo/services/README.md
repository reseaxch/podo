# Demo monorepo — cache-growth scenario

Three TypeScript services used as the fixed input for the canonical
`cache-growth` incident. This is demo fixture code, not a Podo package; it is
intentionally outside the root Bun workspace.

## Services

| Service | Port | Responsibility |
| --- | --- | --- |
| `checkout-service` | 8081 | HTTP order API. Reserves inventory, caches sessions. |
| `inventory-service` | 8082 | Stock check and reservation. |
| `notification-worker` | 8083 | HTTP-backed async delivery of checkout notifications. |

## Topology (extracted into the graph)

```text
checkout-service --calls--> inventory-service   (reserveInventory)
checkout-service --enqueues--> notification-worker  (async notifications)
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

The services stay running on ports 8081, 8082, and 8083. A successful checkout
reserves stock, retains its session, and posts a notification job to the
worker's in-memory queue. To verify that full path without leaving servers
running, execute:

```bash
bun run demo/services/smoke.ts
```

The smoke runner uses isolated ports 18081–18083 by default. Override them with
`PODO_SMOKE_CHECKOUT_PORT`, `PODO_SMOKE_INVENTORY_PORT`, and
`PODO_SMOKE_NOTIFICATION_PORT`.

## Observe real traffic with Podo

The repository-level live lab starts this topology together with Podo Core and
the production Dashboard:

```bash
bun run lab
```

In another terminal, generate the controlled cache-growth incident:

```bash
bun run lab:load
```

The checkout process exports OpenTelemetry-compatible events directly to
Core's public ingestion endpoint when `PODO_CORE_URL` is configured. Without
that variable the service remains standalone; a telemetry outage is counted in
`GET /status` and never takes checkout traffic down.

Useful service endpoints:

- `GET http://127.0.0.1:8081/healthz`
- `GET http://127.0.0.1:8081/status`
- `POST http://127.0.0.1:8081/checkout`
- `GET http://127.0.0.1:8082/healthz`
- `POST http://127.0.0.1:8082/reserve`
- `GET http://127.0.0.1:8083/healthz`
- `GET http://127.0.0.1:8083/status`
- `POST http://127.0.0.1:8083/notifications`
