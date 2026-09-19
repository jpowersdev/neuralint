import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import { createHash } from "node:crypto"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

import * as Domain from "../../src/Domain.js"

const Expected = Schema.Struct({
  ruleId: Schema.String,
  path: Schema.String
})

const ReviewFinding = Schema.Struct({
  ruleId: Schema.String,
  status: Domain.FindingStatus,
  path: Schema.String,
  explanation: Schema.String,
  evidence: Schema.Array(Schema.String),
  suggestion: Schema.String
})

type ReviewFinding = typeof ReviewFinding.Type

const CandidateFinding = Schema.Struct({
  ruleId: Schema.String,
  status: Domain.FindingStatus,
  path: Schema.String,
  screeningProbability: Schema.Number,
  violationProbability: Schema.Number,
  hunkId: Schema.String,
  evidence: Schema.Array(Schema.String)
})

const Evaluation = Schema.Struct({ findings: Schema.Array(ReviewFinding) })
const CandidateEvaluation = Schema.Struct({ findings: Schema.Array(CandidateFinding) })

const SourceResult = Schema.Struct({
  schemaVersion: Schema.Number,
  generatedAt: Schema.String,
  repository: Schema.Struct({
    name: Schema.String,
    url: Schema.String,
    commit: Schema.String
  }),
  rules: Schema.Number,
  results: Schema.Array(Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    expected: Schema.Array(Expected),
    neuralint: CandidateEvaluation,
    competitors: Schema.Struct({ "terra-low": Evaluation }),
    handoffs: Schema.Struct({ "terra-low": Evaluation })
  }))
})

const Manifest = Schema.Struct({
  scenarios: Schema.Array(Schema.Struct({
    id: Schema.String,
    patch: Schema.String
  }))
})

const Provenance = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  rules: Schema.Array(Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    title: Schema.String,
    source: Schema.String,
    docsCommit: Schema.String
  }))
})

class FixtureError extends Data.TaggedError("FixtureError")<{
  readonly message: string
}> {}

const qualityDirectory = fileURLToPath(new URL(".", import.meta.url))
const benchmarkDirectory = fileURLToPath(new URL("..", import.meta.url))
const homeAssistantDirectory = Path.join(benchmarkDirectory, "home-assistant")
const sourceResultRelative = "benchmark/home-assistant/results/airgradient-54-terra-review-drafting.json"
const sourceResultPath = Path.join(homeAssistantDirectory, "results/airgradient-54-terra-review-drafting.json")
const outputPath = Path.join(qualityDirectory, "fixtures/home-assistant-54.json")

const decodeJson = <A>(decode: (input: unknown) => A, source: string, label: string) =>
  Effect.try({
    try: () => decode(JSON.parse(source) as unknown),
    catch: (cause) => new FixtureError({ message: `Invalid ${label}: ${String(cause)}` })
  })

const decodeYaml = <A>(decode: (input: unknown) => A, source: string, label: string) =>
  Effect.try({
    try: () => decode(YAML.parse(source) as unknown),
    catch: (cause) => new FixtureError({ message: `Invalid ${label}: ${String(cause)}` })
  })

const exactlyOne = <A>(values: ReadonlyArray<A>, label: string): Effect.Effect<A, FixtureError> => {
  const value = values[0]
  return values.length === 1 && value !== undefined
    ? Effect.succeed(value)
    : Effect.fail(new FixtureError({ message: `${label}: expected exactly one value, found ${values.length}` }))
}

const reviewComment = (policyTitle: string, finding: ReviewFinding): string => [
  `${policyTitle} (${finding.ruleId})`,
  "",
  finding.explanation,
  "",
  "Evidence:",
  ...finding.evidence.map((line) => `- ${line}`),
  "",
  "Suggested remediation:",
  finding.suggestion
].join("\n")

