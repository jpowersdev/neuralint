import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Decision from "effect/unstable/ai/Decision"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

import * as Ai from "../src/Ai.js"
import * as Domain from "../src/Domain.js"
import * as RuleCatalog from "../src/RuleCatalog.js"

const Expected = Schema.Literals(["violation", "compliant"])
type Expected = typeof Expected.Type

const BenchmarkCase = Schema.Struct({
  id: Schema.String,
  ruleId: Domain.RuleId,
  expected: Expected,
  path: Schema.String,
  diff: Schema.String
})
type BenchmarkCase = typeof BenchmarkCase.Type

const Corpus = Schema.Struct({
  version: Schema.Literal(1),
  cases: Schema.Array(BenchmarkCase)
})

const JevInput = Schema.Struct({
  path: Schema.String,
  diff: Schema.String
})

const AgentAnswer = Schema.Struct({
  violation: Schema.Boolean,
  confidence: Schema.Number,
  explanation: Schema.String,
  relevantLines: Schema.Array(Schema.String)
})
type AgentAnswer = typeof AgentAnswer.Type

class BenchmarkError extends Data.TaggedError("BenchmarkError")<{
  readonly message: string
}> {}

interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd?: number
}

type Classification = "violation" | "compliant" | "inconclusive"

interface Evaluation {
  readonly status: Classification
  readonly violationProbability: number
  readonly screeningProbability?: number
  readonly reportedConfidence?: number
  readonly latencyMs: number
  readonly usage: Usage
  readonly explanation?: string
  readonly relevantLines?: ReadonlyArray<string>
}

interface CaseResult {
  readonly id: string
  readonly ruleId: Domain.RuleId
  readonly expected: Expected
  readonly jev: Evaluation
  readonly agent: Evaluation
}

const root = fileURLToPath(new URL("..", import.meta.url))

const argumentsOf = (args: ReadonlyArray<string>) => {
  const valueAfter = (name: string, fallback: string): string => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] ?? fallback : fallback
  }
  const parsedLimit = Number(valueAfter("--limit", String(Number.POSITIVE_INFINITY)))
  return {
    model: valueAfter("--model", "openai-codex/gpt-5.6-terra"),
    thinking: valueAfter("--thinking", "low"),
    limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : Number.POSITIVE_INFINITY
  }
}

const instructionFor = (
  rule: Domain.ReviewRule,
  subject = "The supplied base-to-HEAD diff"
): string => [
  `${subject} introduces or worsens rule ${rule.id}: ${rule.title}.`,
  rule.description,
  rule.instructions,
  "Judge only the supplied changes. Pre-existing problems that are not worsened are compliant."
].join(" ")

const evaluateJev = Effect.fn("Benchmark.evaluateJev")(function* (
  testCase: BenchmarkCase,
  rule: Domain.ReviewRule
) {
  const decide = (subject: string) => {
    const definition = Decision.make({
      input: JevInput,
      decisions: {
        violation: Decision.probability({
          instructions: instructionFor(rule, subject),
          criteria: {
            false: rule.criteria.compliant,
            true: rule.criteria.violation
          }
        })
      }
    })
    return DecisionModel.decide(definition, {
      input: { path: testCase.path, diff: testCase.diff }
    }).pipe(
      Effect.mapError((cause) => new BenchmarkError({ message: `Jev failed for ${testCase.id}: ${cause.message}` }))
    )
  }

  const startedAt = Date.now()
  const screened = yield* decide("At least one chunk in this file")
  const screeningProbability = screened.answers.violation.probability
  let probability = screeningProbability
  let inputTokens = screened.usage.inputTokens ?? 0
  let outputTokens = screened.usage.outputTokens ?? 0
  if (screeningProbability >= rule.thresholds.screenAt) {
    const localized = yield* decide("Chunk F001:H001")
    probability = localized.answers.violation.probability
    inputTokens += localized.usage.inputTokens ?? 0
    outputTokens += localized.usage.outputTokens ?? 0
  }
  const status: Classification = screeningProbability < rule.thresholds.screenAt || probability < rule.thresholds.screenAt
    ? "compliant"
    : probability >= rule.thresholds.violationAt
    ? "violation"
    : "inconclusive"
  return {
    status,
    violationProbability: probability,
    screeningProbability,
    latencyMs: Date.now() - startedAt,
    usage: { inputTokens, outputTokens }
  } satisfies Evaluation
})

