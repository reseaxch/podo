# Podo typed client

`@podo/client` is the shared client-side boundary for core. It owns URL handling, request/response decoding, command methods, and ordered SSE consumption.

Current methods cover settings, telemetry ingestion, incident reads, and investigation start/read/cancel/approve/deny/event subscription. `startIncidentInvestigation(incidentId, { cwd })` is the safe product entrypoint: it cannot accept caller-authored prompt, evidence, sandbox, mode, or approval fields. Raw Codex protocol details must never appear in this package's public API.

The additive `PodoAgentChatClient` exposes readiness, create/read/send/cancel,
and typed SSE subscription for the Core-owned read-only operator chat. Clients
send only message text and an idempotency key; they cannot select a repository,
sandbox, system prompt, approval policy, or Codex identity. Check
`agentReadiness()` before opening the chat surface and present its stable
degraded reason, including `version_mismatch`, instead of assuming that process
health or a basic App Server handshake means the configured model is usable.

`getIncidentCausalPath(incidentId, evidenceId)` reads the versioned,
evidence-specific causal chain. Both identities are URL-encoded by the client;
code graph and trusted deployment correlation remain server-side inputs. File
and function steps include normalized labels, external IDs, and optional source
locations for code-level rendering without provider payloads.

Incident remediation uses four typed methods:
`startIncidentRemediation`, `getIncidentRemediation`,
`approveIncidentRemediation`, and `denyIncidentRemediation`. Start always sends
an empty object, and decisions send only the opaque approval id plus the selected
decision. The client cannot supply diagnosis, evidence, autonomy policy, target,
patch, test claims, or PR metadata. The factory return type composes the additive
`PodoRemediationClient` capability with `PodoIncidentClient`, preserving existing
incident-client test doubles and consumers.

```sh
bun test packages/client
bun run --cwd packages/client typecheck
bun run --cwd packages/client build
```

Contract changes require matching producer validation in `apps/core` and consumer validation in the affected CLI, TUI, or dashboard.
