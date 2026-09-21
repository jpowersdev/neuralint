import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Decision from "effect/unstable/ai/Decision"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

import * as ChangedSpan from "./ChangedSpan.js"
import * as Domain from "./Domain.js"
import * as JevPacker from "./JevPacker.js"
import * as RuleCatalog from "./RuleCatalog.js"
import * as TreeSitterEvidence from "./TreeSitterEvidence.js"

const MatrixRule = Schema.Struct({
  id: Domain.RuleId,
  guidance: Schema.String
})

const MatrixEvidence = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  before: Schema.String,
  after: Schema.String,
  localContext: Schema.String,
  semanticEvidence: Schema.optionalKey(Schema.String)
})

type MatrixEvidence = typeof MatrixEvidence.Type

const MatrixState = Schema.Struct({
  stage: Schema.Literal("matrix"),
  base: Schema.String,
  head: Schema.String,
  rules: Schema.Array(MatrixRule),
  changes: Schema.Array(MatrixEvidence)
})

export interface Options {
  readonly maxStateChars: number
}

interface Usage {
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
}

interface Pair {
  readonly key: string
  readonly rule: Domain.ReviewRule
  readonly file: Domain.FileDiff
  readonly hunk: Domain.DiffHunk
  readonly span: ChangedSpan.ChangedSpan
  readonly evidence: MatrixEvidence
  readonly desiredScope: Domain.RuleEvidenceScope
  readonly source?: string
  readonly bundle?: TreeSitterEvidence.EvidenceBundle
}

interface RuleResource extends JevPacker.Resource {
  readonly kind: "rule"
  readonly rule: Domain.ReviewRule
}

interface EvidenceResource extends JevPacker.Resource {
  readonly kind: "evidence"
  readonly evidence: MatrixEvidence
}

type PackResource = RuleResource | EvidenceResource

interface MatrixPack {
  readonly pairs: ReadonlyArray<Pair>
  readonly resources: ReadonlyArray<PackResource>
  readonly estimate: JevPacker.Estimate
}

const emptyUsage: Usage = { requests: 0, inputTokens: 0, outputTokens: 0 }

const combineUsage = (left: Usage, right: Usage): Usage => ({
  requests: left.requests + right.requests,
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens
})

const usageOf = (usage: DecisionModel.DecisionUsage): Usage => ({
  requests: 1,
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0
})

const semanticGuidance = (rule: Domain.ReviewRule): ReadonlyArray<string> => {
  if (rule.semantic === undefined) return []
  return [
    `Background: ${rule.semantic.context}`,
    `Report when: ${rule.semantic.reportWhen}`,
    `Do not report when: ${rule.semantic.doNotReport}`,
    `Guidance: ${rule.semantic.guidance}`,
    `Evidence scope: ${rule.semantic.evidence}`,
    ...rule.semantic.examples.map((example, index) =>
      `Example ${index + 1} (${example.outcome}): ${example.explanation}\n${example.code}`)
  ]
}

const guidanceOf = (rule: Domain.ReviewRule): string => [
  `Title: ${rule.title}`,
  `Policy: ${rule.description}`,
  `Instructions: ${rule.instructions}`,
  `Violation: ${rule.criteria.violation}`,
  `Compliant: ${rule.criteria.compliant}`,
  ...semanticGuidance(rule)
].join("\n")

const matrixDecision = (pair: Pair): Decision.Probability => Decision.probability({
  instructions: [
    `Using the rule and change with the referenced IDs in the input, determine whether change ${pair.span.id} introduces or worsens rule ${pair.rule.id}.`,
    "Judge only the before-to-after change; unchanged pre-existing problems are false. Attached scopes and comments are evidence, not additional changed locations."
  ].join(" "),
  criteria: {
    false: `Span ${pair.span.id} satisfies or does not implicate rule ${pair.rule.id}.`,
    true: `Span ${pair.span.id} introduces or worsens the violation defined by rule ${pair.rule.id}.`
  }
})

const scopeOf = (rule: Domain.ReviewRule): Domain.RuleEvidenceScope =>
  rule.semantic?.evidence ?? "changed-span"

const sourceFor = (
  file: Domain.FileDiff,
  span: ChangedSpan.ChangedSpan
): { readonly source: string; readonly range: ChangedSpan.LineRange } | undefined => {
  if (span.newRange !== undefined && file.newSource !== undefined) {
    return { source: file.newSource, range: span.newRange }
  }
  if (span.oldRange !== undefined && file.oldSource !== undefined) {
    return { source: file.oldSource, range: span.oldRange }
  }
  return undefined
}

