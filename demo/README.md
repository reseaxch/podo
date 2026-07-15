# Demo

This directory owns the judge-facing, one-command demonstration of Podo's canonical flow:

```text
incident replay → evidence-backed diagnosis → approved tested fix → PR preview
```

The demo should orchestrate existing public surfaces and `scenarios/cache-growth`; it must not contain a second implementation of core, scenario data, eval logic, or benchmark logic.

The directory is currently reserved. When implemented, document the exact launch command, prerequisites, expected duration, visible success state, and reset procedure here.
