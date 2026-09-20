import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as Decision from "effect/unstable/ai/Decision"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"
import * as YAML from "yaml"

import * as Ai from "../../src/Ai.js"

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, "../..")
const suite = path.join(root, "benchmark/effect-idioms-30")
const scalingOutput = path.join(directory, "results/scaling.json")
const packedOutput = path.join(directory, "results/packed-30x30.json")
const sizes = [1, 4, 10, 15, 20, 25, 30] as const
const jevInputUsdPerMillionTokens = 0.042

const MatrixRule = Schema.Struct({
  id: Schema.String,
  guidance: Schema.String
})

const MatrixChange = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  path: Schema.String,
  before: Schema.String,
  after: Schema.String
})

const MatrixState = Schema.Struct({
  rules: Schema.Array(MatrixRule),
  changes: Schema.Array(MatrixChange)
})

interface RawRule {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly instructions: string
  readonly criteria: {
    readonly violation: string
    readonly compliant: string
  }
  readonly thresholds: {
    readonly screenAt: number
    readonly violationAt: number
  }
  readonly semantic?: {
    readonly context: string
    readonly reportWhen: string
    readonly doNotReport: string
    readonly guidance: string
    readonly evidence: string
    readonly examples: ReadonlyArray<{
      readonly outcome: string
      readonly explanation: string
      readonly code: string
    }>
  }
}

interface Fixture {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly before: string
  readonly after: string
  readonly expected: ReadonlyArray<{ readonly ruleId: string }>
}

const guidanceOf = (rule: RawRule): string => {
  const parts = [
    `Title: ${rule.title}`,
    `Policy: ${rule.description}`,
    `Instructions: ${rule.instructions}`,
    `Violation: ${rule.criteria.violation}`,
    `Compliant: ${rule.criteria.compliant}`
  ]
  if (rule.semantic !== undefined) {
    parts.push(
      `Background: ${rule.semantic.context}`,
      `Report when: ${rule.semantic.reportWhen}`,
      `Do not report when: ${rule.semantic.doNotReport}`,
      `Guidance: ${rule.semantic.guidance}`,
      `Evidence scope: ${rule.semantic.evidence}`
    )
    for (const [index, example] of rule.semantic.examples.entries()) {
      parts.push(`Example ${index + 1} (${example.outcome}): ${example.explanation}\n${example.code}`)
    }
  }
  return parts.join("\n")
}

const keyOf = (ruleIndex: number, changeIndex: number): string =>
  `R${String(ruleIndex + 1).padStart(2, "0")}C${String(changeIndex + 1).padStart(2, "0")}`

const runSize = Effect.fn("Matrix.runSize")(function* (
  allRules: ReadonlyArray<RawRule>,
  changes: ReadonlyArray<Fixture>,
  ruleCount: number
) {
  const rules = allRules.slice(0, ruleCount)
  const decisions: Record<string, Decision.Probability> = Object.create(null)
  const pairs = new Map<string, { rule: RawRule; change: Fixture }>()
  for (const [ruleIndex, rule] of rules.entries()) {
    for (const [changeIndex, change] of changes.entries()) {
      const key = keyOf(ruleIndex, changeIndex)
      pairs.set(key, { rule, change })
      decisions[key] = Decision.probability({
        instructions: `Using the rule and change with the referenced IDs in the input, determine whether change ${change.id} introduces or worsens rule ${rule.id}. Judge only the before-to-after change; unchanged pre-existing problems are false.`,
        criteria: {
          false: `Change ${change.id} satisfies or does not implicate rule ${rule.id}.`,
          true: `Change ${change.id} introduces or worsens the violation defined by rule ${rule.id}.`
        }
      })
    }
  }

  const input = {
    rules: rules.map((rule) => ({ id: rule.id, guidance: guidanceOf(rule) })),
    changes: changes.map((change, index) => ({
      id: change.id,
      title: change.title,
      path: `src/changes/${String(index + 1).padStart(2, "0")}-${change.id}.ts`,
      before: change.before,
      after: change.after
    }))
  }
  const definition = Decision.make({ input: MatrixState, decisions })
  const started = performance.now()
  const response = yield* DecisionModel.decide(definition, { input })
  const latencyMs = Math.round(performance.now() - started)

  const findings: Array<{
    readonly ruleId: string
    readonly changeId: string
    readonly expected: boolean
    readonly probability: number
    readonly status: "violation" | "inconclusive"
  }> = []
  const primaries: Array<{
    readonly ruleId: string
    readonly changeId: string
    readonly probability: number
    readonly status: "violation" | "inconclusive" | "missed"
  }> = []

  for (const [key, pair] of pairs) {
    const probability = response.answers[key]?.probability
    if (probability === undefined) continue
    const expected = pair.change.expected.some((item) => item.ruleId === pair.rule.id)
    if (probability >= pair.rule.thresholds.screenAt) {
      findings.push({
        ruleId: pair.rule.id,
        changeId: pair.change.id,
        expected,
        probability,
        status: probability >= pair.rule.thresholds.violationAt ? "violation" : "inconclusive"
      })
    }
    if (expected) {
      primaries.push({
        ruleId: pair.rule.id,
        changeId: pair.change.id,
        probability,
        status: probability < pair.rule.thresholds.screenAt
          ? "missed"
          : probability >= pair.rule.thresholds.violationAt ? "violation" : "inconclusive"
      })
    }
  }

  return {
    ruleCount,
    changedFiles: changes.length,
    decisions: Object.keys(decisions).length,
    stateChars: JSON.stringify(input).length,
    decisionDefinitionChars: JSON.stringify(decisions).length,
    latencyMs,
    usage: response.usage,
    estimatedCostUsd: (response.usage.inputTokens ?? 0) / 1_000_000 * jevInputUsdPerMillionTokens,
    metrics: {
      primaryRetained: primaries.filter((item) => item.status !== "missed").length,
      primaryDefinitive: primaries.filter((item) => item.status === "violation").length,
      primaryInconclusive: primaries.filter((item) => item.status === "inconclusive").length,
      primaryMissed: primaries.filter((item) => item.status === "missed").length,
      unanticipatedCandidates: findings.filter((item) => !item.expected).length,
      unanticipatedDefinitive: findings.filter((item) => !item.expected && item.status === "violation").length
    },
    primaries,
    findings
  }
})

