import * as it from "@effect/vitest"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"

import * as ProjectConfig from "../src/ProjectConfig.js"
import * as RuleCatalog from "../src/RuleCatalog.js"

it.describe("ProjectConfig", () => {
  it.effect("initializes a repository without overwriting existing files", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-init-" })
      yield* fs.makeDirectory(`${root}/.git`)

      const first = yield* ProjectConfig.initialize(root, "origin/main")
      const config = yield* ProjectConfig.load(root)
      const rules = yield* RuleCatalog.load(root)
      const second = yield* ProjectConfig.initialize(root, "other")

      it.expect(first.created).toEqual([
        ".neuralint/config.yaml",
        ".neuralint/rules/no-secret-logging.yaml"
      ])
      it.expect(config.base).toBe("origin/main")
      it.expect(config.failOn).toBe("error")
      it.expect(config.assessmentPlanners).toEqual({})
      it.expect(config.limits).toEqual(ProjectConfig.defaultLimits)
      it.expect(yield* fs.readFileString(`${root}/.neuralint/config.yaml`)).toContain("failOn: error")
      it.expect(rules).toHaveLength(1)
      it.expect(rules[0]?.id).toBe("EXAMPLE_NO_SECRET_LOGGING")
      it.expect(rules[0]?.assessment?.planner).toBe("semantic-chunks")
      it.expect(rules[0]?.semantic?.evidence).toBeUndefined()
      it.expect(second.created).toEqual([])
      it.expect((yield* ProjectConfig.load(root)).base).toBe("origin/main")
    })).pipe(Effect.provide(NodeServices.layer)))

  it.effect("loads repository-defined assessment planner modules", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-planner-config-" })
      yield* fs.makeDirectory(`${root}/.neuralint`, { recursive: true })
      yield* fs.writeFileString(`${root}/.neuralint/config.yaml`, `version: 1
base: origin/main
assessmentPlanners:
  service-tests:
    module: tools/service-tests.mjs
    export: plan
    partitioning: independent-cases
`)

      const config = yield* ProjectConfig.load(root)

      it.expect(config.assessmentPlanners["service-tests"]).toEqual({
        module: "tools/service-tests.mjs",
        export: "plan",
        partitioning: "independent-cases"
      })
    })).pipe(Effect.provide(NodeServices.layer)))

  it.effect("defaults legacy configuration to error severity", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-config-" })
      yield* fs.makeDirectory(`${root}/.neuralint`, { recursive: true })
      yield* fs.writeFileString(`${root}/.neuralint/config.yaml`, "version: 1\nbase: origin/main\n")

      const config = yield* ProjectConfig.load(root)

      it.expect(config).toEqual({
        version: 1,
        base: "origin/main",
        failOn: "error",
        assessmentPlanners: {},
        limits: ProjectConfig.defaultLimits
      })
    })).pipe(Effect.provide(NodeServices.layer)))
})
