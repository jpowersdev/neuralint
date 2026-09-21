#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { ModelRuntime, ResourceLoader } from "@jpowersdev/effect-pi"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore"
import { Command } from "effect/unstable/cli"

import * as Ai from "./Ai.js"
import * as Cli from "./Cli.js"
import * as RuleDoctor from "./RuleDoctor.js"
import { version } from "./Version.js"

const doctorModelLayer = ModelRuntime.layer({
  model: { provider: "openai-codex", id: "gpt-6-astra" },
  refreshOnCreate: false
}).pipe(
  Layer.provide(ResourceLoader.layerEmpty({
    systemPrompt: "Explain semantic-rule quality concerns without rewriting rules or inventing policy.",
    settings: { retry: { enabled: false } }
  }))
)

const doctorExplanationLayer = RuleDoctor.explanationModelLayer.pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, doctorModelLayer, KeyValueStore.layerMemory))
)

const main = Command.run(Cli.command, { version }).pipe(
  Effect.provide(Layer.mergeAll(
    NodeServices.layer,
    Ai.decisionModelLayer,
    doctorExplanationLayer
  )),
  Effect.scoped
)

NodeRuntime.runMain(main)
