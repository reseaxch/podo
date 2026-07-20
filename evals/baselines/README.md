# Eval baselines

Store reviewed aggregate baselines here. Raw run artifacts belong in `evals/reports` and are ignored by default.

`reaction-matrix.reference-v2.json` is reproduced by:

```sh
bun run eval -- --print-baseline
```

It is an aggregate baseline for the deterministic reference adapter, marked
`modelBacked: false`. It is not evidence of model quality or a Codex/GPT run.
Plain `bun run eval` compares the current public evaluation aggregate with this
artifact and exits nonzero when the artifact is missing, malformed, or drifted.
The `implementationFingerprint` also hashes the exact bytes of the reference
adapter, eval model contract, and scorer, so implementation-only changes cannot
hide behind an unchanged all-`1` aggregate. Update the artifact only alongside
an intentional, reviewed fixture or scorer change.