const agentPrompt = (testCase: BenchmarkCase, rule: Domain.ReviewRule): string => `You are a policy classifier in a controlled benchmark. Do not propose a fix.

${instructionFor(rule)}

Violation condition: ${rule.criteria.violation}
Compliant condition: ${rule.criteria.compliant}
Path: ${testCase.path}

Diff:
${testCase.diff}

Return only one JSON object with exactly this shape:
{"violation":boolean,"confidence":number,"explanation":string,"relevantLines":string[]}

confidence must be between 0 and 1. relevantLines must quote only decisive added or removed lines from the diff.`

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const extractAgentMessage = (stdout: string) => Effect.try({
  try: () => {
    let finalMessage: Record<string, unknown> | undefined
    for (const line of stdout.trim().split("\n")) {
      if (line.trim() === "") continue
      const event = asRecord(JSON.parse(line))
      if (event?.["type"] !== "message_end") continue
      const message = asRecord(event["message"])
      if (message?.["role"] === "assistant") finalMessage = message
    }
    if (finalMessage === undefined) throw new Error("pi emitted no final assistant message")
    const content = finalMessage["content"]
    if (!Array.isArray(content)) throw new Error("pi assistant content was not an array")
    const text = content
      .map(asRecord)
      .filter((part): part is Record<string, unknown> => part !== undefined && part["type"] === "text")
      .map((part) => part["text"])
      .filter((part): part is string => typeof part === "string")
      .join("")
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start < 0 || end < start) throw new Error(`agent did not return JSON: ${text}`)
    const answer = Schema.decodeUnknownSync(AgentAnswer)(JSON.parse(text.slice(start, end + 1)))
    const usage = asRecord(finalMessage["usage"])
    const cost = asRecord(usage?.["cost"])
    const costUsd = typeof cost?.["total"] === "number" ? cost["total"] : undefined
    return {
      answer,
      usage: {
        inputTokens: typeof usage?.["input"] === "number" ? usage["input"] : 0,
        outputTokens: typeof usage?.["output"] === "number" ? usage["output"] : 0,
        ...(costUsd === undefined ? {} : { costUsd })
      }
    }
  },
  catch: (cause) => new BenchmarkError({ message: `Could not parse pi output: ${String(cause)}` })
})

const evaluateAgent = Effect.fn("Benchmark.evaluateAgent")(function* (
  testCase: BenchmarkCase,
  rule: Domain.ReviewRule,
  model: string,
  thinking: string
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const command = ChildProcess.make("pi", [
    "--mode", "json",
    "--print",
    "--no-tools",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--model", model,
    "--thinking", thinking,
    agentPrompt(testCase, rule)
  ], { cwd: root, stdin: "ignore" })
  const startedAt = Date.now()
  const handle = yield* spawner.spawn(command).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: `Could not start pi: ${String(cause)}` }))
  )
  const [stdout, stderr, exitCode] = yield* Effect.all([
    Stream.mkString(Stream.decodeText(handle.stdout)),
    Stream.mkString(Stream.decodeText(handle.stderr)),
    handle.exitCode
  ], { concurrency: "unbounded" }).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: `pi failed: ${String(cause)}` }))
  )
  if (Number(exitCode) !== 0) {
    return yield* new BenchmarkError({ message: `pi exited ${exitCode}: ${stderr.trim()}` })
  }
  const parsed = yield* extractAgentMessage(stdout)
  const confidence = Math.max(0, Math.min(1, parsed.answer.confidence))
  return {
    status: parsed.answer.violation ? "violation" : "compliant",
    violationProbability: parsed.answer.violation ? confidence : 1 - confidence,
    reportedConfidence: confidence,
    latencyMs: Date.now() - startedAt,
    usage: parsed.usage,
    explanation: parsed.answer.explanation,
    relevantLines: parsed.answer.relevantLines
  } satisfies Evaluation
})

