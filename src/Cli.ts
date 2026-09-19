import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import { Command, Flag } from "effect/unstable/cli"

import * as Git from "./Git.js"
import * as Report from "./Report.js"
import * as Review from "./Review.js"
import * as RuleCatalog from "./RuleCatalog.js"

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
    Flag.withDescription("Base branch or ref; neuralint compares its merge base with HEAD"),
    Flag.withDefault("main")
  ),
  root: Flag.Directory("root", { mustExist: true }).pipe(
    Flag.withDescription("Repository root"),
    Flag.withDefault(".")
  ),
  format: Flag.Literals("format", ["text", "json"] as const).pipe(
    Flag.withDescription("Output format"),
    Flag.withDefault("text" as const)
  ),
  context: Flag.Int("context").pipe(
    Flag.withDescription("Unchanged lines retained around each diff hunk"),
    Flag.withDefault(20)
  ),
  maxStateChars: Flag.Int("max-state-chars").pipe(
    Flag.withDescription("Maximum patch characters in one Jev evidence pack"),
    Flag.withDefault(60_000)
  )
}, (options) =>
  Effect.gen(function*() {
    const rules = yield* RuleCatalog.load(options.root)
    const diff = yield* Git.diff(options.root, options.base, options.context)
    const report = yield* Review.run(diff, rules, { maxStateChars: options.maxStateChars })
    const output = yield* Report.render(report, options.format)
    yield* Console.log(output.trimEnd())
    yield* setExitCode(Report.exitCode(report))
  }).pipe(
    Effect.catchTags({
      GitError: (error) => fail(`${error.operation}: ${error.message}`),
      ReviewError: (error) => fail(`${error.stage}: ${error.message}`),
      RuleCatalogError: (error) => fail(`${error.path}: ${error.message}`)
    })
  )
).pipe(
  Command.withDescription("Check repository review rules against the diff from a base ref to HEAD")
)

export const command = Command.make("neuralint").pipe(
  Command.withDescription("AI code review against your repository's rules, powered by Jev"),
  Command.withSubcommands([check])
)
