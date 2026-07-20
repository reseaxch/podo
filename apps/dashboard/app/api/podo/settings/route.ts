import type { UpdateSettingsRequest } from "@podo/contracts"
import { NextResponse } from "next/server"

import {
  createDashboardClient,
  isTrustedOperatorMode,
  trustedMutationRequestError,
} from "../../../lib/dashboard-client"

export async function GET() {
  return NextResponse.json(await createDashboardClient().getSettings())
}

export async function PATCH(request: Request) {
  if (!isTrustedOperatorMode())
    return NextResponse.json(
      {
        error: "trusted_operator_mode_required",
        message:
          "Settings changes require an explicitly trusted private deployment.",
      },
      { status: 405, headers: { allow: "GET" } },
    )
  const requestError = trustedMutationRequestError(request)
  if (requestError)
    return NextResponse.json(
      { error: requestError.error },
      { status: requestError.status },
    )
  let value: unknown
  try {
    value = await request.json()
  } catch {
    value = null
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return NextResponse.json({ error: "invalid_settings" }, { status: 400 })
  const candidate = value as Record<string, unknown>
  const allowed = new Set([
    "autonomyMode",
    "monitoringEnabled",
    "defaultSandbox",
    "turnTimeoutMs",
  ])
  if (
    Object.keys(candidate).some((key) => !allowed.has(key)) ||
    (candidate.autonomyMode !== undefined &&
      !["observe", "recommend", "act_with_approval"].includes(
        String(candidate.autonomyMode),
      )) ||
    (candidate.monitoringEnabled !== undefined &&
      typeof candidate.monitoringEnabled !== "boolean") ||
    (candidate.defaultSandbox !== undefined &&
      !["read-only", "workspace-write"].includes(
        String(candidate.defaultSandbox),
      )) ||
    (candidate.turnTimeoutMs !== undefined &&
      (!Number.isInteger(candidate.turnTimeoutMs) ||
        Number(candidate.turnTimeoutMs) < 1000 ||
        Number(candidate.turnTimeoutMs) > 3_600_000))
  )
    return NextResponse.json({ error: "invalid_settings" }, { status: 400 })
  const input = candidate as UpdateSettingsRequest
  return NextResponse.json(await createDashboardClient().updateSettings(input))
}
