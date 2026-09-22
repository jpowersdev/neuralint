import * as it from "@effect/vitest"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"

import * as RuleCatalog from "../src/RuleCatalog.js"

const rule = `version: 1
id: TEST001
title: Test rule
description: Finds a test issue.
severity: warning
scope:
  include: ["src/**/*.ts"]
  exclude: ["**/*.test.ts"]
instructions: Check the changed code.
criteria:
  violation: The issue exists.
  compliant: The issue does not exist.
assessment:
  planner: semantic-chunks
semantic:
  context: The issue loses an important invariant.
  reportWhen: The changed code demonstrably loses the invariant.
  doNotReport: The invariant is preserved or the evidence is unavailable.
  guidance: Restore the invariant at its owning boundary.
  examples:
    - outcome: violation
      explanation: The changed operation loses the invariant.
      code: "const value = unsafeChange()"
    - outcome: nonviolation
      explanation: The operation preserves the invariant.
      code: "const value = safeChange()"
thresholds:
  screenAt: 0.3
  violationAt: 0.8
`

it.describe("RuleCatalog", () => {
  it.effect("loads repository-authored rules", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-" })
      const directory = `${root}/.neuralint/rules`
      yield* fs.makeDirectory(directory, { recursive: true })
      yield* fs.writeFileString(`${directory}/test.yaml`, rule)

      const rules = yield* RuleCatalog.load(root)

      it.expect(rules).toHaveLength(1)
      it.expect(rules[0]?.id).toBe("TEST001")
      it.expect(rules[0]?.assessment?.planner).toBe("semantic-chunks")
      it.expect(rules[0]?.semantic?.examples).toHaveLength(2)
      it.expect(RuleCatalog.appliesToPath(rules[0]!, "src/domain/User.ts")).toBe(true)
      it.expect(RuleCatalog.appliesToPath(rules[0]!, "src/domain/User.test.ts")).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer)))

  it.effect("loads repository-specific assessment planner declarations", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-planner-" })
      const directory = `${root}/.neuralint/rules`
      yield* fs.makeDirectory(directory, { recursive: true })
      yield* fs.writeFileString(
        `${directory}/test.yaml`,
        rule.replace("planner: semantic-chunks", "planner: repository-specific")
      )

      const rules = yield* RuleCatalog.load(root)

      it.expect(rules[0]?.assessment?.planner).toBe("repository-specific")
    })).pipe(Effect.provide(NodeServices.layer)))
})
