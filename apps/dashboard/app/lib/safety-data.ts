import { safetyApprovalsMock } from "../mocks/safety"
import type { SafetyApprovalsViewModel } from "./safety-types"

export function getSafetyApprovals(): SafetyApprovalsViewModel {
  return structuredClone(safetyApprovalsMock)
}
