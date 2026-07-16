import { createCoreHandler, type CoreHandlerOptions } from "../app"
import { createProductionGitHubPullRequestDelivery } from "./production-github-delivery"
import {
  createProductionGitHubIssueDelivery,
  type ProductionGitHubIssueDependencies,
} from "./production-github-issue"
import {
  loadProductionIncidentGraph,
  type ProductionIncidentGraphDependencies,
} from "./production-incident-graph"
import { createProductionRemediationExecutorFactory } from "./production-remediation"
import { loadProductionAgentChat, type ProductionAgentChatDependencies } from "./production-agent-chat"
import {
  createProductionGitHubActions,
  type ProductionGitHubActionsDependencies,
} from "./production-github-actions"

type Environment = Readonly<Record<string, string | undefined>>

export interface ProductionCoreDependencies {
  agentChat?: ProductionAgentChatDependencies
  incidentGraph?: ProductionIncidentGraphDependencies
  githubIssue?: ProductionGitHubIssueDependencies
  githubActions?: ProductionGitHubActionsDependencies
  createHandler?: (options: CoreHandlerOptions) => ReturnType<typeof createCoreHandler>
}

export async function createProductionCoreHandler(
  environment: Environment,
  dependencies: ProductionCoreDependencies = {},
): Promise<ReturnType<typeof createCoreHandler>> {
  const incidentGraph = await loadProductionIncidentGraph(environment, dependencies.incidentGraph)
  const agentChat = await loadProductionAgentChat(environment, dependencies.agentChat)
  const remediationExecutorFactory = createProductionRemediationExecutorFactory(environment)
  const pullRequestDelivery = createProductionGitHubPullRequestDelivery(environment)
  const issueDelivery = createProductionGitHubIssueDelivery(environment, dependencies.githubIssue)
  const githubActions = createProductionGitHubActions(environment, dependencies.githubActions)
  const createHandler = dependencies.createHandler ?? createCoreHandler

  return createHandler({
    ...(agentChat ? { agentChat } : {}),
    ...(incidentGraph ? { incidentGraph } : {}),
    ...(remediationExecutorFactory ? { remediationExecutorFactory } : {}),
    ...(pullRequestDelivery ? { pullRequestDelivery } : {}),
    ...(issueDelivery ? { issueDelivery } : {}),
    ...(githubActions ? { githubActions } : {}),
  })
}
