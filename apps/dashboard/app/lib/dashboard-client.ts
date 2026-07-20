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

function configuredDashboardOrigin() {
  const value = process.env.PODO_DASHBOARD_ORIGIN
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    )
      return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Deployment-level capability for a single-operator, trusted-network install.
 * This is deliberately server-only and is not a substitute for authentication.
 */
export function isTrustedOperatorMode() {
  return (
    process.env.PODO_DASHBOARD_MODE === "live" &&
    process.env.PODO_TRUSTED_OPERATOR_MODE === "true" &&
    configuredDashboardOrigin() !== null
  )
}

export function trustedMutationRequestError(request: Request) {
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return { status: 415, error: "json_required" } as const
  const trustedOrigin = configuredDashboardOrigin()
  if (!trustedOrigin)
    return { status: 503, error: "trusted_origin_not_configured" } as const
  const origin = request.headers.get("origin")
  if (!origin) return { status: 403, error: "trusted_origin_required" } as const
  if (origin !== trustedOrigin)
    return { status: 403, error: "cross_origin_request" } as const
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return { status: 403, error: "cross_origin_request" } as const
  return null
}

export function incidentWorkingDirectory() {
  return process.env.PODO_INCIDENT_CWD ?? process.cwd()
}
