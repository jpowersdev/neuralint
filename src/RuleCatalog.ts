import * as FileSystem from "effect/FileSystem"
import * as Effect from "effect/Effect"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { minimatch } from "minimatch"
import * as YAML from "yaml"

import * as Domain from "./Domain.js"

export const rulesDirectoryName = ".neuralint/rules"

const decodeRule = Effect.fn("RuleCatalog.decodeRule")(function* (path: string, source: string) {
  const parsed = yield* Effect.try({
    try: (): unknown => YAML.parse(source),
    catch: (cause) => new Domain.RuleCatalogError({ path, message: `invalid YAML: ${String(cause)}` })
  })
  const rule = yield* Schema.decodeUnknownEffect(Domain.ReviewRule)(parsed).pipe(
    Effect.mapError((cause) => new Domain.RuleCatalogError({ path, message: cause.message }))
  )
  if (
    !Number.isFinite(rule.thresholds.screenAt) ||
    !Number.isFinite(rule.thresholds.violationAt) ||
    rule.thresholds.screenAt < 0 ||
    rule.thresholds.violationAt > 1 ||
    rule.thresholds.screenAt > rule.thresholds.violationAt
  ) {
    return yield* new Domain.RuleCatalogError({
      path,
      message: "thresholds must satisfy 0 <= screenAt <= violationAt <= 1"
    })
  }
  return rule
})

export const load = Effect.fn("RuleCatalog.load")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.join(root, rulesDirectoryName)
  if (!(yield* fs.exists(directory))) {
    return yield* new Domain.RuleCatalogError({
      path: directory,
      message: `rule directory does not exist; expected ${rulesDirectoryName}`
    })
  }
  const relativeFiles = (yield* fs.glob("**/*.{yaml,yml}", { root: directory })).sort()
  if (relativeFiles.length === 0) {
    return yield* new Domain.RuleCatalogError({ path: directory, message: "no rule artifacts found" })
  }
  const rules = yield* Effect.forEach(relativeFiles, (relative) => {
    const filename = path.isAbsolute(relative) ? relative : path.join(directory, relative)
    return fs.readFileString(filename).pipe(
      Effect.mapError((cause) => new Domain.RuleCatalogError({ path: filename, message: String(cause) })),
      Effect.flatMap((source) => decodeRule(filename, source))
    )
  })
  const seen = new Map<string, string>()
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]
    const filename = relativeFiles[index]
    if (rule === undefined || filename === undefined) continue
    const previous = seen.get(rule.id)
    if (previous !== undefined) {
      return yield* new Domain.RuleCatalogError({
        path: filename,
        message: `duplicate rule id ${rule.id}; first declared in ${previous}`
      })
    }
    seen.set(rule.id, filename)
  }
  return rules
})

export const appliesToPath = (rule: Domain.ReviewRule, filename: string): boolean => {
  const normalized = filename.replaceAll("\\", "/")
  const included = rule.scope.include.some((pattern) => minimatch(normalized, pattern, { dot: true }))
  if (!included) return false
  return !rule.scope.exclude.some((pattern) => minimatch(normalized, pattern, { dot: true }))
}
