import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as Config from "effect/Config"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"

const apiKey = Config.option(Config.Redacted("TYPESAFE_API_KEY")).pipe(
  Config.map(Option.getOrUndefined)
)
const apiUrl = Config.String("TYPESAFE_API_URL").pipe(
  Config.withDefault("https://api.typesafe.ai/v1")
)

export const decisionModelLayer = TypeSafeDecisionModel.layer({ model: "jev-latest" }).pipe(
  Layer.provide(TypeSafeClient.layerConfig({ apiKey, apiUrl })),
  Layer.provide(NodeHttpClient.layerUndici)
)
