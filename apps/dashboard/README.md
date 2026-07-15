# Podo dashboard

`@podo/dashboard` is the judge-facing browser UI. It will cover the incident list, causal graph, evidence timeline, diagnosis, approvals, remediation diff and tests, delivery state, and audit history.

The dashboard is a client of core. It must use public Podo contracts and must not access persistence or Codex directly.

The default route reads detected incidents server-side through
`@podo/client`. Set `PODO_CORE_URL` when core is not available at
`http://127.0.0.1:4100`. Use `?incident=<incident-id>` to select a specific
incident. The judge-facing fixture workspace remains isolated at `/demo`; it is
not imported by the production route and is not a production data source.

The live incident view is intentionally read-only and fail-closed. It renders
the incident-linked investigation lifecycle and validated diagnosis returned by
core, including confidence, recommended action, and links to the diagnosis's
existing core evidence records. Failed or structurally incomplete lifecycle
responses never expose diagnosis or remediation guidance. The production route
does not import demo fixtures, create local incident state, or offer approval,
remediation, pull-request, or graph controls.

```sh
bun run dev:dashboard
bun run --cwd apps/dashboard typecheck
bun run --cwd apps/dashboard build
```

The current UI is a runnable foundation; the full incident-to-PR experience is still to be implemented.
