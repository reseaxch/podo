import { inspectCodexRuntime } from "@rootline/codex-app-server-client"
import { measure } from "./index"

const samples = []
for (let iteration = 0; iteration < 3; iteration += 1) {
  samples.push(await measure("codex-version", () => inspectCodexRuntime()))
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      benchmark: "codex-version",
      samples: samples.map(({ durationMs, result }) => ({
        durationMs,
        version: result.version,
      })),
    },
    null,
    2,
  ),
)
