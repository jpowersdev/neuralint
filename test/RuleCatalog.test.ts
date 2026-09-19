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
      it.expect(RuleCatalog.appliesToPath(rules[0]!, "src/domain/User.ts")).toBe(true)
      it.expect(RuleCatalog.appliesToPath(rules[0]!, "src/domain/User.test.ts")).toBe(false)
    })).pipe(Effect.provide(NodeServices.layer)))
})
