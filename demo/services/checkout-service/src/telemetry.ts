import type {
  IngestTelemetryRequest,
  IngestTelemetryResponse,
  TelemetryEventInput,
} from "@podo/contracts"

export interface CacheSample {
  cacheEntries: number
  observedHeapBytes: number
}

export interface CheckoutFailure {
  traceId: string
}

export interface CheckoutTelemetry {
  recordDeployment(): Promise<void>
  recordCacheSample(sample: CacheSample): Promise<void>
  recordFailure(failure: CheckoutFailure): Promise<void>
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export class HttpCheckoutTelemetry implements CheckoutTelemetry {
  private readonly coreUrl: string
  private readonly request: Fetch
  private readonly now: () => Date
  private lastTimestamp = 0

  constructor(options: { coreUrl: string; fetch?: Fetch; now?: () => Date }) {
    this.coreUrl = options.coreUrl.replace(/\/+$/, "")
    if (!this.coreUrl) throw new Error("coreUrl must be a non-empty URL")
    this.request = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  recordDeployment(): Promise<void> {
    return this.ingest([
      this.event({
        kind: "log",
        severity: "info",
        message: "deployment deploy-1042 rolled out",
      }),
    ])
  }

  recordCacheSample(sample: CacheSample): Promise<void> {
    return this.ingest([
      this.event({
        kind: "metric",
        severity:
          sample.observedHeapBytes >= 512 * 1024 * 1024 ? "warn" : "info",
        message: "process heap sample",
        metric: {
          name: "process.heap.used",
          value: sample.observedHeapBytes,
          unit: "By",
        },
      }),
    ])
  }

  recordFailure(failure: CheckoutFailure): Promise<void> {
    return this.ingest([
      this.event({
        kind: "trace",
        severity: "error",
        message: "POST /checkout returned 500",
        traceId: failure.traceId,
      }),
      this.event({
        kind: "log",
        severity: "error",
        message:
          "allocation failure handling /checkout: JavaScript heap out of memory",
        traceId: failure.traceId,
      }),
    ])
  }

  private event(
    input: Pick<
      TelemetryEventInput,
      "kind" | "severity" | "message" | "metric" | "traceId"
    >,
  ): TelemetryEventInput {
    return {
      timestamp: this.nextTimestamp(),
      service: "checkout-service",
      deploymentId: "deploy-1042",
      containerId: "checkout-service-7b9c",
      ...input,
    }
  }

  private nextTimestamp(): string {
    const current = this.now().getTime()
    if (!Number.isFinite(current))
      throw new Error("telemetry clock returned an invalid date")
    this.lastTimestamp = Math.max(current, this.lastTimestamp + 1)
    return new Date(this.lastTimestamp).toISOString()
  }

  private async ingest(events: TelemetryEventInput[]): Promise<void> {
    const body: IngestTelemetryRequest = { events }
    const response = await this.request(
      `${this.coreUrl}/api/telemetry/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    )
    if (!response.ok)
      throw new Error(`Podo telemetry export failed (${response.status})`)
    const result = (await response.json()) as IngestTelemetryResponse
    if (result.ingestion.rejected.length > 0)
      throw new Error("Podo rejected checkout telemetry")
  }
}

export const noCheckoutTelemetry: CheckoutTelemetry = {
  async recordDeployment() {},
  async recordCacheSample() {},
  async recordFailure() {},
}
