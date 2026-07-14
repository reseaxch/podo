# Cross-cutting correctness tests

This directory is reserved for tests that genuinely cross module boundaries:

- `unit` for shared pure behavior without a natural package-local home;
- `contract` for producer/consumer compatibility;
- `integration` for multiple Rootline modules working together;
- `e2e` for user-visible system flows.

Prefer colocated tests beside their owning implementation when only one module is involved. Evals measure decision quality and benchmarks measure runtime properties; neither replaces correctness tests.