const program = Effect.gen(function* () {
  const ruleFiles = (yield* Effect.promise(() => fs.readdir(path.join(suite, "rules"))))
    .filter((name) => name.endsWith(".yaml"))
    .sort()
  const loadedRules = yield* Effect.promise(() => Promise.all(ruleFiles.map(async (name) =>
    YAML.parse(await fs.readFile(path.join(suite, "rules", name), "utf8")) as RawRule
  )))
  const fixtureDocument = yield* Effect.promise(async () =>
    JSON.parse(await fs.readFile(path.join(suite, "fixtures.json"), "utf8")) as {
      readonly cases: ReadonlyArray<Fixture>
    }
  )
  const changes = fixtureDocument.cases.filter((fixture) => fixture.expected.length > 0)
  const expectedOrder = changes.map((change) => change.expected[0]?.ruleId)
  const rules = expectedOrder.map((ruleId) => {
    const rule = loadedRules.find((candidate) => candidate.id === ruleId)
    if (rule === undefined) throw new Error(`Missing rule ${ruleId}`)
    return rule
  })

  const runs: Array<unknown> = []
  if (!process.argv.includes("--packed-only")) {
    for (const size of sizes) {
      const exit = yield* Effect.exit(runSize(rules, changes, size))
      if (Exit.isFailure(exit)) {
        const detail = Cause.pretty(exit.cause)
        const failure = {
          ruleCount: size,
          changedFiles: changes.length,
          decisions: size * changes.length,
          error: detail.includes("max_tokens_exceeded") ? "max_tokens_exceeded" : detail
        }
        runs.push(failure)
        console.log(JSON.stringify(failure, null, 2))
        continue
      }
      const result = exit.value
      runs.push(result)
      console.log(JSON.stringify({
        ruleCount: result.ruleCount,
        decisions: result.decisions,
        latencyMs: result.latencyMs,
        inputTokens: result.usage.inputTokens,
        costUsd: result.estimatedCostUsd,
        ...result.metrics
      }, null, 2))
    }
  }

  const packedStarted = performance.now()
  const packedRuns = yield* Effect.all([
    runSize(rules.slice(0, 15), changes, 15),
    runSize(rules.slice(15), changes, 15)
  ], { concurrency: "unbounded" })
  const packedPrimaries = packedRuns.flatMap((run) => run.primaries)
  const packedFindings = packedRuns.flatMap((run) => run.findings)
  const packed = {
    ruleCount: 30,
    changedFiles: changes.length,
    decisions: 900,
    requests: 2,
    batchRuleCounts: [15, 15],
    latencyMs: Math.round(performance.now() - packedStarted),
    usage: {
      inputTokens: packedRuns.reduce((total, run) => total + (run.usage.inputTokens ?? 0), 0),
      outputTokens: packedRuns.reduce((total, run) => total + (run.usage.outputTokens ?? 0), 0)
    },
    estimatedCostUsd: packedRuns.reduce((total, run) => total + run.estimatedCostUsd, 0),
    metrics: {
      primaryRetained: packedPrimaries.filter((item) => item.status !== "missed").length,
      primaryDefinitive: packedPrimaries.filter((item) => item.status === "violation").length,
      primaryInconclusive: packedPrimaries.filter((item) => item.status === "inconclusive").length,
      primaryMissed: packedPrimaries.filter((item) => item.status === "missed").length,
      unanticipatedCandidates: packedFindings.filter((item) => !item.expected).length,
      unanticipatedDefinitive: packedFindings.filter((item) => !item.expected && item.status === "violation").length
    },
    primaries: packedPrimaries,
    findings: packedFindings
  }
  console.log(JSON.stringify({
    packed: "30 rules in two concurrent 15-rule requests",
    decisions: packed.decisions,
    requests: packed.requests,
    latencyMs: packed.latencyMs,
    inputTokens: packed.usage.inputTokens,
    costUsd: packed.estimatedCostUsd,
    ...packed.metrics
  }, null, 2))

  yield* Effect.promise(async () => {
    await fs.mkdir(path.dirname(packedOutput), { recursive: true })
    if (runs.length > 0) {
      await fs.writeFile(scalingOutput, JSON.stringify({
        schemaVersion: 1,
        model: "jev-latest",
        execution: "one request per matrix size",
        sizes,
        runs
      }, null, 2) + "\n")
    }
    await fs.writeFile(packedOutput, JSON.stringify({
      schemaVersion: 1,
      model: "jev-latest",
      execution: "two concurrent requests containing 15 rules × 30 changes each",
      packed
    }, null, 2) + "\n")
  })
  if (runs.length > 0) console.log(`Wrote ${scalingOutput}`)
  console.log(`Wrote ${packedOutput}`)
}).pipe(Effect.provide(Ai.decisionModelLayer))

await Effect.runPromise(program)
