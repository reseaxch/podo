# Incident scenarios

This directory is the canonical, versioned fixture corpus shared by the demo, evals, benchmarks, and end-to-end tests.

| Scenario | Purpose |
| --- | --- |
| `cache-growth` | Canonical memory-growth investigation and remediation |
| `healthy-control` | No-incident control |
| `insufficient-evidence` | Diagnosis must remain uncertain or abstain |
| `misleading-deployment` | Resist a plausible but unsupported recent-change story |
| `failing-remediation` | Failed tests must block PR delivery |

Scenario data describes inputs and expected outcomes. Runtime implementations, scorers, and benchmark results belong in their owning workstreams.
