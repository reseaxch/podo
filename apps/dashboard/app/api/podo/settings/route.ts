import type { UpdateSettingsRequest } from "@podo/contracts"
import { NextResponse } from "next/server"

import { createDashboardClient } from "../../../lib/dashboard-client"

export async function GET() {
  return NextResponse.json(await createDashboardClient().getSettings())
}

export async function PATCH(request: Request) {
  const input = (await request.json()) as UpdateSettingsRequest
  return NextResponse.json(await createDashboardClient().updateSettings(input))
}