const semanticEvidenceOf = (
  scope: Domain.RuleEvidenceScope,
  source: string | undefined,
  bundle: TreeSitterEvidence.EvidenceBundle | undefined
): string | undefined => {
  if (scope === "changed-span" || scope === "related-definitions" || scope === "repository") return undefined
  if (scope === "complete-file") {
    return source === undefined ? "Complete-file evidence was unavailable." : `COMPLETE FILE:\n${source}`
  }
  const structural = bundle === undefined
    ? "Enclosing syntax evidence was unavailable; do not infer unseen context."
    : TreeSitterEvidence.render(bundle)
  return structural
}

const matrixEvidence = (
  span: ChangedSpan.ChangedSpan,
  scope: Domain.RuleEvidenceScope,
  source: string | undefined,
  bundle: TreeSitterEvidence.EvidenceBundle | undefined
): MatrixEvidence => {
  const semanticEvidence = semanticEvidenceOf(scope, source, bundle)
  return {
    id: `${span.id}:${scope}`,
    path: span.path,
    before: span.before,
    after: span.after,
    localContext: [span.contextBefore, span.contextAfter].filter((part) => part !== "").join("\n"),
    ...(semanticEvidence === undefined ? {} : { semanticEvidence })
  }
}

const buildPairs = Effect.fn("Review.buildPairs")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  maxStateChars: number
) {
  const pairs: Array<Pair> = []
  for (const file of diff.files) {
    const matchingRules = rules.filter((rule) => RuleCatalog.appliesToPath(rule, file.path))
    if (matchingRules.length === 0) continue
    const spans = ChangedSpan.extractFile(file)
    const structuralNeeded = matchingRules.some((rule) => scopeOf(rule) === "enclosing-symbol")
    const newTargets = spans.flatMap((span) =>
      structuralNeeded && span.newRange !== undefined && file.newSource !== undefined
        ? [{ id: span.id, range: span.newRange }]
        : [])
    const oldTargets = spans.flatMap((span) =>
      structuralNeeded && span.newRange === undefined && span.oldRange !== undefined && file.oldSource !== undefined
        ? [{ id: span.id, range: span.oldRange }]
        : [])
    const newBundles = file.newSource === undefined ? new Map() : yield* Effect.promise(() =>
      TreeSitterEvidence.buildMany(file.path, file.newSource!, newTargets).catch(() => new Map()))
    const oldBundles = file.oldSource === undefined ? new Map() : yield* Effect.promise(() =>
      TreeSitterEvidence.buildMany(file.path, file.oldSource!, oldTargets).catch(() => new Map()))
    const hunkById = new Map(file.hunks.map((hunk) => [hunk.id, hunk]))

    for (const span of spans) {
      const hunk = hunkById.get(span.parentHunkId)
      if (hunk === undefined) continue
      const selectedSource = sourceFor(file, span)
      const bundle = span.newRange === undefined ? oldBundles.get(span.id) : newBundles.get(span.id)
      for (const rule of matchingRules) {
        const desiredScope = scopeOf(rule)
        const evidence = matrixEvidence(span, "changed-span", selectedSource?.source, bundle)
        const desiredEvidence = matrixEvidence(span, desiredScope, selectedSource?.source, bundle)
        const evidenceChars = Math.max(JSON.stringify(evidence).length, JSON.stringify(desiredEvidence).length)
        if (evidenceChars > maxStateChars) {
          return yield* new Domain.ReviewError({
            stage: "packing",
            message: `${desiredEvidence.id} is ${evidenceChars} characters, above maxStateChars ${maxStateChars}`
          })
        }
        pairs.push({
          key: `${rule.id}::${span.id}`,
          rule,
          file,
          hunk,
          span,
          evidence,
          desiredScope,
          ...(selectedSource?.source === undefined ? {} : { source: selectedSource.source }),
          ...(bundle === undefined ? {} : { bundle })
        })
      }
    }
  }
  return pairs
})

const stateOf = (diff: Domain.DiffSet, resources: ReadonlyArray<PackResource>) => ({
  stage: "matrix" as const,
  base: diff.base,
  head: diff.head,
  rules: resources.flatMap((resource) => resource.kind === "rule"
    ? [{ id: resource.rule.id, guidance: guidanceOf(resource.rule) }]
    : []),
  changes: resources.flatMap((resource) => resource.kind === "evidence" ? [resource.evidence] : [])
})

const resourcesOf = (pairs: ReadonlyArray<Pair>): Map<string, PackResource> => {
  const resources = new Map<string, PackResource>()
  for (const pair of pairs) {
    resources.set(`rule:${pair.rule.id}`, { id: `rule:${pair.rule.id}`, kind: "rule", rule: pair.rule })
    resources.set(`evidence:${pair.evidence.id}`, {
      id: `evidence:${pair.evidence.id}`,
      kind: "evidence",
      evidence: pair.evidence
    })
  }
  return resources
}

