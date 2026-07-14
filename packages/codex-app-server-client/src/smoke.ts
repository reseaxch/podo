import { probeCodexAppServer } from "./index"

const handshake = await probeCodexAppServer()
console.log(
  JSON.stringify(
    {
      status: "ok",
      binary: handshake.runtime.binary,
      version: handshake.runtime.version,
      userAgent: handshake.initializeResult.userAgent ?? null,
      platformFamily: handshake.initializeResult.platformFamily ?? null,
      platformOs: handshake.initializeResult.platformOs ?? null,
    },
    null,
    2,
  ),
)
