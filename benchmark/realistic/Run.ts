import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

import * as Ai from "../../src/Ai.js"
import type * as Domain from "../../src/Domain.js"
import * as Git from "../../src/Git.js"
import * as Review from "../../src/Review.js"
import * as RuleCatalog from "../../src/RuleCatalog.js"

const ExpectedFinding = Schema.Struct({
  ruleId: Schema.String,
  path: Schema.String
})

const Scenario = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  patch: Schema.String,
  expected: Schema.Array(ExpectedFinding)
})
type Scenario = typeof Scenario.Type

const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  repository: Schema.Struct({
    name: Schema.String,
    url: Schema.String,
    commit: Schema.String
  }),
  rules: Schema.String,
  scenarios: Schema.Array(Scenario)
})
type Manifest = typeof Manifest.Type

const PiCompetitor = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("pi"),
  model: Schema.String,
  thinking: Schema.String,
  tools: Schema.Array(Schema.String)
})

const ClaudeCompetitor = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("claude"),
  model: Schema.String,
  thinking: Schema.String,
  tools: Schema.Array(Schema.String)
})

const Competitor = Schema.Union([PiCompetitor, ClaudeCompetitor])
type Competitor = typeof Competitor.Type

const Competitors = Schema.Struct({
  version: Schema.Literal(1),
  competitors: Schema.Array(Competitor)
})

const FindingStatus = Schema.Literals(["violation", "inconclusive"])
const AgentFinding = Schema.Struct({
  ruleId: Schema.String,
  status: FindingStatus,
  path: Schema.String,
  explanation: Schema.String,
  evidence: Schema.Array(Schema.String),
  suggestion: Schema.String
})
type AgentFinding = typeof AgentFinding.Type

const AgentOutput = Schema.Struct({ findings: Schema.Array(AgentFinding) })

class BenchmarkError extends Data.TaggedError("BenchmarkError")<{
  readonly message: string
}> {}

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requests?: number
  readonly costUsd?: number
}

interface EvaluationFinding {
  readonly ruleId: string
  readonly status: "violation" | "inconclusive"
  readonly path: string
  readonly explanation?: string
  readonly evidence?: ReadonlyArray<string>
  readonly suggestion?: string
  readonly violationProbability?: number
  readonly screeningProbability?: number
  readonly hunkId?: string
}

interface Evaluation {
  readonly findings: ReadonlyArray<EvaluationFinding>
  readonly latencyMs: number
  readonly usage: Usage
}

interface HandoffEvaluation extends Evaluation {
  readonly drafterLatencyMs: number
  readonly drafterUsage: Usage
}

interface ScenarioResult {
  readonly id: string
  readonly title: string
  readonly expected: ReadonlyArray<{ readonly ruleId: string; readonly path: string }>
  readonly neuralint: Evaluation
  readonly competitors: Readonly<Record<string, Evaluation>>
  readonly handoffs: Readonly<Record<string, HandoffEvaluation>>
}

const projectRoot = fileURLToPath(new URL("../..", import.meta.url))
const argumentAfter = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const suiteArgument = argumentAfter("--suite")
const handoffFirst = process.argv.includes("--handoff-first")
const benchmarkDirectory = suiteArgument === undefined
  ? fileURLToPath(new URL(".", import.meta.url))
  : Path.resolve(projectRoot, suiteArgument)
const cacheDirectory = `${projectRoot}/benchmark/.cache`
const jevInputUsdPerMillionTokens = 0.042

const runCommand = Effect.fn("RealisticBenchmark.runCommand")(function* (
  executable: string,
  args: ReadonlyArray<string>,
  cwd: string
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const handle = yield* spawner.spawn(ChildProcess.make(executable, args, {
    cwd,
    stdin: "ignore",
    forceKillAfter: "5 seconds"
  })).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: `Could not start ${executable}: ${String(cause)}` }))
  )
  const [stdout, stderr, exitCode] = yield* Effect.all([
    Stream.mkString(Stream.decodeText(handle.stdout)),
    Stream.mkString(Stream.decodeText(handle.stderr)),
    handle.exitCode
  ], { concurrency: "unbounded" }).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: `${executable} failed: ${String(cause)}` }))
  )
  return { stdout, stderr, exitCode: Number(exitCode) } satisfies CommandResult
})

