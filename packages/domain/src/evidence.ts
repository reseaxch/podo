import type { EvidenceReference } from "./index"

declare const evidenceIdBrand: unique symbol

export type EvidenceId = string & { readonly [evidenceIdBrand]: true }

export interface PromptEvidence {
  id: EvidenceId
  sourceType: EvidenceReference["sourceType"]
  content: string
}

export interface EvidenceClaim {
  claim: string
  evidenceIds: readonly EvidenceId[]
}

export interface EvidenceValidation {
  valid: boolean
  errors: readonly string[]
}

const EVIDENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function createEvidenceId(value: string): EvidenceId {
  if (!EVIDENCE_ID_PATTERN.test(value)) {
    throw new Error("Evidence id must be 1-128 safe identifier characters")
  }
  return value as EvidenceId
}

export function formatUntrustedEvidence(evidence: readonly PromptEvidence[]): string {
  const json = JSON.stringify(evidence).replace(/[<>&]/g, (character) => {
    if (character === "<") return "\\u003c"
    if (character === ">") return "\\u003e"
    return "\\u0026"
  })
  return `<untrusted_evidence_json>${json}</untrusted_evidence_json>`
}

export function validateEvidenceClaims(
  claims: readonly EvidenceClaim[],
  evidence: readonly PromptEvidence[],
): EvidenceValidation {
  const errors: string[] = []
  const firstIndexById = new Map<EvidenceId, number>()

  for (const [index, item] of evidence.entries()) {
    const firstIndex = firstIndexById.get(item.id)
    if (firstIndex !== undefined) {
      errors.push(`Duplicate evidence id ${item.id} at evidence index ${index} (first seen at ${firstIndex})`)
    } else {
      firstIndexById.set(item.id, index)
    }
  }

  const knownIds = new Set(firstIndexById.keys())

  for (const [index, claim] of claims.entries()) {
    if (claim.evidenceIds.length === 0) {
      errors.push(`Claim ${index} has no evidence references`)
      continue
    }
    for (const id of claim.evidenceIds) {
      if (!knownIds.has(id)) errors.push(`Claim ${index} references unknown evidence id ${id}`)
    }
  }

  return { valid: errors.length === 0, errors }
}
