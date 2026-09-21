import * as it from "@effect/vitest"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

import * as ProjectConfig from "../src/ProjectConfig.js"
import * as RuleDoctor from "../src/RuleDoctor.js"

const failingModelLayer = Layer.effect(
  DecisionModel.DecisionModel,
  DecisionModel.make({
    decide: ({ decisions }) => {
      const answers: Record<string, DecisionModel.ProviderAnswer> = Object.create(null)
      for (const key of Object.keys(decisions)) {
        answers[key] = {
          _tag: "Probability",
          probability: key === "operational-boundary" ? 0.9 : 0.1
        }
      }
      return Effect.succeed({ answers, usage: { inputTokens: 80, outputTokens: 8 } })
    }
  })
)

const passingModelLayer = Layer.effect(
  DecisionModel.DecisionModel,
  DecisionModel.make({
    decide: ({ decisions }) => {
      const answers: Record<string, DecisionModel.ProviderAnswer> = Object.create(null)
      for (const key of Object.keys(decisions)) {
        answers[key] = { _tag: "Probability", probability: 0.1 }
      }
      return Effect.succeed({ answers, usage: { inputTokens: 40, outputTokens: 4 } })
    }
  })
)

const explanation = JSON.stringify({
  diagnosis: "The rule needs a more observable reporting boundary because its violation criterion does not identify the deciding value flow.",
  requiresHumanDecision: false,
  questions: ["Which repository values are classified as secrets?"]
})

const explanationResult = {
  text: explanation,
  inputTokens: 200,
  outputTokens: 50,
  totalTokens: 250,
  costUsd: 0.0045
}

it.describe("RuleDoctor", () => {
  it.effect("optionally asks Luna to explain Jev concerns without modifying policy", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-doctor-" })
      yield* fs.makeDirectory(`${root}/.git`)
      yield* ProjectConfig.initialize(root, "main")
      const activePath = `${root}/.neuralint/rules/no-secret-logging.yaml`
      const before = yield* fs.readFileString(activePath)

      const result = yield* RuleDoctor.runWithEvaluator({
        root,
        ruleId: "EXAMPLE_NO_SECRET_LOGGING",
        output: ".neuralint/doctor",
        explain: true
      }, async (prompt, model, evaluatorRoot) => {
        it.expect(prompt).toContain("without rewriting the rule")
        it.expect(prompt).toContain("underlying organizational policy")
        it.expect(prompt).toContain("operational-boundary")
        it.expect(model).toBe("openai-codex/gpt-6-astra")
        it.expect(evaluatorRoot).toBe(root)
        return explanationResult
      })

      const after = yield* fs.readFileString(activePath)
      const report = yield* fs.readFileString(result.reportPath)

      it.expect(after).toBe(before)
      it.expect(report).toContain("## Jev quality checks")
      it.expect(report).toContain("Suggested next step")
      it.expect(report).toContain("## Astra explanation")
      it.expect(report).toContain("$0.00450")
      it.expect(report).toContain("Questions for the maintainer")
      it.expect(result.issues).toBe(1)
      it.expect(result.explained).toBe(true)
      it.expect(result.usage.requests).toBe(1)
      it.expect(yield* fs.exists(`${result.directory}/rule.patch`)).toBe(false)
    })).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, failingModelLayer))))

  it.effect("uses Jev alone by default even when a check fails", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-doctor-default-" })
      yield* fs.makeDirectory(`${root}/.git`)
      yield* ProjectConfig.initialize(root, "main")

      const result = yield* RuleDoctor.runWithEvaluator({
        root,
        ruleId: "EXAMPLE_NO_SECRET_LOGGING",
        output: ".neuralint/doctor"
      }, async () => {
        throw new Error("Luna should not have been called")
      })

      const report = yield* fs.readFileString(result.reportPath)
      it.expect(result.explained).toBe(false)
      it.expect(result.issues).toBe(1)
      it.expect(report).toContain("Operational violation boundary")
      it.expect(report).not.toContain("Luna explanation")
    })).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, failingModelLayer))))

  it.effect("does not call Luna when all Jev checks pass", () =>
    Effect.scoped(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "neuralint-doctor-pass-" })
      yield* fs.makeDirectory(`${root}/.git`)
      yield* ProjectConfig.initialize(root, "main")

      const result = yield* RuleDoctor.runWithEvaluator({
        root,
        ruleId: "EXAMPLE_NO_SECRET_LOGGING",
        output: ".neuralint/doctor",
        explain: true
      }, async () => {
        throw new Error("Luna should not have been called")
      })

      const report = yield* fs.readFileString(result.reportPath)
      it.expect(result.explained).toBe(false)
      it.expect(result.issues).toBe(0)
      it.expect(result.usage.requests).toBe(1)
      it.expect(report).toContain("No Jev quality concerns")
    })).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, passingModelLayer))))
})