const runSuccessful = Effect.fn("RealisticBenchmark.runSuccessful")(function* (
  executable: string,
  args: ReadonlyArray<string>,
  cwd: string
) {
  const result = yield* runCommand(executable, args, cwd)
  if (result.exitCode !== 0) {
    return yield* new BenchmarkError({
      message: `${executable} ${args.join(" ")} exited ${result.exitCode}: ${result.stderr.trim()}`
    })
  }
  return result
})

const parseYaml = (source: string, label: string) =>
  Effect.try({
    try: () => YAML.parse(source) as unknown,
    catch: (cause) => new BenchmarkError({ message: `Invalid ${label} YAML: ${String(cause)}` })
  })

const ensureRepository = Effect.fn("RealisticBenchmark.ensureRepository")(function* (manifest: Manifest) {
  const fs = yield* FileSystem.FileSystem
  const repository = `${cacheDirectory}/${manifest.repository.name.replaceAll("/", "--")}`
  yield* fs.makeDirectory(cacheDirectory, { recursive: true })
  if (!(yield* fs.exists(`${repository}/.git`))) {
    yield* Console.error(`Cloning ${manifest.repository.url}`)
    yield* runSuccessful("git", ["clone", "--filter=blob:none", manifest.repository.url, repository], projectRoot)
  }
  const hasCommit = yield* runCommand("git", ["cat-file", "-e", `${manifest.repository.commit}^{commit}`], repository)
  if (hasCommit.exitCode !== 0) {
    yield* runSuccessful("git", ["fetch", "origin", manifest.repository.commit], repository)
  }
  return repository
})

const prepareScenario = Effect.fn("RealisticBenchmark.prepareScenario")(function* (
  manifest: Manifest,
  repository: string,
  scenario: Scenario
) {
  const fs = yield* FileSystem.FileSystem
  const checkout = yield* fs.makeTempDirectoryScoped({ prefix: `neuralint-${scenario.id}-` })
  yield* runSuccessful("git", ["clone", "--shared", "--quiet", repository, checkout], projectRoot)
  yield* runSuccessful("git", ["checkout", "--quiet", "--detach", manifest.repository.commit], checkout)
  const repositoryRules = `${checkout}/${RuleCatalog.rulesDirectoryName}`
  const rulesParent = repositoryRules.slice(0, repositoryRules.lastIndexOf("/"))
  yield* fs.makeDirectory(rulesParent, { recursive: true })
  yield* fs.copy(`${benchmarkDirectory}/${manifest.rules}`, repositoryRules)
  yield* runSuccessful("git", ["apply", `${benchmarkDirectory}/${scenario.patch}`], checkout)
  yield* runSuccessful("git", ["add", "--update"], checkout)
  yield* runSuccessful("git", [
    "-c", "user.name=neuralint Benchmark",
    "-c", "user.email=benchmark@neuralint.local",
    "commit", "--quiet", "-m", scenario.title
  ], checkout)
  return checkout
})

const evaluateNeuralint = Effect.fn("RealisticBenchmark.evaluateNeuralint")(function* (
  checkout: string,
  base: string
) {
  const startedAt = Date.now()
  const rules = yield* RuleCatalog.load(checkout).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: cause.message }))
  )
  const diff = yield* Git.diff(checkout, base, 8).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: cause.message }))
  )
  const report = yield* Review.run(diff, rules, { maxStateChars: 24_000 }).pipe(
    Effect.mapError((cause) => new BenchmarkError({ message: cause.message }))
  )
  return {
    findings: report.findings.map((finding) => ({
      ruleId: finding.ruleId,
      status: finding.status,
      path: finding.path,
      violationProbability: finding.violationProbability,
      screeningProbability: finding.screeningProbability,
      hunkId: finding.hunkId,
      evidence: [finding.relevantDiff]
    })),
    latencyMs: Date.now() - startedAt,
    usage: {
      requests: report.usage.requests,
      inputTokens: report.usage.inputTokens,
      outputTokens: report.usage.outputTokens,
      costUsd: report.usage.inputTokens / 1_000_000 * jevInputUsdPerMillionTokens
    }
  } satisfies Evaluation
})

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const extractAgentOutput = (stdout: string) => Effect.try({
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
    const output = Schema.decodeUnknownSync(AgentOutput)(JSON.parse(text.slice(start, end + 1)))
    const usage = asRecord(finalMessage["usage"])
    const cost = asRecord(usage?.["cost"])
    const costUsd = typeof cost?.["total"] === "number" ? cost["total"] : undefined
    return {
      output,
      usage: {
        inputTokens: typeof usage?.["input"] === "number" ? usage["input"] : 0,
        outputTokens: typeof usage?.["output"] === "number" ? usage["output"] : 0,
        ...(costUsd === undefined ? {} : { costUsd })
      }
    }
  },
  catch: (cause) => new BenchmarkError({ message: `Could not parse pi output: ${String(cause)}` })
})

