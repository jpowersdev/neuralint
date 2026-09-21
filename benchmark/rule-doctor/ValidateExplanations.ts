import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import * as NodeServices from "@effect/platform-node/NodeServices"
import { ModelRuntime, ResourceLoader } from "@jpowersdev/effect-pi"
import * as Effect from "effect/Effect"
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore"
import * as Layer from "effect/Layer"
import * as YAML from "yaml"

import * as Ai from "../../src/Ai.js"
import * as RuleDoctor from "../../src/RuleDoctor.js"
import { cases } from "./Corpus.js"

const directory = path.dirname(fileURLToPath(import.meta.url))
const outputDirectory = path.join(directory, "results/explanation-validation")
const jsonPath = path.join(directory, "results/explanation-validation.json")

const selected = [
  {
    id: "good",
    corpusId: "good-bind-services",
    expectation: "No Jev concern crosses 45%, so Astra is not called."
  },
  {
    id: "defective",
    corpusId: "defective-underspecified",
    expectation: "Astra concisely explains the missing operational boundary and asks for human policy decisions without drafting replacement policy."
  },
  {
    id: "evidence-infeasible",
    ruleId: "OPENCODE_PREFER_BUN_APIS",
    sourcePath: path.join(directory, "fixtures/prefer-bun-apis.yaml"),
    expectation: "Astra distinguishes an evidence-planner limitation from missing organizational policy and does not recommend changing the policy boundary."
  }
] as const

const doctorModelLayer = ModelRuntime.layer({
  model: { provider: "openai-codex", id: "gpt-6-astra" },
  refreshOnCreate: false
}).pipe(
  Layer.provide(ResourceLoader.layerEmpty({
    systemPrompt: "Explain semantic-rule quality concerns without rewriting rules or inventing policy.",
    settings: { retry: { enabled: false } }
  }))
)

const doctorExplanationLayer = RuleDoctor.explanationModelLayer.pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, doctorModelLayer, KeyValueStore.layerMemory))
)

const runtimeLayer = Layer.mergeAll(NodeServices.layer, Ai.decisionModelLayer, doctorExplanationLayer)

const program = Effect.gen(function* () {
  const root = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "neuralint-doctor-validation-")))
  yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(root, { recursive: true, force: true })))
  const rulesDirectory = path.join(root, ".neuralint/rules")
  yield* Effect.promise(() => fs.mkdir(rulesDirectory, { recursive: true }))
  const results = []
  for (const fixture of selected) {
    const corpusId = "corpusId" in fixture ? fixture.corpusId : null
    const entry = corpusId === null ? undefined : cases.find((candidate) => candidate.id === corpusId)
    if (corpusId !== null && entry === undefined) throw new Error(`missing corpus case ${corpusId}`)
    const ruleId = "ruleId" in fixture ? fixture.ruleId : entry!.rule.id
    const ruleSource = "sourcePath" in fixture
      ? yield* Effect.promise(() => fs.readFile(fixture.sourcePath, "utf8"))
      : YAML.stringify(entry!.rule)
    yield* Effect.promise(() => fs.writeFile(path.join(rulesDirectory, `${fixture.id}.yaml`), ruleSource))
    const started = performance.now()
    const result = yield* RuleDoctor.run({
      root,
      ruleId,
      output: `doctor/${fixture.id}`,
      explain: true
    })
    const latencyMs = Math.round(performance.now() - started)
    const report = yield* Effect.promise(() => fs.readFile(result.reportPath, "utf8"))
    const savedReport = path.join(outputDirectory, `${fixture.id}.md`)
    yield* Effect.promise(async () => {
      await fs.mkdir(outputDirectory, { recursive: true })
      await fs.writeFile(savedReport, report)
    })
    results.push({
      id: fixture.id,
      corpusId,
      expectation: fixture.expectation,
      latencyMs,
      failures: result.issues,
      advisories: result.advisories,
      explained: result.explained,
      model: result.model ?? null,
      diagnosticsUsage: result.usage,
      explanationUsage: result.explanationUsage ?? null,
      report: path.relative(directory, savedReport)
    })
    yield* Effect.promise(() => fs.rm(path.join(rulesDirectory, `${fixture.id}.yaml`)))
  }
  const summary = {
    schemaVersion: 1,
    experiment: "rule-doctor-astra-validation",
    jevModel: "jev-latest",
    explanationModel: "openai-codex/gpt-6-astra",
    results,
    totals: {
      latencyMs: results.reduce((sum, result) => sum + result.latencyMs, 0),
      diagnosticsInputTokens: results.reduce((sum, result) => sum + result.diagnosticsUsage.inputTokens, 0),
      explanationInputTokens: results.reduce((sum, result) => sum + (result.explanationUsage?.inputTokens ?? 0), 0),
      explanationOutputTokens: results.reduce((sum, result) => sum + (result.explanationUsage?.outputTokens ?? 0), 0),
      explanationCostUsd: Math.round(results.reduce((sum, result) => sum + (result.explanationUsage?.costUsd ?? 0), 0) * 100_000) / 100_000
    }
  }
  yield* Effect.promise(() => fs.writeFile(jsonPath, JSON.stringify(summary, null, 2) + "\n"))
  console.log(JSON.stringify(summary, null, 2))
  console.log(`Wrote ${jsonPath}`)
})

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(runtimeLayer)))