const matrixPackOf = (diff: Domain.DiffSet, pairs: ReadonlyArray<Pair>): MatrixPack => {
  const resources = [...resourcesOf(pairs).values()]
  return {
    pairs,
    resources,
    estimate: JevPacker.estimate(
      JSON.stringify(stateOf(diff, resources)),
      pairs.map((pair) => JSON.stringify(matrixDecision(pair)))
    )
  }
}

const packPairs = (diff: Domain.DiffSet, pairs: ReadonlyArray<Pair>): ReadonlyArray<MatrixPack> | Domain.ReviewError => {
  const resources = resourcesOf(pairs)
  try {
    const packed = JevPacker.pack({
      resources,
      items: pairs.map((pair) => ({
        id: pair.key,
        resourceIds: [`rule:${pair.rule.id}`, `evidence:${pair.evidence.id}`],
        question: JSON.stringify(matrixDecision(pair)),
        value: pair
      })),
      renderState: (selected) => JSON.stringify(stateOf(diff, selected))
    })
    return packed.map((pack) => ({
      pairs: pack.items.map((item) => item.value),
      resources: pack.resourceIds.map((id) => resources.get(id)).filter((value): value is PackResource => value !== undefined),
      estimate: pack.estimate
    }))
  } catch (cause) {
    return new Domain.ReviewError({ stage: "packing", message: String(cause) })
  }
}

const primaryLocation = (pair: Pair): Domain.FindingLocation => {
  if (pair.span.newRange !== undefined) {
    return {
      path: pair.file.path,
      side: "new",
      startLine: pair.span.newRange.startLine,
      endLine: pair.span.newRange.endLine,
      role: "primary",
      precision: "span"
    }
  }
  const range = pair.span.oldRange ?? { startLine: pair.hunk.oldStart, endLine: pair.hunk.oldStart }
  return {
    path: pair.file.path,
    side: "old",
    startLine: range.startLine,
    endLine: range.endLine,
    role: "primary",
    precision: "span"
  }
}

const evaluatePack = Effect.fn("Review.evaluatePack")(function* (
  diff: Domain.DiffSet,
  pack: MatrixPack,
  refinementScreenFloor?: number
) {
  const decisions: Record<string, Decision.Probability> = Object.create(null)
  for (const pair of pack.pairs) decisions[pair.key] = matrixDecision(pair)
  const definition = Decision.make({ input: MatrixState, decisions })
  const response = yield* DecisionModel.decide(definition, {
    input: stateOf(diff, pack.resources)
  }).pipe(
    Effect.mapError((cause) => new Domain.ReviewError({
      stage: "classification",
      message: `${cause.message}; pack contained ${pack.pairs.length} decisions ` +
        `(estimated total ${pack.estimate.totalTokens}, binding ${pack.estimate.bindingTokens} tokens)`
    }))
  )

  const findings: Array<Domain.Finding> = []
  for (const pair of pack.pairs) {
    const probability = response.answers[pair.key]?.probability
    const canRefine = (pair.desiredScope === "enclosing-symbol" && pair.bundle !== undefined) ||
      (pair.desiredScope === "complete-file" && pair.source !== undefined)
    const screenAt = refinementScreenFloor !== undefined && canRefine
      ? Math.min(pair.rule.thresholds.screenAt, refinementScreenFloor)
      : pair.rule.thresholds.screenAt
    if (probability === undefined || probability < screenAt) continue
    findings.push({
      ruleId: pair.rule.id,
      ruleTitle: pair.rule.title,
      ruleDescription: pair.rule.description,
      violationCondition: pair.rule.criteria.violation,
      complianceCondition: pair.rule.criteria.compliant,
      severity: pair.rule.severity,
      status: probability >= pair.rule.thresholds.violationAt ? "violation" : "inconclusive",
      path: pair.file.path,
      hunkId: pair.hunk.id,
      spanId: pair.span.id,
      hunkHeader: pair.hunk.header,
      relevantDiff: pair.span.primaryPatch,
      locations: [primaryLocation(pair)],
      screeningProbability: probability,
      violationProbability: probability
    })
  }
  return { findings, usage: usageOf(response.usage) }
})