const directAgentPrompt = (base: string): string => `Review this repository's synthetic pull request as a read-only policy reviewer.

Instructions:
1. Read every YAML policy under ${RuleCatalog.rulesDirectoryName}/.
2. Inspect the diff from ${base} to HEAD and any repository context needed to decide those policies.
3. Do not modify files, install dependencies, or access the network.
4. Report only candidate violations or genuinely inconclusive policy matches. Do not report compliant policies.
5. A violation must be introduced or worsened by this diff.

For each finding, explain the concrete impact and suggest a safer implementation or corrective direction suitable for a pull-request review comment.

Return only a JSON object of this exact shape:
{"findings":[{"ruleId":string,"status":"violation"|"inconclusive","path":string,"explanation":string,"evidence":string[],"suggestion":string}]}

Use repository-relative paths. Evidence entries must quote decisive changed lines. If there are no findings, return {"findings":[]}.`

const handoffPrompt = (
  base: string,
  candidates: ReadonlyArray<EvaluationFinding>,
  rules: ReadonlyArray<Domain.ReviewRule>
): string => {
  const rulesById = new Map<string, Domain.ReviewRule>(rules.map((rule) => [rule.id, rule]))
  const packets = candidates.map((candidate) => {
    const rule = rulesById.get(candidate.ruleId)
    return {
      candidate: {
        ruleId: candidate.ruleId,
        status: candidate.status,
        path: candidate.path,
        screeningProbability: candidate.screeningProbability,
        violationProbability: candidate.violationProbability,
        evidence: candidate.evidence
      },
      policy: rule === undefined ? undefined : {
        title: rule.title,
        description: rule.description,
        instructions: rule.instructions,
        violationCondition: rule.criteria.violation,
        complianceCondition: rule.criteria.compliant
      }
    }
  })
  return `Act as the pull-request review drafting stage after a high-recall policy classifier.

The classifier reviewed the diff from ${base} to HEAD and routed only the candidate policy violations below. Do not repeat broad policy discovery, verify or reject the classifier's routing decisions, or filter candidates. Instead, investigate repository context as needed and turn every packet into a useful review comment. Do not modify files, install dependencies, or access the network.

Return exactly one review for every packet. Preserve the packet's supplied status. For each packet:
- explain concretely what the changed code does wrong and why it matters;
- quote the decisive changed lines;
- suggest a safer implementation or corrective direction;
- if context is insufficient, explain the uncertainty while still producing the review.

Candidate packets:
${JSON.stringify(packets, null, 2)}

Return only a JSON object of this exact shape:
{"findings":[{"ruleId":string,"status":"violation"|"inconclusive","path":string,"explanation":string,"evidence":string[],"suggestion":string}]}

Use each packet's exact rule ID, path, and status. Evidence entries must quote decisive changed lines. The findings array must contain exactly one entry corresponding to each candidate packet.`
}

const evaluatePiPromptOnce = Effect.fn("RealisticBenchmark.evaluatePiPrompt")(function* (
  competitor: typeof PiCompetitor.Type,
  checkout: string,
  prompt: string
) {
  const startedAt = Date.now()
  const result = yield* runSuccessful("pi", [
    "--mode", "json",
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--approve",
    "--tools", competitor.tools.join(","),
    "--model", competitor.model,
    "--thinking", competitor.thinking,
    prompt
  ], checkout)
  const parsed = yield* extractAgentOutput(result.stdout)
  const usage: Usage = parsed.usage
  return {
    findings: parsed.output.findings,
    latencyMs: Date.now() - startedAt,
    usage
  } satisfies Evaluation
})

