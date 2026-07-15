import { createCoreHandler } from "./app"
import { createProductionRemediationExecutorFactory } from "./runtime/production-remediation"

const host = process.env.PODO_CORE_HOST ?? "127.0.0.1"
const port = Number(process.env.PODO_CORE_PORT ?? "4100")
const remediationExecutorFactory = createProductionRemediationExecutorFactory(process.env)

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`Invalid PODO_CORE_PORT: ${process.env.PODO_CORE_PORT}`)
}

const server = Bun.serve({
  hostname: host,
  port,
  fetch: createCoreHandler({
    ...(remediationExecutorFactory ? { remediationExecutorFactory } : {}),
  }),
})

console.log(`Podo core listening on http://${server.hostname}:${server.port}`)
