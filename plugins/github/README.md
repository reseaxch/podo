# GitHub plugin

`@podo/plugin-github` owns GitHub-facing capabilities such as repository context, commit and diff access, and approved PR or issue delivery.

All writes must remain downstream of core's human approval and test-result gates. This plugin must never merge a PR, push to a default branch, or reinterpret a failed remediation as successful.

```sh
bun run --cwd plugins/github typecheck
bun run --cwd plugins/github build
```

The package is currently a capability scaffold.
