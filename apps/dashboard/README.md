# Rootline dashboard

`@rootline/dashboard` is the judge-facing browser UI. It will cover the incident list, causal graph, evidence timeline, diagnosis, approvals, remediation diff and tests, delivery state, and audit history.

The dashboard is a client of core. It must use public Rootline contracts and must not access persistence or Codex directly.

```sh
bun run dev:dashboard
bun run --cwd apps/dashboard typecheck
bun run --cwd apps/dashboard build
```

The current UI is a runnable foundation; the full incident-to-PR experience is still to be implemented.
