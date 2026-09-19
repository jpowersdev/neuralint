import * as Schema from "effect/Schema"

export const RuleId = Schema.NonEmptyString.pipe(Schema.brand("RuleId"))
export type RuleId = typeof RuleId.Type

export const Severity = Schema.Literals(["info", "warning", "error", "critical"])
export type Severity = typeof Severity.Type

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

export const ReviewRule = Schema.Struct({
  version: Schema.Literal(1),
  id: RuleId,
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  severity: Severity,
  scope: RuleScope,
  instructions: Schema.NonEmptyString,
  criteria: RuleCriteria,
  thresholds: RuleThresholds
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
}

export interface DiffSet {
  readonly base: string
  readonly head: string
  readonly files: ReadonlyArray<FileDiff>
}

export const FindingStatus = Schema.Literals(["violation", "inconclusive"])
export type FindingStatus = typeof FindingStatus.Type

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
  hunkHeader: Schema.String,
  relevantDiff: Schema.String,
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