const metrics = (results: ReadonlyArray<CaseResult>, select: (result: CaseResult) => Evaluation) => {
  let truePositive = 0
  let trueNegative = 0
  let falsePositive = 0
  let falseNegative = 0
  let inconclusivePositive = 0
  let inconclusiveNegative = 0
  let latencyMs = 0
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  let costReported = true
  for (const result of results) {
    const expected = result.expected === "violation"
    const evaluation = select(result)
    if (evaluation.status === "inconclusive") {
      if (expected) inconclusivePositive += 1
      else inconclusiveNegative += 1
    } else if (expected && evaluation.status === "violation") truePositive += 1
    else if (!expected && evaluation.status === "compliant") trueNegative += 1
    else if (!expected && evaluation.status === "violation") falsePositive += 1
    else falseNegative += 1
    latencyMs += evaluation.latencyMs
    inputTokens += evaluation.usage.inputTokens
    outputTokens += evaluation.usage.outputTokens
    if (evaluation.usage.costUsd === undefined) costReported = false
    else costUsd += evaluation.usage.costUsd
  }
  const actualPositive = truePositive + falseNegative + inconclusivePositive
  const decided = truePositive + trueNegative + falsePositive + falseNegative
  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive)
  const confirmedRecall = actualPositive === 0 ? 0 : truePositive / actualPositive
  const candidateRecall = actualPositive === 0 ? 0 : (truePositive + inconclusivePositive) / actualPositive
  return {
    strictAccuracy: results.length === 0 ? 0 : (truePositive + trueNegative) / results.length,
    coverage: results.length === 0 ? 0 : decided / results.length,
    decidedAccuracy: decided === 0 ? 0 : (truePositive + trueNegative) / decided,
    precision,
    confirmedRecall,
    candidateRecall,
    confirmedF1: precision + confirmedRecall === 0 ? 0 : 2 * precision * confirmedRecall / (precision + confirmedRecall),
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    inconclusivePositive,
    inconclusiveNegative,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd: costReported ? costUsd : null
  }
}

const main = Effect.gen(function*() {
  const options = argumentsOf(process.argv.slice(2))
  const fs = yield* FileSystem.FileSystem
  const source = yield* fs.readFileString(`${root}/benchmark/cases.yaml`)
  const unknownCorpus = yield* Effect.try({
    try: () => YAML.parse(source) as unknown,
    catch: (cause) => new BenchmarkError({ message: `Invalid benchmark YAML: ${String(cause)}` })
  })
  const corpus = yield* Schema.decodeUnknownEffect(Corpus)(unknownCorpus).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: `Invalid benchmark corpus: ${cause.message}` }))
  )
  const rules = yield* RuleCatalog.load(`${root}/examples/unsafe-service`).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: cause.message }))
  )
  const byId = new Map(rules.map((rule) => [rule.id, rule]))
  const results: Array<CaseResult> = []
  const selectedCases = corpus.cases.slice(0, options.limit)

  for (const testCase of selectedCases) {
    const rule = byId.get(testCase.ruleId)
    if (rule === undefined) {
      return yield* new BenchmarkError({ message: `Unknown rule ${testCase.ruleId} in ${testCase.id}` })
    }
    yield* Console.error(`[${results.length + 1}/${selectedCases.length}] ${testCase.id}`)
    const jev = yield* evaluateJev(testCase, rule)
    yield* Console.error(
      `  Jev: ${jev.status} ` +
      `(screen p=${Math.round((jev.screeningProbability ?? 0) * 100)}%, ` +
      `final p=${Math.round(jev.violationProbability * 100)}%, ${jev.latencyMs}ms)`
    )
    const agent = yield* evaluateAgent(testCase, rule, options.model, options.thinking)
    yield* Console.error(
      `  Agent: ${agent.status} ` +
      `(violation p=${Math.round(agent.violationProbability * 100)}%, ${agent.latencyMs}ms)`
    )
    results.push({ id: testCase.id, ruleId: testCase.ruleId, expected: testCase.expected, jev, agent })
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    corpus: "benchmark/cases.yaml",
    cases: results.length,
    providers: {
      jev: { model: "jev-latest", metrics: metrics(results, (result) => result.jev) },
      agent: { model: options.model, thinking: options.thinking, metrics: metrics(results, (result) => result.agent) }
    },
    results
  }
  yield* Console.log(JSON.stringify(report, null, 2))
}).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, Ai.decisionModelLayer)),
  Effect.scoped,
  Effect.catchTag("BenchmarkError", (error) => Console.error(`benchmark: ${error.message}`).pipe(Effect.andThen(Effect.fail(error))))
)

NodeRuntime.runMain(main)
