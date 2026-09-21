import * as DecisionModel from "effect/unstable/ai/DecisionModel"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect, it } from "vitest"

import type * as Domain from "../src/Domain.js"
import * as Localization from "../src/Localization.js"

const rule: Domain.ReviewRule = {
  version: 1,
  id: "TEST_FILLER" as Domain.RuleId,
  title: "Remove filler",
  description: "Flag dispensable intensifiers.",
  severity: "warning",
  scope: { include: ["**/*.md"], exclude: [] },
  instructions: "Identify the exact dispensable expression.",
  criteria: { violation: "An expression adds no meaning.", compliant: "Every expression adds meaning." },
  thresholds: { screenAt: 0.4, violationAt: 0.8 },
  diagnostics: [
    { id: "hedge", title: "Needless hedge", description: "The phrase weakens a claim without adding useful uncertainty." },
    { id: "intensifier", title: "Needless intensifier", description: "The phrase adds emphasis without establishing a meaningful degree." }
  ]
}

const model = Layer.effect(
  DecisionModel.DecisionModel,
  DecisionModel.make({
    decide: ({ decisions }) => {
      const answers: Record<string, DecisionModel.ProviderAnswer> = Object.create(null)
      for (const [key, decision] of Object.entries(decisions)) {
        if (decision._tag !== "Classify") continue
        const labels = Object.keys(decision.criteria)
        const wanted = labels.find((label) =>
          decision.criteria[label]?.includes(key.endsWith(":evidence") ? '"really very"' : "Needless intensifier")
        ) ?? labels[0] ?? ""
        answers[key] = {
          _tag: "Classify",
          label: wanted,
          probabilities: Object.fromEntries(labels.map((label) => [label, label === wanted ? 1 : 0])),
          confidence: 1
        }
      }
      return Effect.succeed({ answers, usage: { inputTokens: 100, outputTokens: 20 } })
    }
  })
)

describe("Localization", () => {
  it("selects an exact source phrase and a rule-authored diagnosis", async () => {
    const result = await Effect.runPromise(
      Localization.run([{ id: "finding-1", rule, text: "The result was really very surprising." }]).pipe(
        Effect.provide(model)
      )
    )

    expect(result.usage.requests).toBe(1)
    expect(result.findings).toEqual([{
      id: "finding-1",
      startOffset: 15,
      endOffset: 26,
      quote: "really very",
      diagnosticId: "intensifier",
      diagnosticTitle: "Needless intensifier",
      diagnosticDescription: "The phrase adds emphasis without establishing a meaningful degree."
    }])
  })
})
