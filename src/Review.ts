import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Decision from "effect/unstable/ai/Decision"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

import * as Domain from "./Domain.js"
import * as RuleCatalog from "./RuleCatalog.js"

const requestCharacterBudget = 220_000
const requestSafetyMargin = 4_000

const MatrixRule = Schema.Struct({
  id: Domain.RuleId,
  guidance: Schema.String
})

const MatrixChunk = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  header: Schema.String,
  patch: Schema.String
})

const MatrixState = Schema.Struct({
  stage: Schema.Literal("matrix"),
  base: Schema.String,
  head: Schema.String,
  rules: Schema.Array(MatrixRule),
  chunks: Schema.Array(MatrixChunk)
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
}

interface MatrixPack {
  readonly pairs: ReadonlyArray<Pair>
  readonly rules: ReadonlyArray<Domain.ReviewRule>
  readonly chunks: ReadonlyArray<{ readonly file: Domain.FileDiff; readonly hunk: Domain.DiffHunk }>
  readonly estimatedChars: number
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
    `Using the rule and changed chunk with the referenced IDs in the input, determine whether chunk ${pair.hunk.id} in ${pair.file.path} introduces or worsens rule ${pair.rule.id}.`,
    "Judge only the base-to-HEAD change. Unchanged pre-existing problems are false."
  ].join(" "),
  criteria: {
    false: `Chunk ${pair.hunk.id} satisfies or does not implicate rule ${pair.rule.id}.`,
    true: `Chunk ${pair.hunk.id} introduces or worsens the violation defined by rule ${pair.rule.id}.`
  }
})

const chunkState = (file: Domain.FileDiff, hunk: Domain.DiffHunk) => ({
  id: hunk.id,
  path: file.path,
  header: hunk.header,
  patch: hunk.patch
})

const primaryLocation = (file: Domain.FileDiff, hunk: Domain.DiffHunk): Domain.FindingLocation => {
  if (hunk.newLines > 0) {
    return {
      path: file.path,
      side: "new",
      startLine: hunk.newStart,
      endLine: hunk.newStart + hunk.newLines - 1,
      role: "primary",
      precision: "hunk"
    }
  }
  return {
    path: file.path,
    side: "old",
    startLine: hunk.oldStart,
    endLine: hunk.oldStart + Math.max(hunk.oldLines, 1) - 1,
    role: "primary",
    precision: "hunk"
  }
}

const buildPairs = (
  diff: Domain.DiffSet,
  rules: ReadonlyArray<Domain.ReviewRule>,
  maxStateChars: number
): ReadonlyArray<Pair> | Domain.ReviewError => {
  const pairs: Array<Pair> = []
  for (const rule of rules) {
    for (const file of diff.files) {
      if (!RuleCatalog.appliesToPath(rule, file.path)) continue
      for (const hunk of file.hunks) {
        const evidenceChars = file.path.length + hunk.header.length + hunk.patch.length
        if (evidenceChars > maxStateChars) {
          return new Domain.ReviewError({
            stage: "packing",
            message: `${hunk.id} is ${evidenceChars} characters with metadata, above maxStateChars ${maxStateChars}`
          })
        }
        pairs.push({ key: `${rule.id}::${hunk.id}`, rule, file, hunk })
      }
    }
  }
  return pairs
}

const packPairs = (pairs: ReadonlyArray<Pair>): ReadonlyArray<MatrixPack> | Domain.ReviewError => {
  const packs: Array<MatrixPack> = []
  let currentPairs: Array<Pair> = []
  let currentRules = new Map<string, Domain.ReviewRule>()
  let currentChunks = new Map<string, { readonly file: Domain.FileDiff; readonly hunk: Domain.DiffHunk }>()
  let currentChars = requestSafetyMargin

  const flush = () => {
    if (currentPairs.length === 0) return
    packs.push({
      pairs: currentPairs,
      rules: [...currentRules.values()],
      chunks: [...currentChunks.values()],
      estimatedChars: currentChars
    })
    currentPairs = []
    currentRules = new Map()
    currentChunks = new Map()
    currentChars = requestSafetyMargin
  }

  for (const pair of pairs) {
    const ruleChars = currentRules.has(pair.rule.id)
      ? 0
      : JSON.stringify({ id: pair.rule.id, guidance: guidanceOf(pair.rule) }).length + 2
    const chunkChars = currentChunks.has(pair.hunk.id)
      ? 0
      : JSON.stringify(chunkState(pair.file, pair.hunk)).length + 2
    const decisionChars = pair.key.length + JSON.stringify(matrixDecision(pair)).length + 4
    const additionalChars = ruleChars + chunkChars + decisionChars
    if (currentPairs.length > 0 && currentChars + additionalChars > requestCharacterBudget) flush()
    if (currentChars + additionalChars > requestCharacterBudget) {
      return new Domain.ReviewError({
        stage: "packing",
        message: `${pair.rule.id} against ${pair.hunk.id} exceeds the Jev request budget`
      })
    }
    currentPairs.push(pair)
    currentRules.set(pair.rule.id, pair.rule)
    currentChunks.set(pair.hunk.id, { file: pair.file, hunk: pair.hunk })
    currentChars += additionalChars
  }
  flush()
  return packs
}

const evaluatePack = Effect.fn("Review.evaluatePack")(function* (diff: Domain.DiffSet, pack: MatrixPack) {
  const decisions: Record<string, Decision.Probability> = Object.create(null)
  for (const pair of pack.pairs) decisions[pair.key] = matrixDecision(pair)
  const definition = Decision.make({ input: MatrixState, decisions })
  const response = yield* DecisionModel.decide(definition, {
    input: {
      stage: "matrix",
      base: diff.base,
      head: diff.head,
      rules: pack.rules.map((rule) => ({ id: rule.id, guidance: guidanceOf(rule) })),
      chunks: pack.chunks.map(({ file, hunk }) => chunkState(file, hunk))
    }
  }).pipe(
    Effect.mapError((cause) => new Domain.ReviewError({
      stage: "classification",
      message: `${cause.message}; pack contained ${pack.pairs.length} decisions (${pack.estimatedChars} estimated characters)`
    }))
  )

  const findings: Array<Domain.Finding> = []
  for (const pair of pack.pairs) {
    const probability = response.answers[pair.key]?.probability
    if (probability === undefined || probability < pair.rule.thresholds.screenAt) continue
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
      hunkHeader: pair.hunk.header,
      relevantDiff: pair.hunk.patch,
      locations: [primaryLocation(pair.file, pair.hunk)],
      screeningProbability: probability,
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
    return yield* new Domain.ReviewError({
      stage: "configuration",
      message: "maxStateChars must be at least 1000"
    })
  }

  const paired = buildPairs(diff, rules, options.maxStateChars)
  if (paired instanceof Domain.ReviewError) return yield* paired
  const packed = packPairs(paired)
  if (packed instanceof Domain.ReviewError) return yield* packed

  const evaluated = yield* Effect.forEach(
    packed,
    (pack) => evaluatePack(diff, pack),
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
