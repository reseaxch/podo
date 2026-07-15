import { describe, expect, test } from "bun:test";

import type { DetectedIncident, TelemetryEventInput } from "@podo/contracts";

import {
  createDemoConfiguration,
  DemoConfigurationError,
  parseCanonicalScenario,
  seedCanonicalIncident,
} from "../../demo/run";

const repositoryRoot = "/tmp/podo-demo-repository";
const bunExecutable = "/tmp/podo-demo-runtime/bun";

describe("one-command judge demo", () => {
  test("builds a live, approval-gated configuration without forwarding GitHub credentials", () => {
    const configuration = createDemoConfiguration(
      {
        PATH: "/usr/bin:/bin",
        CODEX_BIN: "/tmp/codex",
        GH_TOKEN: "gh-secret",
        GITHUB_TOKEN: "github-secret",
        PODO_GITHUB_TOKEN: "podo-github-secret",
        PODO_DEMO_CORE_PORT: "4510",
        PODO_DEMO_DASHBOARD_PORT: "4511",
        PODO_DEMO_SCRATCH_PARENT: "/tmp/podo-demo-scratch",
        PODO_DEMO_MODE: "live",
      },
      { repositoryRoot, bunExecutable },
    );

    expect(configuration.coreUrl).toBe("http://127.0.0.1:4510");
    expect(configuration.dashboardUrl).toBe("http://127.0.0.1:4511");
    expect(configuration.mode).toBe("live");
    expect(configuration.coreEnvironment).toMatchObject({
      PODO_INCIDENT_GRAPH_ENABLED: "true",
      PODO_REMEDIATION_ENABLED: "true",
      PODO_REMEDIATION_REPOSITORY_ROOT: repositoryRoot,
      PODO_REMEDIATION_BASE_REF: "refs/heads/main",
      PODO_GITHUB_DELIVERY_ENABLED: "false",
      PODO_GITHUB_ISSUE_ENABLED: "false",
    });
    expect(configuration.dashboardEnvironment).toMatchObject({
      PODO_CORE_URL: "http://127.0.0.1:4510",
      PODO_DASHBOARD_MODE: "live",
      PODO_INCIDENT_CWD: repositoryRoot,
    });
    expect(configuration.coreEnvironment.GH_TOKEN).toBeUndefined();
    expect(configuration.coreEnvironment.GITHUB_TOKEN).toBeUndefined();
    expect(configuration.coreEnvironment.PODO_GITHUB_TOKEN).toBeUndefined();
    expect(
      JSON.parse(
        configuration.coreEnvironment.PODO_REMEDIATION_REGRESSION_COMMAND!,
      ),
    ).toEqual([bunExecutable, "test", "demo/services/checkout-service"]);
  });

  test("rejects ambiguous ports and malformed canonical expectations", () => {
    expect(() =>
      createDemoConfiguration(
        {
          PODO_DEMO_CORE_PORT: "4100",
          PODO_DEMO_DASHBOARD_PORT: "4100",
          PODO_DEMO_MODE: "live",
        },
        { repositoryRoot, bunExecutable },
      ),
    ).toThrow(DemoConfigurationError);
    expect(() =>
      createDemoConfiguration(
        {
          PODO_DEMO_CORE_PORT: "not-a-port",
        },
        { repositoryRoot, bunExecutable },
      ),
    ).toThrow(DemoConfigurationError);
    expect(() =>
      createDemoConfiguration(
        {
          PODO_DEMO_MODE: "unknown",
        },
        { repositoryRoot, bunExecutable },
      ),
    ).toThrow(DemoConfigurationError);
    expect(() =>
      parseCanonicalScenario({ expected: { createsIncident: false } }),
    ).toThrow(DemoConfigurationError);
  });

  test("defaults to the deterministic POC gate and explicit fixture dashboard", () => {
    const configuration = createDemoConfiguration(
      {
        PODO_DEMO_SCRATCH_PARENT: "/tmp/podo-demo-scratch",
      },
      { repositoryRoot, bunExecutable },
    );

    expect(configuration.mode).toBe("deterministic");
    expect(configuration.proofCommand).toEqual([bunExecutable, "run", "poc"]);
    expect(configuration.dashboardUrl).toBe("http://127.0.0.1:3000/demo");
    expect(configuration.dashboardEnvironment.PODO_DASHBOARD_MODE).toBe("demo");

    const sharedUnusedCorePort = createDemoConfiguration(
      {
        PODO_DEMO_CORE_PORT: "3000",
        PODO_DEMO_DASHBOARD_PORT: "3000",
        PODO_DEMO_SCRATCH_PARENT: "/tmp/podo-demo-scratch",
      },
      { repositoryRoot, bunExecutable },
    );
    expect(sharedUnusedCorePort.dashboardPort).toBe(3000);
  });

  test("sets approval mode, replays canonical telemetry, and exposes exactly one expected incident", async () => {
    const actions: string[] = [];
    const incident = detectedIncident();
    const client = {
      async updateSettings() {
        actions.push("settings");
        return {
          settings: {
            autonomyMode: "act_with_approval" as const,
            monitoringEnabled: true,
            defaultSandbox: "read-only" as const,
            turnTimeoutMs: 60_000,
          },
        };
      },
      async ingestTelemetry(events: TelemetryEventInput[]) {
        actions.push(`ingest:${events.length}`);
        return {
          ingestion: { accepted: events.length, duplicates: 0, rejected: [] },
          reaction: {
            action: "open_incident" as const,
            detector: "cache_growth" as const,
            service: "checkout-service",
            deploymentId: "deploy-1042",
            reason: "fixture",
          },
          incident,
        };
      },
      async listIncidents() {
        actions.push("list");
        return { incidents: [incident] };
      },
    };
    const telemetry = [
      telemetryEvent("2026-07-15T10:00:00.000Z", 100),
      telemetryEvent("2026-07-15T10:00:01.000Z", 200),
    ];

    const result = await seedCanonicalIncident(client, telemetry, {
      createsIncident: true,
      affectedService: "checkout-service",
    });

    expect(result.incident.id).toBe(incident.id);
    expect(result.replay).toMatchObject({
      status: "completed",
      accepted: 2,
      rejected: 0,
    });
    expect(actions).toEqual(["settings", "ingest:1", "ingest:1", "list"]);
  });
});

function telemetryEvent(timestamp: string, value: number): TelemetryEventInput {
  return {
    timestamp,
    kind: "metric",
    service: "checkout-service",
    severity: "warn",
    message: "heap growth",
    deploymentId: "deploy-1042",
    containerId: "checkout-service-7b9c",
    metric: {
      name: "process.runtime.nodejs.memory.heap.used",
      value,
      unit: "By",
    },
  };
}

function detectedIncident(): DetectedIncident {
  return {
    id: "incident-cache-growth",
    status: "detected",
    detector: "cache_growth",
    affectedService: "checkout-service",
    deploymentId: "deploy-1042",
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:01.000Z",
    evidence: [
      {
        id: "evidence-1",
        sourceEventId: "event-1",
        sourceType: "metric",
        observedAt: "2026-07-15T10:00:01.000Z",
        service: "checkout-service",
        deploymentId: "deploy-1042",
      },
    ],
  };
}
