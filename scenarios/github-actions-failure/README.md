# GitHub Actions failure

Canonical deterministic provider fixtures for UC-13. The source failure is a
completed `Workspace` workflow from a push to the trusted default branch. `retry-success-run.json`
represents a successful second attempt of that exact run and head commit;
`remediation-success-run.json` represents CI on a separately delivered verified
remediation head.

The fixtures contain no credentials and are consumed only through injected
GitHub fakes. They must never cause a real network request or repository write.
