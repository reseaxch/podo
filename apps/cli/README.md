# Podo CLI

`@podo/cli` is the scriptable Podo client. It is intended for shell workflows, automation, health checks, and reproducible operator commands.

The CLI consumes `@podo/client`; it does not own workflow decisions or connect to Codex directly. Non-help output and exit codes should remain suitable for automation.

```sh
bun run dev:cli -- health
bun run dev:cli -- incidents list
bun run dev:cli -- incidents show <incidentId>
bun run dev:cli -- incidents path <incidentId> <evidenceId>
bun run dev:cli -- incidents investigate <incidentId> <absolute-cwd>
bun run dev:cli -- incidents remediate <incidentId>
bun run dev:cli -- incidents remediation <incidentId>
bun run dev:cli -- incidents approve-remediation <incidentId> <approvalId>
bun run dev:cli -- incidents deny-remediation <incidentId> <approvalId>
bun run dev:cli -- incidents deliver <incidentId>
bun run dev:cli -- incidents delivery <incidentId>
bun run dev:cli -- incidents approve-delivery <incidentId> <approvalId>
bun run dev:cli -- incidents deny-delivery <incidentId> <approvalId>
bun run --cwd apps/cli typecheck
bun run --cwd apps/cli build
```

Incident commands pass raw identifiers and the requested absolute working
directory to `@podo/client`; URL encoding and transport behavior remain owned by
the client package. Missing or malformed command arguments fail locally without
making a client call. Client and API failures continue through the CLI's
top-level error boundary.

Remediation remains core-owned and fail-closed. `remediate` requests creation
of an approval-gated remediation, `remediation` reads its authoritative state,
and the approval commands forward an explicit operator decision. The CLI does
not infer policy, synthesize approvals, or execute a fix itself.

Pull-request delivery is a separate core-owned lifecycle and requires its own
explicit approval after remediation verification succeeds. `deliver` requests
that approval, `delivery` reads the authoritative delivery state, and the two
delivery decision commands forward only the incident id and opaque approval id
to `@podo/client`. Repository identity, provider state, patch contents, and
approval authority are never inferred or supplied by the CLI.
