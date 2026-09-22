import { createHash } from "node:crypto"

import * as Effect from "effect/Effect"

import * as ChangedSpan from "./ChangedSpan.js"
import * as Domain from "./Domain.js"
import * as RuleCatalog from "./RuleCatalog.js"
import * as TreeSitterEvidence from "./TreeSitterEvidence.js"

export const semanticChunksPlanner = "semantic-chunks"
export const filenamesPlanner = "filenames"
export const builtInPlanners = [semanticChunksPlanner, filenamesPlanner] as const

export type BuiltInPlanner = typeof builtInPlanners[number]
export type Partitioning = "independent-cases" | "global-unsplittable"
export type Completeness = "complete" | "partial" | "unavailable"

export interface SourceReference {
  readonly fileId: string
  readonly path: string
  readonly side: "before" | "after"
  readonly startLine: number
  readonly endLine: number
}

export interface Projection {
  readonly label: string
  readonly sources: ReadonlyArray<SourceReference>
  readonly facts?: unknown
}

export interface PlanningCoverage {
  readonly status: Completeness
  readonly basis: string
  readonly filesConsidered: number
}

export interface AssessmentCase {
  readonly id: string
  readonly planner: string
  readonly partitioning: Partitioning
  readonly subjects: ReadonlyArray<Projection>
  readonly evidence: ReadonlyArray<Projection>
  readonly completeness: PlanningCoverage
  readonly locations: ReadonlyArray<Domain.FindingLocation>
  readonly relevantDiff: string
  readonly anchor: {
    readonly file: Domain.FileDiff
    readonly hunk: Domain.DiffHunk
    readonly span: ChangedSpan.ChangedSpan
  }
}

export interface RulePlan {
  readonly rule: Domain.ReviewRule
  readonly planner: string
  readonly partitioning: Partitioning
  readonly cases: ReadonlyArray<AssessmentCase>
}

export interface Plan {
  readonly rules: ReadonlyArray<RulePlan>
  readonly diagnostics: ReadonlyArray<string>
}

export const plannerOf = (rule: Domain.ReviewRule): string =>
  rule.assessment?.planner ?? semanticChunksPlanner

const referenceOf = (
  file: Domain.FileDiff,
  span: ChangedSpan.ChangedSpan
): SourceReference => {
  if (span.newRange !== undefined) {
    return {
      fileId: file.id,
      path: file.path,
      side: "after",
      startLine: span.newRange.startLine,
      endLine: span.newRange.endLine
    }
  }
  const range = span.oldRange ?? { startLine: 1, endLine: 1 }
  return {
    fileId: file.id,
    path: file.path,
    side: "before",
    startLine: range.startLine,
    endLine: range.endLine
  }
}

const locationOf = (
  reference: SourceReference,
  role: Domain.FindingLocation["role"],
  precision: Domain.FindingLocation["precision"]
): Domain.FindingLocation => ({
  path: reference.path,
  side: reference.side === "after" ? "new" : "old",
  startLine: reference.startLine,
  endLine: reference.endLine,
  role,
  precision
})

const rangesOf = (
  file: Domain.FileDiff,
  side: "before" | "after",
  ranges: ReadonlyArray<TreeSitterEvidence.SourceRange>
): ReadonlyArray<SourceReference> => ranges.map((range) => ({
  fileId: file.id,
  path: file.path,
  side,
  startLine: range.startLine,
  endLine: range.endLine
}))

const semanticCase = (
  file: Domain.FileDiff,
  hunk: Domain.DiffHunk,
  span: ChangedSpan.ChangedSpan,
  bundle: TreeSitterEvidence.EvidenceBundle | undefined
): AssessmentCase => {
  const subject = referenceOf(file, span)
  const side = subject.side
  const syntaxSources = bundle === undefined
    ? []
    : rangesOf(file, side, [bundle.localBlock, ...bundle.scopes, ...bundle.comments])
  return {
    id: span.id,
    planner: semanticChunksPlanner,
    partitioning: "independent-cases",
    subjects: [{
      label: "changed semantic span",
      sources: [subject],
      facts: {
        before: span.before,
        after: span.after,
        localContext: [span.contextBefore, span.contextAfter].filter((part) => part !== "").join("\n")
      }
    }],
    evidence: bundle === undefined ? [] : [{
      label: "bounded Tree-sitter scopes and associated comments",
      sources: syntaxSources,
      facts: { source: TreeSitterEvidence.renderCompact(bundle) }
    }],
    completeness: {
      status: "complete",
      basis: bundle === undefined
        ? "the changed span and bounded lexical context were assessed; no supported syntax bundle was available"
        : "the changed span, bounded enclosing syntax scopes, and associated comments were assessed",
      filesConsidered: 1
    },
    locations: [locationOf(subject, "primary", "span")],
    relevantDiff: span.primaryPatch,
    anchor: { file, hunk, span }
  }
}

const statusOf = (file: Domain.FileDiff): "added" | "modified" | "deleted" | "renamed" => {
  if (file.oldPath === "/dev/null") return "added"
  if (file.newPath === "/dev/null") return "deleted"
  if (file.oldPath !== file.newPath) return "renamed"
  return "modified"
}

const filenameLine = (file: Domain.FileDiff): string => {
  const status = statusOf(file).padEnd(8, " ")
  return file.oldPath !== file.newPath && file.oldPath !== "/dev/null" && file.newPath !== "/dev/null"
    ? `${status} ${file.oldPath} → ${file.newPath}`
    : `${status} ${file.path}`
}

