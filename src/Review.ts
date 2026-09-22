import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Decision from "effect/unstable/ai/Decision"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

import * as AssessmentPlanner from "./AssessmentPlanner.js"
import * as Domain from "./Domain.js"
import * as JevPacker from "./JevPacker.js"

const MatrixRule = Schema.Struct({
  id: Domain.RuleId,
  guidance: Schema.String
})

const MatrixEvidence = Schema.Struct({
  id: Schema.String,
  planner: Schema.String,
  content: Schema.String
})

type MatrixEvidence = typeof MatrixEvidence.Type

const MatrixState = Schema.Struct({
  stage: Schema.Literal("matrix"),
  base: Schema.String,
  head: Schema.String,
  rules: Schema.Array(MatrixRule),
  cases: Schema.Array(MatrixEvidence)
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
  readonly assessment: AssessmentPlanner.AssessmentCase
  readonly evidence: MatrixEvidence
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
  `Assessment planner: ${AssessmentPlanner.plannerOf(rule)}`,
  ...semanticGuidance(rule)
].join("\n")

const matrixDecision = (pair: Pair): Decision.Probability => Decision.probability({
  instructions: [
    `Using the rule and assessment case with the referenced IDs in the input, determine whether the caller's change in case ${pair.assessment.id} introduces or worsens rule ${pair.rule.id}.`,
    "The caller selected the complete collection available to this run. Treat subjects as reportable locations and supporting evidence only as context. Judge only the before-to-after change; unchanged pre-existing problems are false."
  ].join(" "),
  criteria: {
    false: `Assessment case ${pair.assessment.id} satisfies or does not implicate rule ${pair.rule.id}.`,
    true: `The caller's change in assessment case ${pair.assessment.id} introduces or worsens the violation defined by rule ${pair.rule.id}.`
  }
})

const matrixEvidence = (assessment: AssessmentPlanner.AssessmentCase): MatrixEvidence => ({
  id: assessment.id,
  planner: assessment.planner,
  content: AssessmentPlanner.renderCase(assessment)
})

const buildPairs = Effect.fn("Review.buildPairs")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  maxStateChars: number
) {
  const plan = yield* AssessmentPlanner.plan(diff, rules)
  if (plan.diagnostics.length > 0) {
    return yield* new Domain.ReviewError({ stage: "planning", message: plan.diagnostics.join("; ") })
  }
  const pairs: Array<Pair> = []
  for (const rulePlan of plan.rules) {
    for (const assessment of rulePlan.cases) {
      const evidence = matrixEvidence(assessment)
      const evidenceChars = JSON.stringify(evidence).length
      if (evidenceChars > maxStateChars) {
        return yield* new Domain.ReviewError({
          stage: "planning",
          message: `planner ${rulePlan.planner} produced case ${assessment.id} with ${evidenceChars} characters, above maxStateChars ${maxStateChars}; narrow the collection or use a partitioning planner`
        })
      }
      pairs.push({
        key: `${rulePlan.rule.id}::${assessment.id}`,
        rule: rulePlan.rule,
        file: assessment.anchor.file,
        hunk: assessment.anchor.hunk,
        assessment,
        evidence
      })
    }
  }
  return { pairs, plan }
})

