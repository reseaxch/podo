import { createCoreHandler, type CoreHandlerOptions } from "../app"
import { createProductionGitHubPullRequestDelivery } from "./production-github-delivery"
import {
  loadProductionIncidentGraph,
  type ProductionIncidentGraphDependencies,
} from "./production-incident-graph"
import { createProductionRemediationExecutorFactory } from "./production-remediation"

type Environment = Readonly<Record<string, string | undefined>>

export interface ProductionCoreDependencies {
  incidentGraph?: ProductionIncidentGraphDependencies
  createHandler?: (options: CoreHandlerOptions) => ReturnType<typeof createCoreHandler>
}

export async function createProductionCoreHandler(
  environment: Environment,
  dependencies: ProductionCoreDependencies = {},
): Promise<ReturnType<typeof createCoreHandler>> {
  const incidentGraph = await loadProductionIncidentGraph(environment, dependencies.incidentGraph)
  const remediationExecutorFactory = createProductionRemediationExecutorFactory(environment)
  const pullRequestDelivery = createProductionGitHubPullRequestDelivery(environment)
  const createHandler = dependencies.createHandler ?? createCoreHandler

  return createHandler({
    ...(incidentGraph ? { incidentGraph } : {}),
    ...(remediationExecutorFactory ? { remediationExecutorFactory } : {}),
    ...(pullRequestDelivery ? { pullRequestDelivery } : {}),
  })
}