const filenameCase = (
  files: ReadonlyArray<Domain.FileDiff>,
  anchors: ReadonlyArray<AssessmentCase["anchor"]>
): AssessmentCase | undefined => {
  const anchor = anchors[0]
  if (anchor === undefined) return undefined
  const manifest = files.map((file) => ({
    fileId: file.id,
    status: statusOf(file),
    path: file.path,
    ...(file.oldPath !== file.newPath ? { oldPath: file.oldPath, newPath: file.newPath } : {})
  }))
  const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 16)
  const subjects = anchors.map(({ file, span }) => {
    const source = referenceOf(file, span)
    return {
      label: "selected file",
      sources: [source],
      facts: { fileId: file.id, status: statusOf(file), path: file.path }
    } satisfies Projection
  })
  return {
    id: `FILENAMES:${digest}`,
    planner: filenamesPlanner,
    partitioning: "global-unsplittable",
    subjects,
    evidence: [{
      label: "complete selected file manifest",
      sources: [],
      facts: { files: manifest, rendered: files.map(filenameLine).join("\n") }
    }],
    completeness: {
      status: "complete",
      basis: "all files in the caller-selected collection matching the rule scope were listed",
      filesConsidered: files.length
    },
    locations: subjects.flatMap((subject) => subject.sources.map((source) =>
      locationOf(source, "primary", "span"))),
    relevantDiff: files.map(filenameLine).join("\n"),
    anchor
  }
}

const anchorsFor = (file: Domain.FileDiff): ReadonlyArray<AssessmentCase["anchor"]> => {
  const hunkById = new Map(file.hunks.map((hunk) => [hunk.id, hunk]))
  return ChangedSpan.extractFile(file).flatMap((span) => {
    const hunk = hunkById.get(span.parentHunkId)
    return hunk === undefined ? [] : [{ file, hunk, span }]
  })
}

export const plan = Effect.fn("AssessmentPlanner.plan")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>
) {
  const diagnostics: Array<string> = []
  const casesByRule = new Map<Domain.RuleId, Array<AssessmentCase>>()
  const plannerByRule = new Map<Domain.RuleId, string>()
  const anchorsByFile = new Map<string, ReadonlyArray<AssessmentCase["anchor"]>>()
  for (const file of diff.files) anchorsByFile.set(file.id, anchorsFor(file))

  for (const rule of rules) {
    const planner = plannerOf(rule)
    plannerByRule.set(rule.id, planner)
    casesByRule.set(rule.id, [])
    if (!builtInPlanners.some((candidate) => candidate === planner)) {
      diagnostics.push(`rule ${rule.id} names unavailable assessment planner ${planner}`)
    }
  }

  const semanticRules = rules.filter((rule) => plannerOf(rule) === semanticChunksPlanner)
  for (const file of diff.files) {
    const matching = semanticRules.filter((rule) => RuleCatalog.appliesToPath(rule, file.path))
    if (matching.length === 0) continue
    const anchors = anchorsByFile.get(file.id) ?? []
    const newTargets = anchors.flatMap(({ span }) =>
      span.newRange !== undefined && file.newSource !== undefined ? [{ id: span.id, range: span.newRange }] : [])
    const oldTargets = anchors.flatMap(({ span }) =>
      span.newRange === undefined && span.oldRange !== undefined && file.oldSource !== undefined
        ? [{ id: span.id, range: span.oldRange }]
        : [])
    const newBundles = file.newSource === undefined ? new Map() : yield* Effect.promise(() =>
      TreeSitterEvidence.buildMany(file.path, file.newSource!, newTargets).catch(() => new Map()))
    const oldBundles = file.oldSource === undefined ? new Map() : yield* Effect.promise(() =>
      TreeSitterEvidence.buildMany(file.path, file.oldSource!, oldTargets).catch(() => new Map()))
    for (const anchor of anchors) {
      const bundle = anchor.span.newRange === undefined
        ? oldBundles.get(anchor.span.id)
        : newBundles.get(anchor.span.id)
      const planned = semanticCase(file, anchor.hunk, anchor.span, bundle)
      for (const rule of matching) casesByRule.get(rule.id)?.push(planned)
    }
  }

  for (const rule of rules.filter((candidate) => plannerOf(candidate) === filenamesPlanner)) {
    const files = diff.files.filter((file) => RuleCatalog.appliesToPath(rule, file.path))
    const anchors = files.flatMap((file) => (anchorsByFile.get(file.id) ?? []).slice(0, 1))
    const planned = filenameCase(files, anchors)
    if (planned !== undefined) casesByRule.get(rule.id)?.push(planned)
  }

  const plans = rules.map((rule): RulePlan => {
    const planner = plannerByRule.get(rule.id) ?? semanticChunksPlanner
    return {
      rule,
      planner,
      partitioning: planner === filenamesPlanner ? "global-unsplittable" : "independent-cases",
      cases: casesByRule.get(rule.id) ?? []
    }
  })
  return { rules: plans, diagnostics } satisfies Plan
})

export const renderCase = (assessment: AssessmentCase): string => JSON.stringify({
  planner: assessment.planner,
  subjects: assessment.subjects,
  evidence: assessment.evidence,
  completeness: assessment.completeness
})