const stateOf = (diff: Domain.DiffSet, resources: ReadonlyArray<PackResource>) => ({
  stage: "matrix" as const,
  base: diff.base,
  head: diff.head,
  rules: resources.flatMap((resource) => resource.kind === "rule"
    ? [{ id: resource.rule.id, guidance: guidanceOf(resource.rule) }]
    : []),
  cases: resources.flatMap((resource) => resource.kind === "evidence" ? [resource.evidence] : [])
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
  const independentPacks = (selectedPairs: ReadonlyArray<Pair>): ReadonlyArray<MatrixPack> => {
    const resources = resourcesOf(selectedPairs)
    const packed = JevPacker.pack({
      resources,
      items: selectedPairs.map((pair) => ({
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
  }

  try {
    const byRule = new Map<Domain.RuleId, Array<Pair>>()
    for (const pair of pairs) {
      const group = byRule.get(pair.rule.id)
      if (group === undefined) byRule.set(pair.rule.id, [pair])
      else group.push(pair)
    }
    const packs: Array<MatrixPack> = []
    let current: Array<Pair> = []
    const flush = () => {
      if (current.length === 0) return
      packs.push(matrixPackOf(diff, current))
      current = []
    }
    for (const [, group] of [...byRule.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const standalone = matrixPackOf(diff, group)
      if (!JevPacker.fits(standalone.estimate)) {
        flush()
        packs.push(...independentPacks(group))
        continue
      }
      const combined = matrixPackOf(diff, [...current, ...group])
      if (current.length > 0 && !JevPacker.fits(combined.estimate)) flush()
      current.push(...group)
    }
    flush()
    return packs
  } catch (cause) {
    return new Domain.ReviewError({ stage: "packing", message: String(cause) })
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
    const screenAt = refinementScreenFloor === undefined
      ? pair.rule.thresholds.screenAt
      : Math.min(pair.rule.thresholds.screenAt, refinementScreenFloor)
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
      spanId: pair.assessment.anchor.span.id,
      assessmentCaseId: pair.assessment.id,
      hunkHeader: pair.hunk.header,
      relevantDiff: pair.assessment.relevantDiff,
      locations: pair.assessment.locations,
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

const validateOptions = (options: Options): Domain.ReviewError | undefined =>
  !Number.isFinite(options.maxStateChars) || options.maxStateChars < 1_000
    ? new Domain.ReviewError({ stage: "configuration", message: "maxStateChars must be at least 1000" })
    : undefined

const prepare = Effect.fn("Review.prepare")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  options: Options
) {
  const invalid = validateOptions(options)
  if (invalid !== undefined) return yield* invalid
  const prepared = yield* buildPairs(diff, rules, options.maxStateChars)
  const packs = packPairs(diff, prepared.pairs)
  if (packs instanceof Domain.ReviewError) return yield* packs
  return { ...prepared, packs }
})

export interface PlanReport {
  readonly schemaVersion: 1
  readonly base: string
  readonly head: string
  readonly files: number
  readonly rules: number
  readonly cases: number
  readonly requests: number
  readonly estimatedInputTokens: number
  readonly longestBindingTokens: number
  readonly planners: ReadonlyArray<{
    readonly ruleId: Domain.RuleId
    readonly planner: string
    readonly partitioning: AssessmentPlanner.Partitioning
    readonly cases: number
  }>
}

export const plan = Effect.fn("Review.plan")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  options: Options
) {
  const prepared = yield* prepare(diff, rules, options)
  return {
    schemaVersion: 1,
    base: diff.base,
    head: diff.head,
    files: diff.files.length,
    rules: rules.length,
    cases: prepared.pairs.length,
    requests: prepared.packs.length,
    estimatedInputTokens: prepared.packs.reduce((sum, pack) => sum + pack.estimate.totalTokens, 0),
    longestBindingTokens: prepared.packs.reduce((longest, pack) => Math.max(longest, pack.estimate.bindingTokens), 0),
    planners: prepared.plan.rules.map((rulePlan) => ({
      ruleId: rulePlan.rule.id,
      planner: rulePlan.planner,
      partitioning: rulePlan.partitioning,
      cases: rulePlan.cases.length
    }))
  } satisfies PlanReport
})

export const run = Effect.fn("Review.run")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  options: Options
) {
  const prepared = yield* prepare(diff, rules, options)
  const evaluated = yield* Effect.forEach(
    prepared.packs,
    (pack) => evaluatePackWithFallback(diff, pack),
    { concurrency: 4 }
  )
  let usage = emptyUsage
  const findings: Array<Domain.Finding> = []
  for (const result of evaluated) {
    usage = combineUsage(usage, result.usage)
    findings.push(...result.findings)
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
