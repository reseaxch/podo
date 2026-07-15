import {
  createEvidenceId,
  validateEvidenceClaims,
  type EvidenceId,
  type PromptEvidence,
} from "./evidence"

export const STRUCTURED_DIAGNOSIS_SCHEMA_VERSION = "podo.diagnosis.v1" as const
export const DIAGNOSIS_CONFIDENCE_MIN = 0
export const DIAGNOSIS_CONFIDENCE_MAX = 10_000

export interface DiagnosisConfidence {
  value: number
  scale: "basis_points"
}

export interface StructuredDiagnosis {
  schemaVersion: typeof STRUCTURED_DIAGNOSIS_SCHEMA_VERSION
  summary: string
  affectedService: string
  probableRootCause: string
  confidence: DiagnosisConfidence
  evidenceIds: EvidenceId[]
  recommendedAction: string
  safeToAttemptFix: boolean
}

export type DiagnosisParseErrorCode =
  | "input_not_string"
  | "invalid_json"
  | "expected_object"
  | "missing_field"
  | "unknown_field"
  | "invalid_type"
  | "invalid_literal"
  | "empty_string"
  | "empty_array"
  | "out_of_range"
  | "unsafe_evidence_id"
  | "duplicate_evidence_id"
  | "evidence_validation_failed"

export interface DiagnosisParseError {
  code: DiagnosisParseErrorCode
  path: string
  message: string
}

export type StructuredDiagnosisParseResult =
  | { ok: true; diagnosis: StructuredDiagnosis }
  | { ok: false; errors: DiagnosisParseError[] }

const DIAGNOSIS_FIELDS = [
  "schemaVersion",
  "summary",
  "affectedService",
  "probableRootCause",
  "confidence",
  "evidenceIds",
  "recommendedAction",
  "safeToAttemptFix",
] as const

const DIAGNOSIS_FIELD_SET = new Set<string>(DIAGNOSIS_FIELDS)
const CONFIDENCE_FIELDS = ["value", "scale"] as const
const CONFIDENCE_FIELD_SET = new Set<string>(CONFIDENCE_FIELDS)

export function parseStructuredDiagnosis(
  input: unknown,
  evidence: readonly PromptEvidence[],
): StructuredDiagnosisParseResult {
  if (typeof input !== "string") {
    return invalid("input_not_string", "$", "Diagnosis input must be a JSON string")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return invalid("invalid_json", "$", "Diagnosis input must contain exactly one valid JSON value")
  }

  if (!isRecord(parsed)) {
    return invalid("expected_object", "$", "Diagnosis JSON root must be an object")
  }

  const errors: DiagnosisParseError[] = []
  appendShapeErrors(parsed, DIAGNOSIS_FIELDS, DIAGNOSIS_FIELD_SET, "$", errors)

  const schemaVersion = readSchemaVersion(parsed, errors)
  const summary = readNonEmptyString(parsed, "summary", errors)
  const affectedService = readNonEmptyString(parsed, "affectedService", errors)
  const probableRootCause = readNonEmptyString(parsed, "probableRootCause", errors)
  const confidence = readConfidence(parsed, errors)
  const evidenceIds = readEvidenceIds(parsed, evidence, errors)
  const recommendedAction = readNonEmptyString(parsed, "recommendedAction", errors)
  const safeToAttemptFix = readBoolean(parsed, "safeToAttemptFix", errors)

  if (
    errors.length > 0
    || schemaVersion === undefined
    || summary === undefined
    || affectedService === undefined
    || probableRootCause === undefined
    || confidence === undefined
    || evidenceIds === undefined
    || recommendedAction === undefined
    || safeToAttemptFix === undefined
  ) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    diagnosis: {
      schemaVersion,
      summary,
      affectedService,
      probableRootCause,
      confidence,
      evidenceIds,
      recommendedAction,
      safeToAttemptFix,
    },
  }
}

function readSchemaVersion(
  input: Record<string, unknown>,
  errors: DiagnosisParseError[],
): typeof STRUCTURED_DIAGNOSIS_SCHEMA_VERSION | undefined {
  if (!("schemaVersion" in input)) return undefined
  if (typeof input.schemaVersion !== "string") {
    errors.push(error("invalid_type", "$.schemaVersion", "schemaVersion must be a string"))
    return undefined
  }
  if (input.schemaVersion !== STRUCTURED_DIAGNOSIS_SCHEMA_VERSION) {
    errors.push(error("invalid_literal", "$.schemaVersion", `schemaVersion must equal ${STRUCTURED_DIAGNOSIS_SCHEMA_VERSION}`))
    return undefined
  }
  return STRUCTURED_DIAGNOSIS_SCHEMA_VERSION
}

function readNonEmptyString<Key extends "summary" | "affectedService" | "probableRootCause" | "recommendedAction">(
  input: Record<string, unknown>,
  key: Key,
  errors: DiagnosisParseError[],
): string | undefined {
  if (!(key in input)) return undefined
  const value = input[key]
  if (typeof value !== "string") {
    errors.push(error("invalid_type", `$.${key}`, `${key} must be a string`))
    return undefined
  }
  if (value.trim().length === 0) {
    errors.push(error("empty_string", `$.${key}`, `${key} must not be empty`))
    return undefined
  }
  return value
}

