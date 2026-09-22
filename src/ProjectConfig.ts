import * as FileSystem from "effect/FileSystem"
import * as Effect from "effect/Effect"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as YAML from "yaml"

import * as Domain from "./Domain.js"

export const directoryName = ".neuralint"
export const configFileName = "config.yaml"

export const ProjectConfig = Schema.Struct({
  version: Schema.Literal(1),
  base: Schema.NonEmptyString,
  failOn: Schema.optionalKey(Domain.FailOn)
})
export type ProjectConfig = typeof ProjectConfig.Type

export interface InitializationResult {
  readonly created: ReadonlyArray<string>
  readonly existing: ReadonlyArray<string>
}

export const defaultFailOn: Domain.FailOn = "error"

const defaults = { version: 1, base: "main", failOn: defaultFailOn } as const

const exampleRule = {
  version: 1,
  id: "EXAMPLE_NO_SECRET_LOGGING",
  title: "Do not write secrets to logs",
  description: "Credentials, tokens, private keys, and secret configuration values must not be written to application logs.",
  severity: "critical",
  scope: {
    include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go", "**/*.rs", "**/*.java", "**/*.kt"],
    exclude: ["**/generated/**", "**/dist/**", "**/node_modules/**", "**/vendor/**"]
  },
  instructions: "Inspect changed logging calls and values that flow into them. Logging a secret's name or a safely redacted representation is compliant.",
  criteria: {
    violation: "Changed code logs a credential, token, private key, session secret, or secret configuration value in plaintext or in a reversibly encoded form.",
    compliant: "Changed logs exclude secret values, use an established redaction wrapper, or record only non-sensitive metadata such as a secret name."
  },
  thresholds: {
    screenAt: 0.35,
    violationAt: 0.8
  },
  assessment: {
    planner: "semantic-chunks"
  },
  semantic: {
    context: "Logs are routinely retained, aggregated, and exposed to more people and systems than production secrets. A useful diagnostic should identify the operation without recording the credential itself.",
    reportWhen: "The changed code sends an actual secret value, or an object containing one, to a logger or tracing field.",
    doNotReport: "Do not report secret identifiers, environment-variable names, boolean presence checks, or values passed through an established irreversible redaction mechanism.",
    guidance: "Remove the secret value from the log and retain only bounded, non-sensitive operation metadata. Use the repository's redaction abstraction when diagnostic correlation is required.",
    examples: [
      {
        outcome: "violation",
        explanation: "The changed log records the bearer token itself.",
        code: "logger.info(\"calling provider\", { token: config.apiToken })"
      },
      {
        outcome: "nonviolation",
        explanation: "The log records only whether credentials were configured.",
        code: "logger.info(\"provider configured\", { hasToken: config.apiToken.length > 0 })"
      }
    ]
  }
}

const decode = (path: string, source: string) =>
  Effect.gen(function*() {
    const parsed = yield* Effect.try({
      try: (): unknown => YAML.parse(source),
      catch: (cause) => new Domain.ProjectConfigError({ path, message: `invalid YAML: ${String(cause)}` })
    })
    const config = yield* Schema.decodeUnknownEffect(ProjectConfig)(parsed).pipe(
      Effect.mapError((cause) => new Domain.ProjectConfigError({ path, message: cause.message }))
    )
    return { ...config, failOn: config.failOn ?? defaultFailOn }
  })

export const load = Effect.fn("ProjectConfig.load")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const filename = path.join(root, directoryName, configFileName)
  if (!(yield* fs.exists(filename))) return defaults
  const source = yield* fs.readFileString(filename).pipe(
    Effect.mapError((cause) => new Domain.ProjectConfigError({ path: filename, message: String(cause) }))
  )
  return yield* decode(filename, source)
})

export const initialize = Effect.fn("ProjectConfig.initialize")(function* (root: string, base: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const git = path.join(root, ".git")
  if (!(yield* fs.exists(git))) {
    return yield* new Domain.ProjectConfigError({
      path: root,
      message: "not a Git repository; run neuralint init from a repository root or pass --root"
    })
  }

  const neuralint = path.join(root, directoryName)
  const rules = path.join(neuralint, "rules")
  const config = path.join(neuralint, configFileName)
  const example = path.join(rules, "no-secret-logging.yaml")
  const created: Array<string> = []
  const existing: Array<string> = []

  yield* fs.makeDirectory(rules, { recursive: true }).pipe(
    Effect.mapError((cause) => new Domain.ProjectConfigError({ path: rules, message: String(cause) }))
  )

  if (yield* fs.exists(config)) {
    existing.push(path.relative(root, config))
  } else {
    yield* fs.writeFileString(config, YAML.stringify({ version: 1, base, failOn: defaultFailOn })).pipe(
      Effect.mapError((cause) => new Domain.ProjectConfigError({ path: config, message: String(cause) }))
    )
    created.push(path.relative(root, config))
  }

  const existingRules = yield* fs.glob("**/*.{yaml,yml}", { root: rules }).pipe(
    Effect.mapError((cause) => new Domain.ProjectConfigError({ path: rules, message: String(cause) }))
  )
  if (existingRules.length > 0) {
    existing.push(`${path.relative(root, rules)}/`)
  } else {
    yield* fs.writeFileString(example, YAML.stringify(exampleRule)).pipe(
      Effect.mapError((cause) => new Domain.ProjectConfigError({ path: example, message: String(cause) }))
    )
    created.push(path.relative(root, example))
  }

  return { created, existing } satisfies InitializationResult
})