const ClaudeCliOutput = Schema.Struct({
  is_error: Schema.Boolean,
  result: Schema.String,
  num_turns: Schema.Number,
  total_cost_usd: Schema.Number,
  structured_output: AgentOutput,
  modelUsage: Schema.Record(
    Schema.String,
    Schema.Struct({
      inputTokens: Schema.Number,
      outputTokens: Schema.Number,
      cacheReadInputTokens: Schema.Number,
      cacheCreationInputTokens: Schema.Number
    })
  )
})

const agentOutputJsonSchema = JSON.stringify({
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ruleId: { type: "string" },
          status: { type: "string", enum: ["violation", "inconclusive"] },
          path: { type: "string" },
          explanation: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          suggestion: { type: "string" }
        },
        required: ["ruleId", "status", "path", "explanation", "evidence", "suggestion"],
        additionalProperties: false
      }
    }
  },
  required: ["findings"],
  additionalProperties: false
})

const evaluateClaudePromptOnce = Effect.fn("RealisticBenchmark.evaluateClaudePrompt")(function* (
  competitor: typeof ClaudeCompetitor.Type,
  checkout: string,
  prompt: string
) {
  const startedAt = Date.now()
  const tools = competitor.tools.join(",")
  const result = yield* runSuccessful("claude", [
    "--print",
    "--output-format", "json",
    "--safe-mode",
    "--setting-sources", "",
    "--disable-slash-commands",
    "--tools", tools,
    "--allowedTools", tools,
    "--permission-mode", "dontAsk",
    "--system-prompt",
    "Act as a read-only repository policy reviewer. Use only the supplied tools, do not modify files or access the network, and return exactly the requested JSON.",
    "--model", competitor.model,
    "--effort", competitor.thinking,
    "--json-schema", agentOutputJsonSchema,
    prompt
  ], checkout)
  const parsed = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(ClaudeCliOutput)(JSON.parse(result.stdout) as unknown),
    catch: (cause) => new BenchmarkError({ message: `Could not parse Claude CLI output: ${String(cause)}` })
  })
  if (parsed.is_error) {
    return yield* new BenchmarkError({ message: `Claude CLI reported an error: ${parsed.result}` })
  }
  const agent = parsed.structured_output
  const modelUsage = Object.values(parsed.modelUsage)
  return {
    findings: agent.findings,
    latencyMs: Date.now() - startedAt,
    usage: {
      requests: parsed.num_turns,
      inputTokens: modelUsage.reduce(
        (total, usage) => total + usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
        0
      ),
      outputTokens: modelUsage.reduce((total, usage) => total + usage.outputTokens, 0),
      costUsd: parsed.total_cost_usd
    }
  } satisfies Evaluation
})

const evaluateCompetitorPrompt = (
  competitor: Competitor,
  checkout: string,
  prompt: string
) => (
  competitor.kind === "pi"
    ? evaluatePiPromptOnce(competitor, checkout, prompt)
    : evaluateClaudePromptOnce(competitor, checkout, prompt)
).pipe(Effect.retry({ times: 2 }))

const evaluateHandoff = Effect.fn("RealisticBenchmark.evaluateHandoff")(function* (
  competitor: Competitor,
  checkout: string,
  base: string,
  upstream: Evaluation,
  rules: ReadonlyArray<Domain.ReviewRule>
) {
  if (upstream.findings.length === 0) {
    return {
      findings: [],
      latencyMs: upstream.latencyMs,
      usage: upstream.usage,
      drafterLatencyMs: 0,
      drafterUsage: { inputTokens: 0, outputTokens: 0, requests: 0 }
    } satisfies HandoffEvaluation
  }
  const drafter = yield* evaluateCompetitorPrompt(
    competitor,
    checkout,
    handoffPrompt(base, upstream.findings, rules)
  )
  const draftByCandidate = new Map(
    drafter.findings.map((finding) => [`${finding.ruleId}:${finding.path}`, finding])
  )
  const retainedFindings = upstream.findings.map((candidate) => {
    const draft = draftByCandidate.get(`${candidate.ruleId}:${candidate.path}`)
    return draft === undefined
      ? {
        ...candidate,
        explanation: "The drafting agent omitted this routed candidate; it remains queued for review.",
        suggestion: "Inspect the cited policy and diff before accepting the change."
      }
      : { ...draft, status: candidate.status }
  })
  const upstreamCost = upstream.usage.costUsd
  const drafterCost = drafter.usage.costUsd
  const totalCost = upstreamCost === undefined || drafterCost === undefined
    ? undefined
    : upstreamCost + drafterCost
  return {
    findings: retainedFindings,
    latencyMs: upstream.latencyMs + drafter.latencyMs,
    usage: {
      inputTokens: upstream.usage.inputTokens + drafter.usage.inputTokens,
      outputTokens: upstream.usage.outputTokens + drafter.usage.outputTokens,
      requests: (upstream.usage.requests ?? 0) + (drafter.usage.requests ?? 1),
      ...(totalCost === undefined ? {} : { costUsd: totalCost })
    },
    drafterLatencyMs: drafter.latencyMs,
    drafterUsage: drafter.usage
  } satisfies HandoffEvaluation
})

