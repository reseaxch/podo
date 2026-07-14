# GitHub plugin ownership

- Keep GitHub API shapes inside this adapter.
- Separate read operations from write and delivery operations.
- Require explicit core authorization for PR or issue creation.
- Preserve test status, evidence references, and audit attribution in delivery output.
- Never merge, push to the default branch, or mutate production repositories.
- Use fakes or isolated fixtures for write-path tests; never target a real repository by default.

Validate with:

```sh
bun run --cwd plugins/github typecheck
bun run --cwd plugins/github build
```
