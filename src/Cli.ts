import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { Command, Flag } from "effect/unstable/cli"

import * as DirectInput from "./DirectInput.js"
import * as Domain from "./Domain.js"
import * as Git from "./Git.js"
import * as ProjectConfig from "./ProjectConfig.js"
import * as Report from "./Report.js"
import * as Review from "./Review.js"
import * as RuleCatalog from "./RuleCatalog.js"
import * as RuleDoctor from "./RuleDoctor.js"

const setExitCode = (code: number) => Effect.sync(() => {
  process.exitCode = code
})

const fail = (message: string) =>
  Console.error(`neuralint: ${message}`).pipe(
    Effect.andThen(setExitCode(2))
  )

const check = Command.make("check", {
  base: Flag.String("base").pipe(
    Flag.withAlias("b"),
    Flag.withDescription("Override the base branch or ref from .neuralint/config.yaml"),
    Flag.optional
  ),
  root: Flag.Directory("root", { mustExist: true }).pipe(
    Flag.withDescription("Repository root"),
    Flag.withDefault(".")
  ),
  format: Flag.Literals("format", ["text", "json"] as const).pipe(
    Flag.withDescription("Output format"),
    Flag.withDefault("text" as const)
  ),
  advisories: Flag.Boolean("advisories").pipe(
    Flag.withDescription("Include inconclusive semantic matches"),
    Flag.withDefault(false)
  ),
  failOn: Flag.Literals("fail-on", ["info", "warning", "error", "critical", "never"] as const).pipe(
    Flag.withDescription("Lowest definitive severity that exits 1"),
    Flag.optional
  ),
  rule: Flag.String("rule").pipe(
    Flag.withDescription("Evaluate only the rule with this ID"),
    Flag.optional
  ),
  stdin: Flag.Boolean("stdin").pipe(
    Flag.withDescription("Evaluate source text from stdin as newly proposed code"),
    Flag.withDefault(false)
  ),
  path: Flag.String("path").pipe(
    Flag.withDescription("Repository-relative path represented by stdin"),
    Flag.optional
  ),
  startLine: Flag.Int("start-line").pipe(
    Flag.withDescription("First source line represented by stdin"),
    Flag.withDefault(1)
  ),
  context: Flag.Int("context").pipe(
    Flag.withDescription("Unchanged lines retained around each diff hunk"),
    Flag.withDefault(20)
  ),
  plan: Flag.Boolean("plan").pipe(
    Flag.withDescription("Preflight assessment cases and request budgets without calling Jev"),
    Flag.withDefault(false)
  ),
  allowCustomPlanners: Flag.Boolean("allow-custom-planners").pipe(
    Flag.withDescription("Execute trusted repository assessment planner modules"),
    Flag.withDefault(false)
  ),
  maxStateChars: Flag.Int("max-state-chars").pipe(
    Flag.withDescription("Maximum patch characters in one Jev evidence pack"),
    Flag.withDefault(60_000)
  )
}, (options) =>
  Effect.gen(function*() {
    const config = yield* ProjectConfig.load(options.root)
    const base = Option.getOrElse(options.base, () => config.base)
    const failOn = Option.getOrElse(options.failOn, () => config.failOn)
    const catalog = yield* RuleCatalog.load(options.root)
    const rules = yield* Option.match(options.rule, {
      onNone: () => Effect.succeed(catalog),
      onSome: (ruleId) => {
        const rule = catalog.find((candidate) => candidate.id === ruleId)
        return rule === undefined
          ? Effect.fail(new Domain.RuleCatalogError({
            path: `${options.root}/${RuleCatalog.rulesDirectoryName}`,
            message: `unknown rule id ${ruleId}`
          }))
          : Effect.succeed([rule])
      }
    })
    const diff = options.stdin
      ? yield* Effect.gen(function*() {
        const filename = Option.getOrUndefined(options.path)
        if (filename === undefined) {
          return yield* new Domain.ReviewError({ stage: "stdin", message: "--path is required with --stdin" })
        }
        if (options.startLine < 1) {
          return yield* new Domain.ReviewError({ stage: "stdin", message: "--start-line must be at least 1" })
        }
        const source = yield* Effect.tryPromise({
          try: async () => {
            process.stdin.setEncoding("utf8")
            let value = ""
            for await (const chunk of process.stdin) value += chunk
            return value
          },
          catch: (cause) => new Domain.ReviewError({ stage: "stdin", message: String(cause) })
        })
        return DirectInput.fromText(filename, source, options.startLine)
      })
      : yield* Git.diff(options.root, base, options.context)
    const reviewOptions: Review.Options = {
      maxStateChars: options.maxStateChars,
      root: options.root,
      customPlanners: config.assessmentPlanners,
      allowCustomPlanners: options.allowCustomPlanners,
      limits: config.limits
    }
    if (options.plan) {
      const plan = yield* Review.plan(diff, rules, reviewOptions)
      const rendered = options.format === "json"
        ? `${JSON.stringify(plan, null, 2)}\n`
        : [
            `neuralint plan ${plan.base}..${plan.head}`,
            `${plan.files} file(s), ${plan.collectionBytes} collection byte(s), ${plan.rules} rule(s), ${plan.cases} assessment case(s)`,
            `${plan.requests} estimated Jev request(s), ${plan.estimatedInputTokens} estimated input tokens`,
            `Longest estimated binding: ${plan.longestBindingTokens} tokens`,
            "",
            ...plan.planners.map((planner) =>
              `${planner.ruleId}\t${planner.planner}\t${planner.cases} case(s)\t${planner.partitioning}`),
            "",
            "Preflight complete. No model requests were made."
          ].join("\n")
      yield* Console.log(rendered.trimEnd())
      yield* setExitCode(0)
      return
    }
    const report = yield* Review.run(diff, rules, reviewOptions)
    const visibleReport = options.advisories
      ? report
      : { ...report, findings: report.findings.filter((finding) => finding.status === "violation") }
    const output = yield* Report.render(visibleReport, options.format)
    yield* Console.log(output.trimEnd())
    yield* setExitCode(Report.exitCode(visibleReport, failOn))
  }).pipe(
    Effect.catchTags({
      GitError: (error) => fail(`${error.operation}: ${error.message}`),
      ProjectConfigError: (error) => fail(`${error.path}: ${error.message}`),
      ReviewError: (error) => fail(`${error.stage}: ${error.message}`),
      RuleCatalogError: (error) => fail(`${error.path}: ${error.message}`)
    })
  )
).pipe(
  Command.withDescription("Semantically lint changed code against repository rules")
)

