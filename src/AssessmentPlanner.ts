import { createHash } from "node:crypto"
import * as path from "node:path"
import { pathToFileURL } from "node:url"

import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

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

export interface CustomPlannerDefinition {
  readonly module: string
  readonly export?: string
  readonly partitioning: Partitioning
}

export interface PlanOptions {
  readonly root?: string
  readonly customPlanners?: Readonly<Record<string, CustomPlannerDefinition>>
  readonly allowCustomPlanners?: boolean
  readonly maxCases?: number
}

const ExternalSourceReference = Schema.Struct({
  fileId: Schema.NonEmptyString,
  side: Schema.Literals(["before", "after"]),
  range: Schema.Struct({ startLine: Schema.Number, endLine: Schema.Number })
})

const ExternalProjection = Schema.Struct({
  label: Schema.NonEmptyString,
  sources: Schema.Array(ExternalSourceReference),
  facts: Schema.optionalKey(Schema.Unknown)
})

const ExternalCoverage = Schema.Struct({
  status: Schema.Literals(["complete", "partial", "unavailable"]),
  basis: Schema.NonEmptyString,
  filesConsidered: Schema.Number
})

const ExternalAssessmentCase = Schema.Struct({
  id: Schema.NonEmptyString,
  subjects: Schema.Array(ExternalProjection),
  evidence: Schema.Array(ExternalProjection),
  completeness: ExternalCoverage
})

const ExternalPlannerResultSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planner: Schema.NonEmptyString,
  cases: Schema.Array(ExternalAssessmentCase),
  coverage: ExternalCoverage
})

export type PlannerResult = typeof ExternalPlannerResultSchema.Type

export interface PlannerRequest {
  readonly schemaVersion: 1
  readonly ruleId: string
  readonly collection: {
    readonly schemaVersion: 1
    readonly id: string
    readonly source: "git-delta" | "explicit-files" | "editor" | "snapshot"
    readonly base?: string
    readonly head?: string
    readonly files: ReadonlyArray<{
      readonly id: string
      readonly path: string
      readonly oldPath?: string
      readonly status: "added" | "modified" | "deleted" | "renamed" | "unchanged"
      readonly before?: string
      readonly after?: string
      readonly changedRanges: ReadonlyArray<{
        readonly old?: { readonly startLine: number; readonly endLine: number }
        readonly new?: { readonly startLine: number; readonly endLine: number }
      }>
    }>
  }
  readonly limits: { readonly maxCases: number }
}

export type PlannerFunction = (request: PlannerRequest) => PlannerResult | Promise<PlannerResult>

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

const plannerRequest = (
  diff: Domain.DiffSet,
  rule: Domain.ReviewRule,
  anchorsByFile: ReadonlyMap<string, ReadonlyArray<AssessmentCase["anchor"]>>,
  maxCases: number
): PlannerRequest => ({
  schemaVersion: 1,
  ruleId: rule.id,
  collection: {
    schemaVersion: 1,
    id: `${diff.base}..${diff.head}`,
    source: diff.base === "stdin" ? "editor" : "git-delta",
    base: diff.base,
    head: diff.head,
    files: diff.files.map((file) => ({
      id: file.id,
      path: file.path,
      ...(file.oldPath !== file.path ? { oldPath: file.oldPath } : {}),
      status: statusOf(file),
      ...(file.oldSource === undefined ? {} : { before: file.oldSource }),
      ...(file.newSource === undefined ? {} : { after: file.newSource }),
      changedRanges: (anchorsByFile.get(file.id) ?? []).map(({ span }) => ({
        ...(span.oldRange === undefined ? {} : { old: span.oldRange }),
        ...(span.newRange === undefined ? {} : { new: span.newRange })
      }))
    }))
  },
  limits: { maxCases }
})

const insideRoot = (root: string, filename: string): boolean => {
  const relative = path.relative(root, filename)
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
}

