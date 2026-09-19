import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

import * as Domain from "./Domain.js"
import * as UnifiedDiff from "./UnifiedDiff.js"

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

const runGit = Effect.fn("Git.run")(function* (root: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const handle = yield* spawner.spawn(ChildProcess.make("git", args, { cwd: root }))
  const [stdout, stderr, exitCode] = yield* Effect.all([
    Stream.mkString(Stream.decodeText(handle.stdout)),
    Stream.mkString(Stream.decodeText(handle.stderr)),
    handle.exitCode
  ], { concurrency: "unbounded" })
  return { stdout, stderr, exitCode: Number(exitCode) } satisfies CommandResult
})

export const diff = Effect.fn("Git.diff")(function* (
  root: string,
  base: string,
  contextLines: number
) {
  const mergeBase = yield* runGit(root, ["merge-base", base, "HEAD"]).pipe(
    Effect.mapError((cause) => new Domain.GitError({ operation: "merge-base", message: String(cause) }))
  )
  if (mergeBase.exitCode !== 0) {
    return yield* new Domain.GitError({
      operation: "merge-base",
      message: mergeBase.stderr.trim() || `git merge-base exited ${mergeBase.exitCode}`
    })
  }
  const baseCommit = mergeBase.stdout.trim()
  if (baseCommit === "") {
    return yield* new Domain.GitError({ operation: "merge-base", message: "git returned an empty merge base" })
  }
  const result = yield* runGit(root, [
    "diff",
    "--no-ext-diff",
    "--find-renames",
    `--unified=${contextLines}`,
    baseCommit,
    "HEAD",
    "--"
  ]).pipe(
    Effect.mapError((cause) => new Domain.GitError({ operation: "diff", message: String(cause) }))
  )
  if (result.exitCode !== 0) {
    return yield* new Domain.GitError({
      operation: "diff",
      message: result.stderr.trim() || `git diff exited ${result.exitCode}`
    })
  }
  return UnifiedDiff.parse(result.stdout, baseCommit, "HEAD")
})
