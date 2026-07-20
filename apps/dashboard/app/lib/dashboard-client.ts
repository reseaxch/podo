import { createPodoClient } from "@podo/client"

export function createDashboardClient() {
  return createPodoClient({
    baseUrl: process.env.PODO_CORE_URL ?? "http://127.0.0.1:4100",
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  })
}

export function isDemoDashboard() {
  return process.env.PODO_DASHBOARD_MODE === "demo"
}

/**
 * Deployment-level capability for a single-operator, trusted-network install.
 * This is deliberately server-only and is not a substitute for authentication.
 */
export function isTrustedOperatorMode() {
  return (
    process.env.PODO_DASHBOARD_MODE === "live" &&
    process.env.PODO_TRUSTED_OPERATOR_MODE === "true"
  )
}

function requestOrigin(request: Request) {
  const host = request.headers.get("host")
  if (!host) return new URL(request.url).origin
  const protocol = new URL(request.url).protocol
  return `${protocol}//${host}`
}

export function trustedMutationRequestError(request: Request) {
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return { status: 415, error: "json_required" } as const
  const origin = request.headers.get("origin")
  if (origin && origin !== requestOrigin(request))
    return { status: 403, error: "cross_origin_request" } as const
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return { status: 403, error: "cross_origin_request" } as const
  return null
}

export function incidentWorkingDirectory() {
  return process.env.PODO_INCIDENT_CWD ?? process.cwd()
}
