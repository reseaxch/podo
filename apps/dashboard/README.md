# Podo dashboard

`@podo/dashboard` is both the judge-facing browser demo and the self-hosted
operator UI. Its live routes cover incidents, the Core causal path, evidence,
diagnosis, approvals, remediation diff and tests, delivery state, and audit
history.

The dashboard is a client of core. It must use public Podo contracts and must not access persistence or Codex directly.

The default route reads detected incidents server-side through
`@podo/client`. Set `PODO_CORE_URL` when core is not available at
`http://127.0.0.1:4100`. Use `?incident=<incident-id>` to select a specific
incident. The judge-facing fixture workspace remains isolated at `/demo`; it is
not imported by the production route and is not a production data source.

The live incident view is fail-closed and Core-owned. It renders the
incident-linked investigation lifecycle and validated diagnosis returned by
Core, then exposes only the explicit investigation, remediation, and delivery
commands available through `@podo/client`. Remediation execution and pull
request delivery remain separate approval boundaries. Failed or structurally
incomplete responses never expose unsafe guidance. Unsafe, denied, or failed
remediation uses the Core-owned GitHub issue fallback directly; it does not add
another approval step and never builds issue content in the browser.

## Runtime modes

Use one explicit composition per deployment:

| Deployment              | `PODO_DASHBOARD_MODE` | `PODO_CORE_URL`           | Agent                                           |
| ----------------------- | --------------------- | ------------------------- | ----------------------------------------------- |
| Hosted/Vercel showcase  | `demo`                | Not used by fixture pages | `NEXT_PUBLIC_PODO_AGENT_MODE=demo`              |
| Self-hosted operator UI | `live`                | Reachable Core HTTP URL   | Keep `NEXT_PUBLIC_PODO_AGENT_MODE=demo` for now |

Demo fixtures are loaded only inside demo branches. Live pages use the typed
Core client, label unavailable Core fields explicitly, and never present demo
project or notification controls as live state. A failed incident refresh also
changes the connection badge to `Core disconnected` instead of leaving stale
connected status visible.

The contextual Agent is intentionally still a browser demo in both deployment
modes. Setting `NEXT_PUBLIC_PODO_AGENT_MODE=live` is an explicit future opt-in,
not part of the current UI readiness target.

`?mode=live` can be used by the E2E fake-Core suite to exercise the production
boundary while the rest of the browser suite remains deterministic.
Set `PODO_DASHBOARD_E2E_PORT` and `PODO_DASHBOARD_E2E_CORE_PORT` when the
default test ports are already occupied.

For the self-hosted UI:

```sh
PODO_DASHBOARD_MODE=live \
PODO_CORE_URL=http://127.0.0.1:4100 \
NEXT_PUBLIC_PODO_AGENT_MODE=demo \
bun run dev:dashboard
```

```sh
bun run dev:dashboard
bun run --cwd apps/dashboard typecheck
bun run --cwd apps/dashboard build
```

The production incident-to-PR controls, operational pages, audit, approvals,
graph, evidence summary, and Core settings are backed by the typed Core client.
`bun run --cwd apps/dashboard test:e2e:core` runs both the successful PR path
and the failed-validation-to-issue path against an actual Core HTTP server.
The visual fixture remains available only at `/demo`.
