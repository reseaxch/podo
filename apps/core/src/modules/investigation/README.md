# Investigation

Owns evidence selection, structured diagnosis, confidence, and evidence-reference validation.

`IncidentInvestigationCoordinator` is the owner-layer transition from a detected
incident into the generic Codex-backed `InvestigationService`. It:

- evaluates `draft_diagnosis` against the current core-owned autonomy mode;
- resolves normalized telemetry only through the incident's stored evidence ids;
- validates evidence provenance before formatting it as untrusted prompt data;
- installs the shared investigator policy and tool declarations as App Server
  `developerInstructions`, keeps incident/evidence in the ordinary turn input,
  and fixes the runtime sandbox to `read-only`;
- denies every runtime approval request for investigator runs;
- keeps one stable incident-to-investigation association, including concurrent
  retries.

When the linked investigation completes, the coordinator reads its authoritative
assembled output and validates it with `parseStructuredDiagnosis` against the
same core-owned evidence bundle. Incident reads expose no diagnosis while the
run is active, then project either a validated `podo.diagnosis.v1` value or a
stable failed diagnosis state. Output text and parser details are not exposed in
the failure contract. A service mismatch fails validation even when the JSON and
evidence references are otherwise valid.

Diagnosis reconciliation occurs from authoritative investigation state during
each incident projection, rather than depending on event-subscription timing.
This covers completion before observation and keeps repeated starts idempotent.

`InvestigationService` separately retains the ordered Codex `output.delta`
text for internal consumers. The capture is independent of the bounded public
event log and is exposed only after the matching turn reaches `completed`.
Failed, cancelled, stale-turn, and post-terminal output cannot be consumed as a
diagnosis.

The public command accepts only an absolute repository `cwd`. Prompt, evidence,
mode, sandbox, approval, and developer instructions are deliberately not client
inputs. A validated `safeToAttemptFix` value remains diagnostic data, not an
approval. This slice does not start remediation.
