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

`InvestigationService` separately retains the ordered Codex `output.delta`
text for internal consumers. The capture is independent of the bounded public
event log and is exposed only after the matching turn reaches `completed`.
Failed, cancelled, stale-turn, and post-terminal output cannot be consumed as a
diagnosis.

The public command accepts only an absolute repository `cwd`. Prompt, evidence,
mode, sandbox, approval, and developer instructions are deliberately not client
inputs. This slice does not claim a structured root cause yet and does not start
remediation.