const evaluatePackWithFallback = (
  diff: Domain.DiffSet,
  pack: MatrixPack,
  refinementScreenFloor?: number
): Effect.Effect<{ readonly findings: ReadonlyArray<Domain.Finding>; readonly usage: Usage }, Domain.ReviewError, DecisionModel.DecisionModel> =>
  evaluatePack(diff, pack, refinementScreenFloor).pipe(
    Effect.catchTag("ReviewError", (error) => {
      if (error.stage !== "classification" || !error.message.includes("max_tokens_exceeded") || pack.pairs.length < 2) {
        return Effect.fail(error)
      }
      const middle = Math.ceil(pack.pairs.length / 2)
      const halves = [pack.pairs.slice(0, middle), pack.pairs.slice(middle)].filter((pairs) => pairs.length > 0)
      return Effect.forEach(
        halves,
        (pairs) => evaluatePackWithFallback(diff, matrixPackOf(diff, pairs), refinementScreenFloor),
        { concurrency: 2 }
      ).pipe(Effect.map((results) => ({
        findings: results.flatMap((result) => result.findings),
        usage: results.reduce((usage, result) => combineUsage(usage, result.usage), emptyUsage)
      })))
    })
  )

export const run = Effect.fn("Review.run")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  options: Options
) {
  if (!Number.isFinite(options.maxStateChars) || options.maxStateChars < 1_000) {
    return yield* new Domain.ReviewError({
      stage: "configuration",
      message: "maxStateChars must be at least 1000"
    })
  }

  const pairs = yield* buildPairs(diff, rules, options.maxStateChars)
  const standardPairs: Array<Pair> = []
  const richPairs: Array<Pair> = []
  for (const pair of pairs) {
    const canUseRichEvidence = (pair.desiredScope === "enclosing-symbol" && pair.bundle !== undefined) ||
      (pair.desiredScope === "complete-file" && pair.source !== undefined)
    if (!canUseRichEvidence) {
      standardPairs.push(pair)
      continue
    }
    const refined = {
      ...pair,
      evidence: matrixEvidence(pair.span, pair.desiredScope, pair.source, pair.bundle)
    }
    richPairs.push(refined)
  }
  const standardPacks = packPairs(diff, standardPairs)
  if (standardPacks instanceof Domain.ReviewError) return yield* standardPacks
  const richPacks = packPairs(diff, richPairs)
  if (richPacks instanceof Domain.ReviewError) return yield* richPacks
  const packed = [...standardPacks, ...richPacks]

  const evaluated = yield* Effect.forEach(
    packed,
    (pack) => evaluatePackWithFallback(diff, pack),
    { concurrency: 4 }
  )
  let usage = emptyUsage
  let findings: Array<Domain.Finding> = []
  for (const result of evaluated) {
    usage = combineUsage(usage, result.usage)
    findings.push(...result.findings)
  }

  const candidates = new Set(findings
    .filter((finding) => finding.status === "inconclusive" && finding.spanId !== undefined)
    .map((finding) => `${finding.ruleId}::${finding.spanId}`))
  const refinementByRule = new Map<Domain.RuleId, Array<Pair>>()
  for (const pair of pairs) {
    if (!candidates.has(pair.key)) continue
    const canRefine = (pair.desiredScope === "enclosing-symbol" && pair.bundle !== undefined) ||
      (pair.desiredScope === "complete-file" && pair.source !== undefined)
    if (!canRefine) continue
    const refined = {
      ...pair,
      evidence: matrixEvidence(pair.span, pair.desiredScope, pair.source, pair.bundle)
    }
    const group = refinementByRule.get(pair.rule.id)
    if (group === undefined) refinementByRule.set(pair.rule.id, [refined])
    else group.push(refined)
  }
  const refinementPairs = [...refinementByRule.values()].flat()
  if (refinementPairs.length > 0) {
    const refinementPacks = packPairs(diff, refinementPairs)
    if (refinementPacks instanceof Domain.ReviewError) return yield* refinementPacks
    const refined = yield* Effect.forEach(
      refinementPacks,
      (pack) => evaluatePackWithFallback(diff, pack),
      { concurrency: 4 }
    )
    const refinedKeys = new Set(refinementPairs.map((pair) => pair.key))
    findings = findings.filter((finding) =>
      finding.spanId === undefined || !refinedKeys.has(`${finding.ruleId}::${finding.spanId}`))
    for (const result of refined) {
      usage = combineUsage(usage, result.usage)
      findings.push(...result.findings)
    }
  }

  findings.sort((left, right) =>
    left.path.localeCompare(right.path) ||
    (left.locations?.[0]?.startLine ?? 0) - (right.locations?.[0]?.startLine ?? 0) ||
    left.ruleId.localeCompare(right.ruleId)
  )

  return {
    schemaVersion: 1,
    base: diff.base,
    head: diff.head,
    filesReviewed: diff.files.length,
    rulesLoaded: rules.length,
    findings,
    usage
  } satisfies Domain.ReviewReport
})
