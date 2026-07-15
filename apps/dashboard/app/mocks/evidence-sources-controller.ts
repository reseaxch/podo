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
        (input.action === "repair" && current.status !== "Needs attention")
      )
        throw new Error("This connection action is not permitted")

      const updated: EvidenceSource = {
        ...current,
        status: "Connected",
        connection: current.connection ?? {
          instance: "podo-cloud / default workspace",
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
