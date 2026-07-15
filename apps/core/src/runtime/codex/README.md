# Codex runtime

Owns the core-side Codex runtime boundary. Protocol transport and the stable `CodexRuntime` adapter live in `@rootline/codex-app-server-client`; core maps those runtime events into authoritative investigation, approval, audit, and terminal state.

MVP invariants:

- one supervised App Server connection per core process;
- one internal Codex thread per investigation;
- mandatory absolute working directory and explicit sandbox policy;
- core-owned policy is installed as App Server `developerInstructions`, never
  concatenated into untrusted turn input;
- server-initiated approvals remain pending until core records an explicit decision;
- EOF, crash, timeout, and terminal turn failures are observable failures;
- a fatal connection degrades readiness and the next investigation may establish one fresh connection without retrying old mutations;
- raw protocol messages and Codex thread/turn identifiers are never public API fields.

The pinned TypeScript SDK uses `codex exec` and lacks the interactive App Server server-request/steer contract, so it is not a substitute for this runtime. A future batch/eval adapter may implement the same port without becoming a second source of investigation state.
