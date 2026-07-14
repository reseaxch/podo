import type { HealthResponse, SystemStatusResponse } from "@rootline/contracts"

export interface RootlineClientOptions {
  baseUrl?: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

export interface RootlineClient {
  health(): Promise<HealthResponse>
  systemStatus(): Promise<SystemStatusResponse>
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Rootline request failed (${response.status}): ${detail}`)
  }

  return (await response.json()) as T
}

export function createRootlineClient(options: RootlineClientOptions = {}): RootlineClient {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:4100").replace(/\/$/, "")
  const request = options.fetch ?? globalThis.fetch

  return {
    async health() {
      return readJson<HealthResponse>(await request(`${baseUrl}/healthz`))
    },
    async systemStatus() {
      return readJson<SystemStatusResponse>(await request(`${baseUrl}/api/system`))
    },
  }
}