const init = Command.make("init", {
  root: Flag.Directory("root", { mustExist: true }).pipe(
    Flag.withDescription("Repository root"),
    Flag.withDefault(".")
  ),
  base: Flag.String("base").pipe(
    Flag.withDescription("Default base branch or ref"),
    Flag.withDefault("main")
  )
}, (options) =>
  Effect.gen(function*() {
    const result = yield* ProjectConfig.initialize(options.root, options.base)
    if (result.created.length === 0) {
      yield* Console.log("neuralint is already initialized; no files changed")
      return
    }
    yield* Console.log([
      "Initialized neuralint:",
      ...result.created.map((filename) => `  created ${filename}`),
      ...result.existing.map((filename) => `  kept    ${filename}`),
      "",
      "Next:",
      "  1. Edit the example rule for your repository.",
      "  2. Set TYPESAFE_API_KEY.",
      "  3. Run neuralint check."
    ].join("\n"))
  }).pipe(
    Effect.catchTag("ProjectConfigError", (error) => fail(`${error.path}: ${error.message}`))
  )
).pipe(
  Command.withDescription("Initialize repository configuration and an example semantic rule")
)

const ruleRoot = Flag.Directory("root", { mustExist: true }).pipe(
  Flag.withDescription("Repository root"),
  Flag.withDefault(".")
)

const rulesValidate = Command.make("validate", { root: ruleRoot }, (options) =>
  RuleCatalog.load(options.root).pipe(
    Effect.flatMap((rules) => Console.log(`Valid rule catalog: ${rules.length} rule${rules.length === 1 ? "" : "s"}`)),
    Effect.catchTag("RuleCatalogError", (error) => fail(`${error.path}: ${error.message}`))
  )
).pipe(Command.withDescription("Validate every repository rule"))

const rulesList = Command.make("list", { root: ruleRoot }, (options) =>
  RuleCatalog.load(options.root).pipe(
    Effect.flatMap((rules) => Console.log(rules.map((rule) => {
      const planner = rule.assessment?.planner ?? "semantic-chunks"
      return `${rule.id}\t${rule.severity}\t${planner}\t${rule.title}`
    }).join("\n"))),
    Effect.catchTag("RuleCatalogError", (error) => fail(`${error.path}: ${error.message}`))
  )
).pipe(Command.withDescription("List repository rules"))

const rulesDoctor = Command.make("doctor", {
  root: ruleRoot,
  rule: Flag.String("rule").pipe(Flag.withDescription("Rule ID to diagnose")),
  source: Flag.String("source").pipe(
    Flag.withDescription("Repository-relative source guidance file"),
    Flag.optional
  ),
  output: Flag.String("output").pipe(
    Flag.withDescription("Repository-relative doctor report directory"),
    Flag.withDefault(".neuralint/doctor")
  ),
  explain: Flag.Boolean("explain").pipe(
    Flag.withDescription("Ask Astra to explain Jev concerns without rewriting the rule"),
    Flag.withDefault(false)
  )
}, (options) => Effect.gen(function*() {
  const source = Option.getOrUndefined(options.source)
  const result = yield* RuleDoctor.run({
    root: options.root,
    ruleId: options.rule,
    output: options.output,
    explain: options.explain,
    ...(source === undefined ? {} : { source })
  })
  yield* Console.log([
    `Diagnosed ${options.rule} with Jev: ${result.issues} failure${result.issues === 1 ? "" : "s"}, ${result.advisories} advisor${result.advisories === 1 ? "y" : "ies"}`,
    `  report: ${result.reportPath}`,
    result.explained
      ? `  explained by: ${result.model} ($${result.explanationUsage?.costUsd.toFixed(5) ?? "unknown"})`
      : "  Astra was not called.",
    "Active policy was not modified."
  ].join("\n"))
}).pipe(
  Effect.catchTags({
    RuleCatalogError: (error) => fail(`${error.path}: ${error.message}`),
    RuleDoctorError: (error) => fail(`${error.stage}: ${error.message}`)
  })
)).pipe(Command.withDescription("Diagnose rule quality with Jev and optionally explain concerns with Astra"))

const rules = Command.make("rules").pipe(
  Command.withDescription("Inspect and maintain the repository rule catalog"),
  Command.withSubcommands([rulesList, rulesValidate, rulesDoctor])
)

export const command = Command.make("neuralint").pipe(
  Command.withDescription("Fast semantic linting and focused AI remediation for changed code"),
  Command.withSubcommands([init, check, rules])
)
