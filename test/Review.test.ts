import * as it from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

import * as Domain from "../src/Domain.js"
import * as Review from "../src/Review.js"

const rule = Schema.decodeUnknownSync(Domain.ReviewRule)({
  version: 1,
  id: "TEST001",
  title: "Test rule",
  description: "Find the risky change.",
  severity: "error",
  scope: { include: ["src/**/*.ts"], exclude: [] },
  instructions: "Only the first hunk is risky.",
  criteria: { violation: "Risk is present.", compliant: "Risk is absent." },
  thresholds: { screenAt: 0.3, violationAt: 0.8 }
})

const diff: Domain.DiffSet = {
  base: "abc123",
  head: "HEAD",
  files: [{
    id: "F001",
    oldPath: "src/a.ts",
    newPath: "src/a.ts",
    path: "src/a.ts",
    patch: "patch",
    hunks: [
      { id: "F001:H001", header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, patch: "+ risky()" },
      { id: "F001:H002", header: "@@ -10 +10 @@", oldStart: 10, oldLines: 1, newStart: 10, newLines: 1, patch: "+ safe()" }
    ]
  }]
}

const modelLayer = Layer.effect(
  DecisionModel.DecisionModel,
  DecisionModel.make({
    decide: ({ state, decisions }) => {
      const stage = typeof state === "object" && state !== null && !Array.isArray(state) && "stage" in state
        ? state["stage"]
        : undefined
      const answers: Record<string, DecisionModel.ProviderAnswer> = Object.create(null)
      for (const key of Object.keys(decisions)) {
        const probability = stage === "screen" ? 0.95 : key.endsWith("H001") ? 0.92 : 0.1
        answers[key] = { _tag: "Probability", probability }
      }
      return Effect.succeed({ answers, usage: { inputTokens: 100, outputTokens: 2 } })
    }
  })
)

it.describe("Review", () => {
  it.effect("screens rules and localizes positive hunks", () =>
    Effect.gen(function*() {
      const report = yield* Review.run(diff, [rule], { maxStateChars: 10_000 })

      it.expect(report.findings).toHaveLength(1)
      it.expect(report.findings[0]?.ruleId).toBe("TEST001")
      it.expect(report.findings[0]?.hunkId).toBe("F001:H001")
      it.expect(report.findings[0]?.status).toBe("violation")
      it.expect(report.usage.requests).toBe(2)
    }).pipe(Effect.provide(modelLayer)))
})