const findingKey = (finding: { readonly ruleId: string; readonly path: string }): string =>
  `${finding.ruleId}:${finding.path}`

const metrics = (
  results: ReadonlyArray<ScenarioResult>,
  select: (result: ScenarioResult) => Evaluation,
  rulesPerScenario: number
) => {
  let expectedCount = 0
  let confirmedTruePositive = 0
  let candidateTruePositive = 0
  let candidateFalsePositive = 0
  let prsWithExpectedCandidates = 0
  let routedPrs = 0
  let latencyMs = 0
  let inputTokens = 0
  let outputTokens = 0
  let requests = 0
  let costUsd = 0
  let costReported = true
  for (const result of results) {
    const expected = new Set(result.expected.map(findingKey))
    const evaluation = select(result)
    const candidates = new Map(evaluation.findings.map((finding) => [findingKey(finding), finding]))
    expectedCount += expected.size
    if (candidates.size > 0) routedPrs += 1
    let foundExpectedInPr = false
    for (const key of expected) {
      const finding = candidates.get(key)
      if (finding !== undefined) {
        foundExpectedInPr = true
        candidateTruePositive += 1
        if (finding.status === "violation") confirmedTruePositive += 1
      }
    }
    if (foundExpectedInPr) prsWithExpectedCandidates += 1
    for (const key of candidates.keys()) {
      if (!expected.has(key)) candidateFalsePositive += 1
    }
    latencyMs += evaluation.latencyMs
    inputTokens += evaluation.usage.inputTokens
    outputTokens += evaluation.usage.outputTokens
    requests += evaluation.usage.requests ?? 1
    if (evaluation.usage.costUsd === undefined) costReported = false
    else costUsd += evaluation.usage.costUsd
  }
  const candidateCount = candidateTruePositive + candidateFalsePositive
  const reviewedPairs = results.length * rulesPerScenario
  return {
    expectedFindings: expectedCount,
    confirmedTruePositive,
    candidateTruePositive,
    candidateFalsePositive,
    confirmedRecall: expectedCount === 0 ? 0 : confirmedTruePositive / expectedCount,
    candidateRecall: expectedCount === 0 ? 0 : candidateTruePositive / expectedCount,
    candidatePrecision: candidateCount === 0 ? 0 : candidateTruePositive / candidateCount,
    prRecall: results.length === 0 ? 0 : prsWithExpectedCandidates / results.length,
    routedPrs,
    candidateRate: reviewedPairs === 0 ? 0 : candidateCount / reviewedPairs,
    reviewedRulePrPairs: reviewedPairs,
    latencyMs,
    requests,
    inputTokens,
    outputTokens,
    costUsd: costReported ? costUsd : null
  }
}

