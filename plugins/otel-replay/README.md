# OpenTelemetry replay plugin

`@rootline/plugin-otel-replay` deterministically replays normalized telemetry into an injected Rootline ingestion boundary. It does not access core storage and it does not own incident decisions.

## Public boundary

```ts
import { createRootlineClient } from "@rootline/client"
import { replayTelemetry } from "@rootline/plugin-otel-replay"

const client = createRootlineClient({ baseUrl: "http://127.0.0.1:4100" })
const summary = await replayTelemetry(events, client, {
  acceleration: 100,
  batchSize: 50,
  signal: abortController.signal,
})
```

`TelemetryReplaySink` is structurally compatible with the `ingestTelemetry` method on `RootlineClient`, so tests can inject an in-memory sink and production callers can inject the typed client. A sink may also consume the optional `AbortSignal`; the adapter never creates network or persistence side effects by itself.

`ReplaySummary` is audit-oriented and reports:

- a stable `replayId` derived from ordered input plus replay configuration;
- terminal status and total/attempted event counts;
- sink-owned accepted, duplicate, and rejected counts;
- bounded batch count and accelerated scheduled duration;
- every rejection mapped from its batch-local index back to the original input index.

Aborted and failed runs throw `ReplayAbortedError`, `ReplaySchedulerError`, or `ReplaySinkError` with the partial summary attached. `ReplayInputError` reports all preflight input issues before the first sink call.

## Determinism and timing

The adapter validates the complete input before producing side effects, then orders events by:

1. parsed event instant;
2. canonical JSON content for equal instants;
3. original index for byte-equivalent duplicates.

Events at different instants are never put in the same batch. Equal-instant events are split into batches of at most `batchSize`, preserving replay timing while bounding each ingestion call. Scenario-time gaps are divided by `acceleration`; the first instant is dispatched immediately. Tests inject `ReplayScheduler`, so even a multi-minute fixture is validated without wall-clock sleeps.

The adapter clones but does not normalize events. Source IDs, timestamps, trace links, deployment IDs, container IDs, and additional JSON provenance fields are passed through unchanged. Replaying the same input and configuration produces the same order, batch boundaries, timing, and `replayId`. Core remains the idempotence authority: a second replay may correctly report duplicates instead of accepted events.

## Validation ownership

The replay boundary only rejects data it cannot schedule or reproduce safely:

- every event must be a JSON-compatible object;
- `timestamp` must be an explicit ISO-8601 date-time with `Z` or a numeric offset;
- configuration must use positive finite acceleration and a batch size from 1 through 1000.

It does not silently trim, fill, coerce, or repair telemetry fields. Kind, severity, service, message, metric, and identifier semantics are deliberately delegated to core ingestion, and its rejections are preserved in the replay summary.

Cancellation is checked before scheduling, between batches, and while awaiting a sink call. The signal is forwarded to capable sinks and also raced locally so replay returns promptly even if a sink ignores cancellation. Because an already-started external call may still complete, its batch remains counted as attempted with no invented outcome; retry safety relies on core event idempotence.

## Canonical fixture and checks

Tests read `scenarios/cache-growth/fixtures/telemetry.json` directly. No scenario data is copied into this package.

```sh
bun test plugins/otel-replay
bun run --cwd plugins/otel-replay typecheck
bun run --cwd plugins/otel-replay build
```