function readConfidence(
  input: Record<string, unknown>,
  errors: DiagnosisParseError[],
): DiagnosisConfidence | undefined {
  if (!("confidence" in input)) return undefined
  const value = input.confidence
  if (!isRecord(value)) {
    errors.push(error("invalid_type", "$.confidence", "confidence must be an object"))
    return undefined
  }

  appendShapeErrors(value, CONFIDENCE_FIELDS, CONFIDENCE_FIELD_SET, "$.confidence", errors)

  let confidenceValue: number | undefined
  if ("value" in value) {
    if (typeof value.value !== "number") {
      errors.push(error("invalid_type", "$.confidence.value", "confidence.value must be a number"))
    } else if (
      !Number.isSafeInteger(value.value)
      || value.value < DIAGNOSIS_CONFIDENCE_MIN
      || value.value > DIAGNOSIS_CONFIDENCE_MAX
    ) {
      errors.push(error(
        "out_of_range",
        "$.confidence.value",
        `confidence.value must be an integer from ${DIAGNOSIS_CONFIDENCE_MIN} to ${DIAGNOSIS_CONFIDENCE_MAX}`,
      ))
    } else {
      confidenceValue = value.value
    }
  }

  let scale: DiagnosisConfidence["scale"] | undefined
  if ("scale" in value) {
    if (typeof value.scale !== "string") {
      errors.push(error("invalid_type", "$.confidence.scale", "confidence.scale must be a string"))
    } else if (value.scale !== "basis_points") {
      errors.push(error("invalid_literal", "$.confidence.scale", "confidence.scale must equal basis_points"))
    } else {
      scale = value.scale
    }
  }

  return confidenceValue === undefined || scale === undefined
    ? undefined
    : { value: confidenceValue, scale }
}

function readEvidenceIds(
  input: Record<string, unknown>,
  evidence: readonly PromptEvidence[],
  errors: DiagnosisParseError[],
): EvidenceId[] | undefined {
  if (!("evidenceIds" in input)) return undefined
  if (!Array.isArray(input.evidenceIds)) {
    errors.push(error("invalid_type", "$.evidenceIds", "evidenceIds must be an array"))
    return undefined
  }
  if (input.evidenceIds.length === 0) {
    errors.push(error("empty_array", "$.evidenceIds", "evidenceIds must contain at least one id"))
    return undefined
  }

  const ids: EvidenceId[] = []
  const firstIndexById = new Map<EvidenceId, number>()
  let entriesValid = true

  input.evidenceIds.forEach((value, index) => {
    const path = `$.evidenceIds[${index}]`
    if (typeof value !== "string") {
      errors.push(error("invalid_type", path, "Evidence id must be a string"))
      entriesValid = false
      return
    }

    let id: EvidenceId
    try {
      id = createEvidenceId(value)
    } catch {
      errors.push(error("unsafe_evidence_id", path, "Evidence id contains unsafe characters or exceeds 128 characters"))
      entriesValid = false
      return
    }

    const firstIndex = firstIndexById.get(id)
    if (firstIndex !== undefined) {
      errors.push(error("duplicate_evidence_id", path, `Evidence id duplicates index ${firstIndex}`))
    } else {
      firstIndexById.set(id, index)
    }
    ids.push(id)
  })

  if (!entriesValid) return undefined

  const validation = validateEvidenceClaims([{
    claim: "Structured diagnosis",
    evidenceIds: ids,
  }], evidence)
  for (const message of validation.errors) {
    errors.push(error("evidence_validation_failed", "$.evidenceIds", message))
  }

  return ids
}

function readBoolean<Key extends "safeToAttemptFix">(
  input: Record<string, unknown>,
  key: Key,
  errors: DiagnosisParseError[],
): boolean | undefined {
  if (!(key in input)) return undefined
  if (typeof input[key] !== "boolean") {
    errors.push(error("invalid_type", `$.${key}`, `${key} must be a boolean`))
    return undefined
  }
  return input[key]
}

function appendShapeErrors(
  input: Record<string, unknown>,
  required: readonly string[],
  allowed: ReadonlySet<string>,
  parentPath: string,
  errors: DiagnosisParseError[],
): void {
  for (const key of required) {
    if (!(key in input)) {
      errors.push(error("missing_field", propertyPath(parentPath, key), `${key} is required`))
    }
  }
  for (const key of Object.keys(input).filter((key) => !allowed.has(key)).sort()) {
    errors.push(error("unknown_field", propertyPath(parentPath, key), `${key} is not allowed`))
  }
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function error(code: DiagnosisParseErrorCode, path: string, message: string): DiagnosisParseError {
  return { code, path, message }
}

function invalid(code: DiagnosisParseErrorCode, path: string, message: string): StructuredDiagnosisParseResult {
  return { ok: false, errors: [error(code, path, message)] }
}
