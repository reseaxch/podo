# Scenario ownership

- Treat scenarios as shared versioned contracts, not disposable test fixtures.
- Keep each scenario deterministic and self-contained.
- Store source incident inputs and expected outcomes here; do not store implementation logic or raw benchmark output.
- Preserve stable evidence IDs and provenance used by evals and demos.
- Include positive, negative, safety, and failure controls when changing the corpus.
- Coordinate schema changes with demo, eval, benchmark, replay, and end-to-end test owners.

Validate JSON syntax and run `bun test evals` after changing a scenario consumed by current suites.
