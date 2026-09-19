#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Command } from "effect/unstable/cli"

import * as Ai from "./Ai.js"
import * as Cli from "./Cli.js"
import { version } from "./Version.js"

const main = Command.run(Cli.command, { version }).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, Ai.decisionModelLayer)),
  Effect.scoped
)

NodeRuntime.runMain(main)
