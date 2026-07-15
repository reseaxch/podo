# Vendored source ownership

This file applies to wrappers under `vendor/`; a deeper upstream `AGENTS.md` may add its own repository rules.

- Do not mix Podo feature work into vendored upstream source.
- Update pins through the repository-supported upstream workflow.
- Keep local patches explicit, minimal, documented, and separate from generated protocol changes.
- Never hand-edit generated protocol output to compensate for an upstream mismatch.
- Validate an updated Codex pin with protocol generation, App Server tests, smoke, and the full workspace check.
- Coordinate any unavoidable upstream patch with the Codex runtime owner before integration.
