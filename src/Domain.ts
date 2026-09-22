import * as Schema from "effect/Schema"

export const RuleId = Schema.NonEmptyString.pipe(Schema.brand("RuleId"))
export type RuleId = typeof RuleId.Type

export const Severity = Schema.Literals(["info", "warning", "error", "critical"])
export type Severity = typeof Severity.Type

export const FailOn = Schema.Literals(["info", "warning", "error", "critical", "never"])
export type FailOn = typeof FailOn.Type

export const RuleScope = Schema.Struct({
  include: Schema.Array(Schema.NonEmptyString),
  exclude: Schema.Array(Schema.NonEmptyString)
})
export type RuleScope = typeof RuleScope.Type

export const RuleCriteria = Schema.Struct({
  violation: Schema.NonEmptyString,
  compliant: Schema.NonEmptyString
})
export type RuleCriteria = typeof RuleCriteria.Type

export const RuleThresholds = Schema.Struct({
  screenAt: Schema.Number,
  violationAt: Schema.Number
})
export type RuleThresholds = typeof RuleThresholds.Type

export const RuleEvidenceScope = Schema.Literals([
  "changed-span",
  "enclosing-symbol",
  "complete-file",
  "related-definitions",
  "repository"
])
export type RuleEvidenceScope = typeof RuleEvidenceScope.Type

export const RuleExample = Schema.Struct({
  outcome: Schema.Literals(["violation", "nonviolation"]),
  explanation: Schema.NonEmptyString,
  code: Schema.NonEmptyString
})
export type RuleExample = typeof RuleExample.Type

export const RuleSemanticGuidance = Schema.Struct({
  context: Schema.NonEmptyString,
  reportWhen: Schema.NonEmptyString,
  doNotReport: Schema.NonEmptyString,
  guidance: Schema.NonEmptyString,
  evidence: RuleEvidenceScope,
  examples: Schema.Array(RuleExample)
})
export type RuleSemanticGuidance = typeof RuleSemanticGuidance.Type

export const RuleDiagnostic = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString
})
export type RuleDiagnostic = typeof RuleDiagnostic.Type

export const ReviewRule = Schema.Struct({
  version: Schema.Literal(1),
  id: RuleId,
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  severity: Severity,
  scope: RuleScope,
  instructions: Schema.NonEmptyString,
  criteria: RuleCriteria,
  thresholds: RuleThresholds,
  semantic: Schema.optionalKey(RuleSemanticGuidance),
  diagnostics: Schema.optionalKey(Schema.Array(RuleDiagnostic))
})
export type ReviewRule = typeof ReviewRule.Type

export interface DiffHunk {
  readonly id: string
  readonly header: string
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly patch: string
}

export interface FileDiff {
  readonly id: string
  readonly oldPath: string
  readonly newPath: string
  readonly path: string
  readonly hunks: ReadonlyArray<DiffHunk>
  readonly patch: string
  readonly oldSource?: string
  readonly newSource?: string
}

export interface DiffSet {
  readonly base: string
  readonly head: string
  readonly files: ReadonlyArray<FileDiff>
}

export const FindingStatus = Schema.Literals(["violation", "inconclusive"])
export type FindingStatus = typeof FindingStatus.Type

export const FindingLocation = Schema.Struct({
  path: Schema.String,
  side: Schema.Literals(["old", "new"]),
  startLine: Schema.Number,
  endLine: Schema.Number,
  role: Schema.Literals(["primary", "evidence"]),
  precision: Schema.Literals(["line", "span", "hunk", "symbol"])
})
export type FindingLocation = typeof FindingLocation.Type

export const Finding = Schema.Struct({
  ruleId: RuleId,
  ruleTitle: Schema.String,
  ruleDescription: Schema.String,
  violationCondition: Schema.String,
  complianceCondition: Schema.String,
  severity: Severity,
  status: FindingStatus,
  path: Schema.String,
  hunkId: Schema.String,
  spanId: Schema.optionalKey(Schema.String),
  hunkHeader: Schema.String,
  relevantDiff: Schema.String,
  locations: Schema.optionalKey(Schema.Array(FindingLocation)),
  screeningProbability: Schema.Number,
  violationProbability: Schema.Number
})
export type Finding = typeof Finding.Type

export const ReviewUsage = Schema.Struct({
  requests: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number
})
export type ReviewUsage = typeof ReviewUsage.Type

export const ReviewReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  base: Schema.String,
  head: Schema.String,
  filesReviewed: Schema.Number,
  rulesLoaded: Schema.Number,
  findings: Schema.Array(Finding),
  usage: ReviewUsage
})
export type ReviewReport = typeof ReviewReport.Type

export class ProjectConfigError extends Schema.TaggedError<ProjectConfigError>()(
  "ProjectConfigError",
  {
    path: Schema.String,
    message: Schema.String
  }
) {}

export class RuleCatalogError extends Schema.TaggedError<RuleCatalogError>()(
  "RuleCatalogError",
  {
    path: Schema.String,
    message: Schema.String
  }
) {}

export class GitError extends Schema.TaggedError<GitError>()(
  "GitError",
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export class ReviewError extends Schema.TaggedError<ReviewError>()(
  "ReviewError",
  {
    stage: Schema.String,
    message: Schema.String
  }
) {}

export class RuleDoctorError extends Schema.TaggedError<RuleDoctorError>()(
  "RuleDoctorError",
  {
    stage: Schema.String,
    message: Schema.String
  }
) {}
