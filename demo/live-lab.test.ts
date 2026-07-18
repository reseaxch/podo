import { describe, expect, test } from "bun:test";
import type {
  IngestTelemetryRequest,
  IngestTelemetryResponse,
  TelemetryEventInput,
} from "@podo/contracts";
import { IncidentMonitor } from "../apps/core/src/modules/incidents/incident-monitor";
import { createLabConfiguration, liveLabProcessExited } from "./live-lab";
import { runCheckoutLoad } from "./live-load";
import { createCheckoutService } from "./services/checkout-service/src/server";
import { HttpCheckoutTelemetry } from "./services/checkout-service/src/telemetry";

const MIB = 1024 * 1024;

describe("live Podo lab", () => {
  test("reserves a distinct notification-worker endpoint", () => {
    const configuration = createLabConfiguration({});
    expect(configuration.notificationPort).toBe(8083);
    expect(configuration.notificationUrl).toBe("http://127.0.0.1:8083");
    expect(() =>
      createLabConfiguration({
        PODO_LAB_NOTIFICATION_PORT: "8082",
      }),
    ).toThrow("Live lab ports must be unique");
  });

  test("an in-process Core has no child process to mark as exited", () => {
    expect(liveLabProcessExited(null)).toBeFalse();
    expect(liveLabProcessExited({ exitCode: null })).toBeFalse();
    expect(liveLabProcessExited({ exitCode: 0 })).toBeTrue();
  });

  test("real checkout traffic grows the cache and opens one Podo incident", async () => {
    const monitor = new IncidentMonitor();
    const exported: TelemetryEventInput[] = [];
    const notifications: Array<{ orderId: string; channel: string }> = [];
    let clock = Date.parse("2026-07-14T09:00:00.000Z");
    const telemetry = new HttpCheckoutTelemetry({
      coreUrl: "http://podo.test",
      now: () => new Date((clock += 1_000)),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as IngestTelemetryRequest;
        exported.push(...body.events);
        return Response.json(
          monitor.ingest(body.events) satisfies IngestTelemetryResponse,
        );
      },
    });
    const checkout = createCheckoutService({
      reserveInventory: async (sku) => ({ reserved: true, sku }),
      enqueueNotification: async (orderId, channel) => {
        notifications.push({ orderId, channel });
      },
      telemetry,
      failureThreshold: 11,
      retainedPayloadBytes: 64,
      productionHeapBaselineBytes: 180 * MIB,
      productionHeapGrowthPerEntryBytes: 42 * MIB,
      now: () => new Date("2026-07-14T09:00:00.000Z"),
    });

    await checkout.start();
    const summary = await runCheckoutLoad({
      checkoutUrl: "http://checkout.test",
      requests: 14,
      delayMs: 0,
      fetch: (input, init) => checkout.fetch(new Request(input, init)),
    });

    expect(summary).toMatchObject({
      attempted: 14,
      succeeded: 11,
      failed: 3,
    });
    expect(notifications).toEqual(
      Array.from({ length: 11 }, (_, index) => ({
        orderId: `video-order-${String(index + 1).padStart(4, "0")}`,
        channel: "email",
      })),
    );
    expect(exported.filter(({ kind }) => kind === "metric")).toHaveLength(11);
    expect(exported.filter(({ kind }) => kind === "trace")).toHaveLength(3);
    expect(
      exported.filter(
        ({ kind, severity }) => kind === "log" && severity === "error",
      ),
    ).toHaveLength(3);
    expect(
      exported.every(
        ({ containerId }) => containerId === "checkout-service-7b9c",
      ),
    ).toBeTrue();
    expect(
      exported
        .filter(({ metric }) => metric?.name === "process.heap.used")
        .map(({ metric }) => metric!.value / MIB),
    ).toEqual([222, 264, 306, 348, 390, 432, 474, 516, 558, 600, 642]);

    const [incident] = monitor.listIncidents();
    expect(incident).toMatchObject({
      detector: "cache_growth",
      affectedService: "checkout-service",
      deploymentId: "deploy-1042",
    });
    expect(incident?.evidence).toHaveLength(17);

    const status = await checkout.fetch(
      new Request("http://checkout.test/status"),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      cacheEntries: 11,
      retainedPayloadBytes: 704,
      requests: 14,
      successes: 11,
      failures: 3,
      notificationsEnqueued: 11,
      notificationErrors: 0,
    });
  });

  test("telemetry and notification outages never take down checkout traffic", async () => {
    const checkout = createCheckoutService({
      reserveInventory: async (sku) => ({ reserved: true, sku }),
      async enqueueNotification() {
        throw new Error("notification queue unavailable");
      },
      telemetry: {
        async recordDeployment() {
          throw new Error("collector unavailable");
        },
        async recordCacheSample() {
          throw new Error("collector unavailable");
        },
        async recordFailure() {
          throw new Error("collector unavailable");
        },
      },
      retainedPayloadBytes: 8,
      failureThreshold: 2,
    });

    await checkout.start();
    const response = await checkout.fetch(
      new Request("http://checkout.test/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: "order-1",
          sku: "sku-basic",
          quantity: 1,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const status = await checkout.fetch(
      new Request("http://checkout.test/status"),
    );
    expect(await status.json()).toMatchObject({
      successes: 1,
      telemetryErrors: 2,
      notificationErrors: 1,
    });
  });
});