const normalizeCustomResult = (
  planner: string,
  definition: CustomPlannerDefinition,
  result: PlannerResult,
  diff: Domain.DiffSet,
  anchorsByFile: ReadonlyMap<string, ReadonlyArray<AssessmentCase["anchor"]>>,
  maxCases: number
): ReadonlyArray<AssessmentCase> => {
  if (result.planner !== planner) throw new Error(`returned planner ${result.planner} instead of ${planner}`)
  if (result.coverage.status !== "complete") {
    throw new Error(`returned ${result.coverage.status} collection coverage: ${result.coverage.basis}`)
  }
  if (result.cases.length > maxCases) throw new Error(`returned ${result.cases.length} cases, above maxCases ${maxCases}`)
  const fileById = new Map(diff.files.map((file) => [file.id, file]))
  const seen = new Set<string>()
  const normalizeProjection = (projection: typeof ExternalProjection.Type): Projection => {
    if (projection.sources.length === 0) throw new Error(`projection ${projection.label} has no source references`)
    const sources = projection.sources.map((source): SourceReference => {
      const file = fileById.get(source.fileId)
      if (file === undefined) throw new Error(`projection ${projection.label} references unknown file ${source.fileId}`)
      const text = source.side === "after" ? file.newSource : file.oldSource
      if (text === undefined) throw new Error(`projection ${projection.label} references unavailable ${source.side} content for ${file.path}`)
      const lines = text.split("\n").length
      const { startLine, endLine } = source.range
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines) {
        throw new Error(`projection ${projection.label} has invalid ${startLine}-${endLine} range for ${file.path} (${lines} lines)`)
      }
      return { fileId: file.id, path: file.path, side: source.side, startLine, endLine }
    })
    if (projection.facts !== undefined) {
      const encoded = JSON.stringify(projection.facts)
      if (encoded === undefined) throw new Error(`projection ${projection.label} facts are not JSON serializable`)
    }
    return {
      label: projection.label,
      sources,
      ...(projection.facts === undefined ? {} : { facts: projection.facts })
    }
  }
  return result.cases.map((item): AssessmentCase => {
    if (seen.has(item.id)) throw new Error(`returned duplicate case id ${item.id}`)
    seen.add(item.id)
    if (item.subjects.length === 0) throw new Error(`case ${item.id} has no subjects`)
    if (item.completeness.status !== "complete") {
      throw new Error(`case ${item.id} is ${item.completeness.status}: ${item.completeness.basis}`)
    }
    const subjects = item.subjects.map(normalizeProjection)
    const evidence = item.evidence.map(normalizeProjection)
    const subjectSources = subjects.flatMap((subject) => subject.sources)
    const anchors = subjectSources.map((source) => {
      const candidates = anchorsByFile.get(source.fileId) ?? []
      const anchor = candidates.find(({ span }) => {
        const range = source.side === "after" ? span.newRange : span.oldRange
        return range !== undefined && source.startLine <= range.endLine && range.startLine <= source.endLine
      })
      if (anchor === undefined) throw new Error(`case ${item.id} subject ${source.path}:${source.startLine}-${source.endLine} does not overlap a changed span`)
      return anchor
    })
    const anchor = anchors[0]!
    const relevantDiff = [...new Map(anchors.map((candidate) => [candidate.span.id, candidate.span.primaryPatch])).values()].join("\n")
    return {
      id: item.id,
      planner,
      partitioning: definition.partitioning,
      subjects,
      evidence,
      completeness: item.completeness,
      locations: subjectSources.map((source) => locationOf(source, "primary", "line")),
      relevantDiff,
      anchor
    }
  })
}

const customCases = async (
  planner: string,
  definition: CustomPlannerDefinition,
  request: PlannerRequest,
  diff: Domain.DiffSet,
  anchorsByFile: ReadonlyMap<string, ReadonlyArray<AssessmentCase["anchor"]>>,
  root: string,
  maxCases: number
): Promise<ReadonlyArray<AssessmentCase>> => {
  const filename = path.resolve(root, definition.module)
  if (!insideRoot(root, filename)) throw new Error(`module ${definition.module} must resolve inside the repository root`)
  const loaded = await import(pathToFileURL(filename).href) as Record<string, unknown>
  const exportName = definition.export ?? "default"
  const plannerFunction = loaded[exportName]
  if (typeof plannerFunction !== "function") throw new Error(`module ${definition.module} does not export function ${exportName}`)
  const raw = await (plannerFunction as PlannerFunction)(request)
  const decoded = Schema.decodeUnknownSync(ExternalPlannerResultSchema)(raw)
  return normalizeCustomResult(planner, definition, decoded, diff, anchorsByFile, maxCases)
}

export const plan = Effect.fn("AssessmentPlanner.plan")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  options: PlanOptions = {}
) {
  const diagnostics: Array<string> = []
  const maxCases = options.maxCases ?? 1_000
  const casesByRule = new Map<Domain.RuleId, Array<AssessmentCase>>()
  const plannerByRule = new Map<Domain.RuleId, string>()
  const anchorsByFile = new Map<string, ReadonlyArray<AssessmentCase["anchor"]>>()
  for (const file of diff.files) anchorsByFile.set(file.id, anchorsFor(file))

  for (const rule of rules) {
    const planner = plannerOf(rule)
    plannerByRule.set(rule.id, planner)
    casesByRule.set(rule.id, [])
    if (!builtInPlanners.some((candidate) => candidate === planner) && options.customPlanners?.[planner] === undefined) {
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

  const customRules = rules.filter((rule) => !builtInPlanners.some((candidate) => candidate === plannerOf(rule)))
  for (const rule of customRules) {
    const planner = plannerOf(rule)
    const definition = options.customPlanners?.[planner]
    if (definition === undefined) continue
    if (options.allowCustomPlanners !== true) {
      diagnostics.push(`rule ${rule.id} requires custom planner ${planner}; pass --allow-custom-planners to execute trusted repository planner modules`)
      continue
    }
    if (options.root === undefined) {
      diagnostics.push(`rule ${rule.id} requires custom planner ${planner}, but no repository root was supplied`)
      continue
    }
    const request = plannerRequest(diff, rule, anchorsByFile, maxCases)
    const planned = yield* Effect.tryPromise({
      try: () => customCases(planner, definition, request, diff, anchorsByFile, options.root!, maxCases),
      catch: (cause) => new Error(String(cause))
    }).pipe(
      Effect.map((cases) => ({ success: true as const, cases })),
      Effect.catch((error) => Effect.succeed({ success: false as const, error }))
    )
    if (!planned.success) {
      diagnostics.push(`planner ${planner} failed for rule ${rule.id}: ${planned.error.message}`)
      continue
    }
    casesByRule.get(rule.id)?.push(...planned.cases)
  }

  const plans = rules.map((rule): RulePlan => {
    const planner = plannerByRule.get(rule.id) ?? semanticChunksPlanner
    return {
      rule,
      planner,
      partitioning: planner === filenamesPlanner
        ? "global-unsplittable"
        : options.customPlanners?.[planner]?.partitioning ?? "independent-cases",
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
