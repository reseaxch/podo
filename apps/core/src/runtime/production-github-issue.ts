import {
  GitHubIssueAdapter,
  type GitHubIssueAdapterConfig,
  type GitHubIssueResult,
} from "@podo/plugin-github"

import type {
  IssueDeliveryConfig,
  IssueDeliveryInput,
  IssueDeliveryPort,
} from "../modules/remediation/incident-issue"

type Environment = Readonly<Record<string, string | undefined>>
type ConcreteAdapter = Pick<GitHubIssueAdapter, "create">

export interface ProductionGitHubIssueDependencies {
  createAdapter?: (config: GitHubIssueAdapterConfig) => ConcreteAdapter
}

export class ProductionGitHubIssueConfigError extends Error {
  readonly code = "invalid_production_github_issue_config"
  constructor() {
    super("invalid_production_github_issue_config")
    this.name = "ProductionGitHubIssueConfigError"
  }
}

export function createProductionGitHubIssueDelivery(
  environment: Environment,
  dependencies: ProductionGitHubIssueDependencies = {},
): IssueDeliveryConfig | undefined {
  const enabled = environment.PODO_GITHUB_ISSUE_ENABLED
  if (enabled === undefined || enabled === "false") return undefined
  if (enabled !== "true") throw invalidConfig()
  const token = required(environment.PODO_GITHUB_TOKEN, 8_192)
  const repositoryIdentity = required(environment.PODO_GITHUB_REPOSITORY, 201)
  const [owner, repository, extra] = repositoryIdentity.split("/")
  if (!owner || !repository || extra !== undefined
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/.test(owner)
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository)) throw invalidConfig()
  try {
    const adapter = (dependencies.createAdapter ?? ((config) => new GitHubIssueAdapter(config)))({
      token,
      repository: { owner, name: repository },
    })
    return {
      expectedRepository: repositoryIdentity,
      port: new ProductionGitHubIssuePort(adapter),
    }
  } catch {
    throw invalidConfig()
  }
}

class ProductionGitHubIssuePort implements IssueDeliveryPort {
  constructor(private readonly adapter: ConcreteAdapter) {}

  async create(input: IssueDeliveryInput): Promise<unknown> {
    const result = await this.adapter.create({
      authorization: {
        kind: input.authorization.kind,
        decision: "authorized",
        authorizationId: input.authorization.authorizationId,
        authorizedAt: input.authorization.authorizedAt,
      },
      draftId: input.draft.id,
      idempotencyKey: input.draft.idempotencyKey,
      content: input.draft.content,
      contentSha256: input.draft.contentSha256,
    })
    return toCoreResult(result)
  }
}

function toCoreResult(result: GitHubIssueResult): unknown {
  return {
    provider: "github",
    status: result.status,
    repository: `${result.repository.owner}/${result.repository.name}`,
    number: result.issue.number,
    url: result.issue.url,
    state: result.issue.state,
    draft: { ...result.draft },
    authorization: { ...result.authorization },
    incident: { ...result.incident, evidenceIds: [...result.incident.evidenceIds] },
  }
}

function required(value: string | undefined, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
    || value !== value.trim() || value.includes("\0")) throw invalidConfig()
  return value
}

function invalidConfig(): ProductionGitHubIssueConfigError {
  return new ProductionGitHubIssueConfigError()
}
