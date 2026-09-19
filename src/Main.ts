#!/usr/bin/env node

import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Command } from "effect/unstable/cli"

import * as Cli from "./Cli.js"

const apiKey = Config.option(Config.Redacted("TYPESAFE_API_KEY")).pipe(
  Config.map(Option.getOrUndefined)
)
const apiUrl = Config.String("TYPESAFE_API_URL").pipe(
  Config.withDefault("https://api.typesafe.ai/v1")
)

const decisionModelLayer = TypeSafeDecisionModel.layer({ model: "jev-latest" }).pipe(
  Layer.provide(TypeSafeClient.layerConfig({ apiKey, apiUrl })),
  Layer.provide(NodeHttpClient.layerUndici)
)

const main = Command.run(Cli.command, { version: "0.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, decisionModelLayer)),
  Effect.scoped
)

NodeRuntime.runMain(main)
