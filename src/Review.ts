import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Decision from "effect/unstable/ai/Decision"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

import * as Domain from "./Domain.js"
import * as RuleCatalog from "./RuleCatalog.js"

const ChunkState = Schema.Struct({
  id: Schema.String,
  header: Schema.String,
  patch: Schema.String
})

const ScreeningState = Schema.Struct({
  stage: Schema.Literal("screen"),
  base: Schema.String,
  head: Schema.String,
  path: Schema.String,
  chunks: Schema.Array(ChunkState)
})

const LocalizationRule = Schema.Struct({
  id: Domain.RuleId,
  title: Schema.String,
  description: Schema.String,
  instructions: Schema.String
})

const LocalizationState = Schema.Struct({
  stage: Schema.Literal("localize"),
  base: Schema.String,
  head: Schema.String,
  path: Schema.String,
  rule: LocalizationRule,
  chunks: Schema.Array(ChunkState)
})

export interface Options {
  readonly maxStateChars: number
}

interface Usage {
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
}

interface Pack {
  readonly file: Domain.FileDiff
  readonly hunks: ReadonlyArray<Domain.DiffHunk>
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

const packFile = (
  file: Domain.FileDiff,
  maxStateChars: number
): ReadonlyArray<Pack> | Domain.ReviewError => {
  const packs: Array<Pack> = []
  let hunks: Array<Domain.DiffHunk> = []
  let chars = 0
  for (const hunk of file.hunks) {
    if (hunk.patch.length > maxStateChars) {
      return new Domain.ReviewError({
        stage: "packing",
        message: `${hunk.id} is ${hunk.patch.length} characters, above maxStateChars ${maxStateChars}`
      })
    }
    if (hunks.length > 0 && chars + hunk.patch.length > maxStateChars) {
      packs.push({ file, hunks })
      hunks = []
      chars = 0
    }
    hunks.push(hunk)
    chars += hunk.patch.length
  }
  if (hunks.length > 0) packs.push({ file, hunks })
  return packs
}

const chunkState = (hunk: Domain.DiffHunk) => ({
  id: hunk.id,
  header: hunk.header,
  patch: hunk.patch
})

const probabilityDecision = (rule: Domain.ReviewRule, subject: string): Decision.Probability =>
  Decision.probability({
    instructions: [
      `${subject} introduces or worsens rule ${rule.id}: ${rule.title}.`,
      rule.description,
      rule.instructions,
      "Judge only the supplied base-to-HEAD changes. Pre-existing problems that are not worsened are false."
    ].join(" "),
    criteria: {
      false: rule.criteria.compliant,
      true: rule.criteria.violation
    }
  })

const screenPack = Effect.fn("Review.screenPack")(function* (
  diff: Domain.DiffSet,
  pack: Pack,
  rules: ReadonlyArray<Domain.ReviewRule>
) {
  const decisions: Record<string, Decision.Probability> = Object.create(null)
  for (const rule of rules) decisions[rule.id] = probabilityDecision(rule, "At least one chunk in this file")
  const definition = Decision.make({ input: ScreeningState, decisions })
  const response = yield* DecisionModel.decide(definition, {
    input: {
      stage: "screen",
      base: diff.base,
      head: diff.head,
      path: pack.file.path,
      chunks: pack.hunks.map(chunkState)
    }
  }).pipe(
    Effect.mapError((cause) => new Domain.ReviewError({ stage: "screening", message: cause.message }))
  )
  return { answers: response.answers, usage: usageOf(response.usage) }
})

const localizeRule = Effect.fn("Review.localizeRule")(function* (
  diff: Domain.DiffSet,
  pack: Pack,
  rule: Domain.ReviewRule,
  screeningProbability: number
) {
  const decisions: Record<string, Decision.Probability> = Object.create(null)
  for (const hunk of pack.hunks) decisions[hunk.id] = probabilityDecision(rule, `Chunk ${hunk.id}`)
  const definition = Decision.make({ input: LocalizationState, decisions })
  const response = yield* DecisionModel.decide(definition, {
    input: {
      stage: "localize",
      base: diff.base,
      head: diff.head,
      path: pack.file.path,
      rule: {
        id: rule.id,
        title: rule.title,
        description: rule.description,
        instructions: rule.instructions
      },
      chunks: pack.hunks.map(chunkState)
    }
  }).pipe(
    Effect.mapError((cause) => new Domain.ReviewError({ stage: "localization", message: cause.message }))
  )

  const findings: Array<Domain.Finding> = []
  for (const hunk of pack.hunks) {
    const probability = response.answers[hunk.id]?.probability
    if (probability === undefined || probability < rule.thresholds.screenAt) continue
    findings.push({
      ruleId: rule.id,
      ruleTitle: rule.title,
      ruleDescription: rule.description,
      violationCondition: rule.criteria.violation,
      complianceCondition: rule.criteria.compliant,
      severity: rule.severity,
      status: probability >= rule.thresholds.violationAt ? "violation" : "inconclusive",
      path: pack.file.path,
      hunkId: hunk.id,
      hunkHeader: hunk.header,
      relevantDiff: hunk.patch,
      screeningProbability,
      violationProbability: probability
    })
  }
  return { findings, usage: usageOf(response.usage) }
})

export const run = Effect.fn("Review.run")(function* (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  options: Options
) {
  if (!Number.isFinite(options.maxStateChars) || options.maxStateChars < 1_000) {
    return yield* new Domain.ReviewError({ stage: "configuration", message: "maxStateChars must be at least 1000" })
  }

  let usage = emptyUsage
  const findings: Array<Domain.Finding> = []
  for (const file of diff.files) {
    const applicable = rules.filter((rule) => RuleCatalog.appliesToPath(rule, file.path))
    if (applicable.length === 0) continue
    const packed = packFile(file, options.maxStateChars)
    if (packed instanceof Domain.ReviewError) return yield* packed
    for (const pack of packed) {
      const screened = yield* screenPack(diff, pack, applicable)
      usage = combineUsage(usage, screened.usage)
      for (const rule of applicable) {
        const probability = screened.answers[rule.id]?.probability
        if (probability === undefined || probability < rule.thresholds.screenAt) continue
        const localized = yield* localizeRule(diff, pack, rule, probability)
        usage = combineUsage(usage, localized.usage)
        findings.push(...localized.findings)
      }
    }
  }

  findings.sort((left, right) =>
    left.path.localeCompare(right.path) ||
    left.hunkId.localeCompare(right.hunkId) ||
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
