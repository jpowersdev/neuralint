import { TypeSafeClient, TypeSafeSchema } from "@effect/ai-typesafe"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as DecisionModel from "effect/unstable/ai/DecisionModel"

const apiKey = Config.option(Config.Redacted("TYPESAFE_API_KEY")).pipe(
  Config.map(Option.getOrUndefined)
)
const apiUrl = Config.String("TYPESAFE_API_URL").pipe(
  Config.withDefault("https://api.typesafe.ai/v1")
)

const normalize = (probabilities: Readonly<Record<string, number>>): Record<string, number> => {
  const entries = Object.entries(probabilities)
  const total = entries.reduce((sum, [, probability]) => sum + probability, 0)
  if (!Number.isFinite(total) || total <= 0) return Object.fromEntries(entries)
  return Object.fromEntries(entries.map(([label, probability]) => [label, probability / total]))
}

/**
 * TypeSafe's rounded classification distributions can be a few millionths
 * away from one. Normalize them before Effect validates the provider answer.
 */
const normalizedTypeSafeDecisionModel = Effect.gen(function* () {
  const client = yield* TypeSafeClient.TypeSafeClient
  return yield* DecisionModel.make({
    decide: Effect.fnUntraced(function* ({ state, decisions }) {
      const questions: Record<string, typeof TypeSafeSchema.Question.Encoded> = Object.create(null)
      for (const [key, decision] of Object.entries(decisions)) {
        switch (decision._tag) {
          case "Classify":
            questions[key] = { type: "choice", instructions: decision.instructions, criteria: decision.criteria }
            break
          case "Rate":
            questions[key] = { type: "score", instructions: decision.instructions, criteria: decision.criteria }
            break
          case "Probability":
            questions[key] = { type: "noul", instructions: decision.instructions, criteria: decision.criteria }
            break
        }
      }
      const response = yield* client.systemOne({ model: "jev-latest", state, questions })
      const answers: Record<string, DecisionModel.ProviderAnswer> = Object.create(null)
      for (const [key, decision] of Object.entries(decisions)) {
        const answer = response.answers[key]
        switch (answer?.type) {
          case "choice":
            answers[key] = {
              _tag: "Classify",
              label: answer.choice,
              probabilities: normalize(answer.probabilities),
              confidence: answer.confidence
            }
            break
          case "score": {
            const levels = decision._tag === "Rate" ? decision.criteria : []
            const probabilities: Record<string, number> = Object.create(null)
            for (let index = 0; index < levels.length; index++) {
              const probability = answer.probabilities[String(index)]
              const level = levels[index]
              if (probability !== undefined && level !== undefined) probabilities[level] = probability
            }
            answers[key] = {
              _tag: "Rate",
              rating: answer.score,
              probabilities: normalize(probabilities),
              confidence: answer.confidence
            }
            break
          }
          case "noul":
            answers[key] = { _tag: "Probability", probability: answer.noul }
            break
        }
      }
      return {
        answers,
        usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens }
      }
    })
  })
})

export const decisionModelLayer = Layer.effect(
  DecisionModel.DecisionModel,
  normalizedTypeSafeDecisionModel
).pipe(
  Layer.provide(TypeSafeClient.layerConfig({ apiKey, apiUrl })),
  Layer.provide(NodeHttpClient.layerUndici)
)
