import { createCoreHandler } from "./app"

const host = process.env.ROOTLINE_CORE_HOST ?? "127.0.0.1"
const port = Number(process.env.ROOTLINE_CORE_PORT ?? "4100")

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error(`Invalid ROOTLINE_CORE_PORT: ${process.env.ROOTLINE_CORE_PORT}`)
}

const server = Bun.serve({
  hostname: host,
  port,
  fetch: createCoreHandler(),
})

console.log(`Rootline core listening on http://${server.hostname}:${server.port}`)