const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const [sourceText, manifestText, provenanceText] = yield* Effect.all([
    fs.readFileString(sourceResultPath),
    fs.readFileString(`${homeAssistantDirectory}/benchmark.yaml`),
    fs.readFileString(`${homeAssistantDirectory}/provenance.json`)
  ])
  const source = yield* decodeJson(
    Schema.decodeUnknownSync(SourceResult),
    sourceText,
    "source benchmark result"
  )
  const manifest = yield* decodeYaml(
    Schema.decodeUnknownSync(Manifest),
    manifestText,
    "Home Assistant benchmark manifest"
  )
  const provenance = yield* decodeJson(
    Schema.decodeUnknownSync(Provenance),
    provenanceText,
    "rule provenance"
  )
  const scenariosById = new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario]))
  const provenanceById = new Map(provenance.rules.map((rule) => [rule.id, rule]))

  const cases = []
  for (const scenario of source.results) {
    const expected = yield* exactlyOne(scenario.expected, `${scenario.id} expected finding`)
    const candidate = yield* exactlyOne(
      scenario.neuralint.findings.filter((finding) =>
        finding.ruleId === expected.ruleId && finding.path === expected.path),
      `${scenario.id} neuralint candidate`
    )
    const direct = yield* exactlyOne(
      scenario.competitors["terra-low"].findings.filter((finding) =>
        finding.ruleId === expected.ruleId && finding.path === expected.path),
      `${scenario.id} direct review`
    )
    const routed = yield* exactlyOne(
      scenario.handoffs["terra-low"].findings.filter((finding) =>
        finding.ruleId === expected.ruleId && finding.path === expected.path),
      `${scenario.id} routed review`
    )
    const scenarioManifest = scenariosById.get(scenario.id)
    if (scenarioManifest === undefined) {
      return yield* new FixtureError({ message: `Missing manifest scenario ${scenario.id}` })
    }
    const ruleProvenance = provenanceById.get(expected.ruleId)
    if (ruleProvenance === undefined) {
      return yield* new FixtureError({ message: `Missing provenance for ${expected.ruleId}` })
    }
    const ruleText = yield* fs.readFileString(`${homeAssistantDirectory}/rules/${ruleProvenance.slug}.yaml`)
    const policy = yield* decodeYaml(
      Schema.decodeUnknownSync(Domain.ReviewRule),
      ruleText,
      `rule ${expected.ruleId}`
    )

    cases.push({
      id: scenario.id,
      title: scenario.title,
      patch: `benchmark/home-assistant/${scenarioManifest.patch}`,
      groundTruth: {
        expectedViolation: true,
        ruleId: expected.ruleId,
        path: expected.path
      },
      policy: {
        id: policy.id,
        title: policy.title,
        description: policy.description,
        instructions: policy.instructions,
        violationCondition: policy.criteria.violation,
        complianceCondition: policy.criteria.compliant,
        source: ruleProvenance.source,
        sourceCommit: ruleProvenance.docsCommit
      },
      evidence: {
        hunkId: candidate.hunkId,
        diff: candidate.evidence.join("\n")
      },
      reviews: [
        {
          id: `${scenario.id}:direct`,
          workflow: "direct",
          model: "openai-codex/gpt-5.6-terra",
          thinking: "low",
          status: direct.status,
          explanation: direct.explanation,
          evidence: direct.evidence,
          suggestion: direct.suggestion,
          comment: reviewComment(policy.title, direct)
        },
        {
          id: `${scenario.id}:routed`,
          workflow: "routed",
          model: "openai-codex/gpt-5.6-terra",
          thinking: "low",
          status: routed.status,
          explanation: routed.explanation,
          evidence: routed.evidence,
          suggestion: routed.suggestion,
          comment: reviewComment(policy.title, routed)
        }
      ]
    })
  }

  const fixture = {
    schemaVersion: 1,
    source: {
      result: sourceResultRelative,
      sha256: createHash("sha256").update(sourceText).digest("hex"),
      generatedAt: source.generatedAt,
      repository: source.repository,
      ruleCount: source.rules
    },
    cases
  }
  const encoded = `${JSON.stringify(fixture, null, 2)}\n`

  if (process.argv.includes("--check")) {
    const existing = yield* fs.readFileString(outputPath).pipe(
      Effect.mapError(() => new FixtureError({ message: `Fixture does not exist: ${outputPath}` }))
    )
    if (existing !== encoded) {
      return yield* new FixtureError({ message: "Committed quality fixture is stale; run pnpm quality:fixture" })
    }
    yield* Console.log(`Fixture is current: ${cases.length} cases, ${cases.length * 2} reviews`)
    return
  }

  yield* fs.makeDirectory(Path.join(qualityDirectory, "fixtures"), { recursive: true })
  yield* fs.writeFileString(outputPath, encoded)
  yield* Console.log(`Wrote ${outputPath}: ${cases.length} cases, ${cases.length * 2} reviews`)
}).pipe(
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  Effect.catchTag("FixtureError", (error) =>
    Console.error(`quality fixture: ${error.message}`).pipe(Effect.andThen(Effect.fail(error))))
)

NodeRuntime.runMain(main)