const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const [manifestSource, competitorsSource] = yield* Effect.all([
    fs.readFileString(`${benchmarkDirectory}/benchmark.yaml`),
    fs.readFileString(`${benchmarkDirectory}/competitors.yaml`)
  ])
  const manifestUnknown = yield* parseYaml(manifestSource, "benchmark manifest")
  const competitorsUnknown = yield* parseYaml(competitorsSource, "competitor configuration")
  const manifest = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Manifest)(manifestUnknown),
    catch: (cause) => new BenchmarkError({ message: `Invalid benchmark manifest: ${String(cause)}` })
  })
  const competitorConfig = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Competitors)(competitorsUnknown),
    catch: (cause) => new BenchmarkError({ message: `Invalid competitor configuration: ${String(cause)}` })
  })
  const repository = yield* ensureRepository(manifest)
  const scenarioResults: Array<ScenarioResult> = []
  let rulesPerScenario = 0

  for (const scenario of manifest.scenarios) {
    yield* Console.error(`[${scenarioResults.length + 1}/${manifest.scenarios.length}] ${scenario.id}`)
    const checkout = yield* prepareScenario(manifest, repository, scenario)
    const rules = yield* RuleCatalog.load(checkout).pipe(
      Effect.mapError((cause) => new BenchmarkError({ message: cause.message }))
    )
    rulesPerScenario = rules.length
    const neuralint = yield* evaluateNeuralint(checkout, manifest.repository.commit)
    yield* Console.error(`  neuralint: ${neuralint.findings.length} candidate(s), ${neuralint.latencyMs}ms`)
    const competitorResults: Record<string, Evaluation> = Object.create(null)
    const handoffResults: Record<string, HandoffEvaluation> = Object.create(null)
    for (const competitor of competitorConfig.competitors) {
      const runDirect = Effect.gen(function*() {
        const direct = yield* evaluateCompetitorPrompt(
          competitor,
          checkout,
          directAgentPrompt(manifest.repository.commit)
        )
        competitorResults[competitor.id] = direct
        yield* Console.error(
          `  ${competitor.id} direct: ${direct.findings.length} candidate(s), ${direct.latencyMs}ms`
        )
      })
      const runHandoff = Effect.gen(function*() {
        const handoff = yield* evaluateHandoff(
          competitor,
          checkout,
          manifest.repository.commit,
          neuralint,
          rules
        )
        handoffResults[competitor.id] = handoff
        yield* Console.error(
          `  neuralint -> ${competitor.id}: ${handoff.findings.length} finding(s), ` +
          `${handoff.latencyMs}ms end-to-end (${handoff.drafterLatencyMs}ms drafter)`
        )
      })
      if (handoffFirst) {
        yield* runHandoff
        yield* runDirect
      } else {
        yield* runDirect
        yield* runHandoff
      }
    }
    scenarioResults.push({
      id: scenario.id,
      title: scenario.title,
      expected: scenario.expected,
      neuralint,
      competitors: competitorResults,
      handoffs: handoffResults
    })
  }

  const competitors = Object.fromEntries(competitorConfig.competitors.map((competitor) => [
    competitor.id,
    {
      kind: competitor.kind,
      model: competitor.model,
      thinking: competitor.thinking,
      metrics: metrics(scenarioResults, (result) => result.competitors[competitor.id]!, rulesPerScenario)
    }
  ]))
  const handoffs = Object.fromEntries(competitorConfig.competitors.map((competitor) => [
    competitor.id,
    {
      upstream: "neuralint",
      drafter: competitor.model,
      thinking: competitor.thinking,
      costScope: "end-to-end; Jev input priced at $0.042/MTok with free output",
      metrics: metrics(scenarioResults, (result) => result.handoffs[competitor.id]!, rulesPerScenario),
      drafterMetrics: metrics(scenarioResults, (result) => {
        const handoff = result.handoffs[competitor.id]!
        return {
          findings: handoff.findings,
          latencyMs: handoff.drafterLatencyMs,
          usage: handoff.drafterUsage
        }
      }, rulesPerScenario)
    }
  ]))
  const report = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    repository: manifest.repository,
    scenarios: scenarioResults.length,
    rules: rulesPerScenario,
    evaluators: {
      neuralint: {
        model: "jev-latest",
        metrics: metrics(scenarioResults, (result) => result.neuralint, rulesPerScenario)
      },
      competitors,
      handoffs
    },
    results: scenarioResults
  }
  yield* Console.log(JSON.stringify(report, null, 2))
}).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, Ai.decisionModelLayer)),
  Effect.scoped,
  Effect.catchTag("BenchmarkError", (error) =>
    Console.error(`realistic benchmark: ${error.message}`).pipe(Effect.andThen(Effect.fail(error))))
)

NodeRuntime.runMain(main)
