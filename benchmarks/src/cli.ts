import { inspectCodexRuntime } from "@podo/codex-app-server-client"
import { measure } from "./index"
import { runCacheGrowthPluginPathBenchmark } from "../incident-replay/cache-growth-plugin-path"
import { runCanonicalCoreClientFlowBenchmark } from "../end-to-end/canonical-core-client-flow"

const samples = []
for (let iteration = 0; iteration < 3; iteration += 1) {
  samples.push(await measure("codex-version", () => inspectCodexRuntime()))
}

const codexVersion = {
  status: "ok" as const,
  benchmark: "codex-version" as const,
  samples: samples.map(({ durationMs, result }) => ({
    durationMs,
    version: result.version,
  })),
}

const cacheGrowthPluginPath = await runCacheGrowthPluginPathBenchmark()
const canonicalCoreClientFlow = await runCanonicalCoreClientFlowBenchmark()

console.log(
  JSON.stringify(
    {
      status: "ok",
      benchmarks: [
        codexVersion,
        cacheGrowthPluginPath,
        canonicalCoreClientFlow,
      ],
    },
    null,
    2,
  ),
)
