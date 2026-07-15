import type {
  EvidenceSource,
  EvidenceSourceMutation,
  EvidenceSourcesController,
} from "../lib/evidence-source-types"

export function createMockEvidenceSourcesController(
  initial: EvidenceSource[],
  connectedBy = "Maya Chen",
): EvidenceSourcesController {
  let sources = structuredClone(initial)

  return {
    async updateConnection(input: EvidenceSourceMutation) {
      const current = sources.find((source) => source.id === input.sourceId)
      if (!current) throw new Error("Evidence source is no longer available")
      if (current.status !== input.expectedStatus)
        throw new Error("Connection state changed. Refresh before continuing.")
      if (
        (input.action === "connect" && current.status !== "Available") ||
        (input.action === "repair" && current.status !== "Needs attention") ||
        (input.action === "disconnect" && current.status !== "Connected")
      )
        throw new Error("This connection action is not permitted")

      const updated: EvidenceSource =
        input.action === "disconnect"
          ? {
              ...current,
              status: "Available",
              signalCount: 0,
              lastSync: "Not connected",
              connection: null,
              health: {
                label: "Ready to connect",
                detail:
                  "The connector is available but is not ingesting evidence.",
              },
            }
          : {
              ...current,
              status: "Connected",
              lastSync: "Sync queued",
              connection: current.connection ?? {
                instance: input.action === "connect" ? input.instance : "",
                authentication: "Encrypted connector credential",
                connectedBy,
                retention: "30 days",
                permissions: ["evidence:read", "metadata:read"],
              },
              health: {
                label: "Healthy",
                detail:
                  "Connection verified. New evidence is ready for normalization.",
              },
            }
      sources = sources.map((source) =>
        source.id === updated.id ? updated : source,
      )
      return structuredClone(updated)
    },
  }
}
