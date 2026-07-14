import { loadScenarios } from "./scenarios"

const scenarios = await loadScenarios()
console.log(
  JSON.stringify(
    {
      status: "ok",
      scenarioCount: scenarios.length,
      scenarios: scenarios.map(({ id, kind, expected }) => ({
        id,
        kind,
        expectedDelivery: expected.delivery,
      })),
    },
    null,
    2,
  ),
)
