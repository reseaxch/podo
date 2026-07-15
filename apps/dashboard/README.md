# Podo dashboard

`@podo/dashboard` is the judge-facing browser UI. It will cover the incident list, causal graph, evidence timeline, diagnosis, approvals, remediation diff and tests, delivery state, and audit history.

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
incomplete responses never expose unsafe guidance, and failed verification
offers a prefilled issue handoff instead of pull-request delivery.

Set `PODO_DASHBOARD_MODE=demo` only for isolated visual development and UI
tests. `?mode=live` can be used by the E2E fake-Core suite to exercise the
production boundary while the rest of the browser suite remains deterministic.

```sh
bun run dev:dashboard
bun run --cwd apps/dashboard typecheck
bun run --cwd apps/dashboard build
```

The production incident-to-PR controls, operational pages, audit, approvals,
graph, evidence summary, and Core settings are backed by the typed Core client.
The richer judge fixture remains available only at `/demo`.
