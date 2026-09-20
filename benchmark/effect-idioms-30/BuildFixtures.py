#!/usr/bin/env python3
"""Build synthetic before/after fixtures for the 30-rule Effect catalog."""

from __future__ import annotations

import json
from pathlib import Path

SUITE = Path(__file__).resolve().parent


def fixture(id: str, title: str, rule: str | None, before: str, after: str, path: str = "src/Example.ts") -> dict:
    return {
        "id": id,
        "title": title,
        "path": path,
        "expected": [] if rule is None else [{"ruleId": rule, "path": path}],
        "before": before.strip() + "\n",
        "after": after.strip() + "\n",
    }


CASES = [
fixture("effect-gen-wrapper", "Wrap a reusable workflow in a plain function", "EFFECT_REUSABLE_FUNCTIONS", '''
import * as Effect from "effect/Effect"
export const load = Effect.fn("Users.load")(function* (id: string) {
  return yield* Effect.succeed(id)
})
''', '''
import * as Effect from "effect/Effect"
export const load = (id: string) => Effect.gen(function* () {
  return yield* Effect.succeed(id)
})
'''),
fixture("cast-external-json", "Trust an SDK response through a cast", "EFFECT_DECODE_EXTERNAL_VALUES", '''
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
const User = Schema.Struct({ id: Schema.String })
export const decodeUser = (input: unknown) => Schema.decodeUnknownEffect(User)(input)
''', '''
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
const User = Schema.Struct({ id: Schema.String })
export const decodeUser = (input: unknown) => Effect.succeed(input as typeof User.Type)
'''),
fixture("weaken-user-id", "Replace a domain identity with string", "EFFECT_BRANDED_IDENTITIES", '''
import * as Schema from "effect/Schema"
export const UserId = Schema.NonEmptyString.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type
export interface Request { readonly userId: UserId }
''', '''
import * as Schema from "effect/Schema"
export const UserId = Schema.NonEmptyString.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type
export interface Request { readonly userId: string }
'''),
fixture("open-status-string", "Allow any workflow status string", "EFFECT_CLOSED_VOCABULARIES", '''
import * as Schema from "effect/Schema"
export const Status = Schema.Literals(["pending", "running", "complete"])
''', '''
import * as Schema from "effect/Schema"
export const Status = Schema.String
'''),
fixture("optional-state-bag", "Flatten lifecycle variants into optional fields", "EFFECT_TAGGED_STATE_VARIANTS", '''
import * as Schema from "effect/Schema"
export const State = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Running"), startedAt: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Complete"), result: Schema.String }),
])
''', '''
import * as Schema from "effect/Schema"
export const State = Schema.Struct({
  status: Schema.Literals(["running", "complete"]),
  startedAt: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
})
'''),
fixture("undefined-domain-absence", "Expose undefined from a service contract", "EFFECT_EXPLICIT_ABSENCE", '''
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
interface Users { readonly find: (id: string) => Effect.Effect<Option.Option<string>> }
''', '''
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
interface Users { readonly find: (id: string) => Effect.Effect<string | undefined> }
'''),
fixture("throw-expected-error", "Throw a generic error for missing input", "EFFECT_TYPED_EXPECTED_ERRORS", '''
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
class MissingName extends Schema.TaggedError<MissingName>()("MissingName", {}) {}
export const requireName = (name: string | undefined) => name ? Effect.succeed(name) : Effect.fail(new MissingName())
''', '''
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
export const requireName = (name: string | undefined) => Effect.sync(() => {
  if (!name) throw new Error("missing name")
  return name
})
'''),
fixture("leak-sdk-error", "Leak a provider rejection from the adapter", "EFFECT_BOUNDARY_ERROR_TRANSLATION", '''
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", { operation: Schema.String, cause: Schema.Defect }) {}
export const invoke = Effect.tryPromise({ try: () => sdk.invoke(), catch: cause => new ProviderError({ operation: "invoke", cause }) })
''', '''
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
export const invoke = Effect.tryPromise(() => sdk.invoke())
'''),
fixture("swallow-all-causes", "Turn every cause into success", "EFFECT_NARROW_ERROR_RECOVERY", '''
import * as Effect from "effect/Effect"
export const run = operation.pipe(Effect.catchTag("NotFound", () => Effect.succeed("missing")))
''', '''
import * as Effect from "effect/Effect"
export const run = operation.pipe(Effect.catchAllCause(() => Effect.succeed("ok")))
'''),
fixture("global-mailer", "Construct an operational capability as a singleton", "EFFECT_CAPABILITY_SERVICES", '''
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
interface Mailer { readonly send: (to: string) => Effect.Effect<void> }
export class Mailers extends Context.Service<Mailers, Mailer>()("app/Mailers") {}
''', '''
import * as Effect from "effect/Effect"
export const mailer = {
  send: (to: string) => Effect.tryPromise(() => sdk.send(to)),
}
'''),
fixture("leak-filesystem-requirement", "Make consumers provide a private filesystem dependency", "EFFECT_CAPTURE_PRIVATE_DEPENDENCIES", '''
import * as Effect from "effect/Effect"
interface Documents { readonly load: (id: string) => Effect.Effect<string, Error> }
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  return { load: (id: string) => fs.readFileString(id) } satisfies Documents
})
''', '''
import * as Effect from "effect/Effect"
interface Documents { readonly load: (id: string) => Effect.Effect<string, Error, FileSystem.FileSystem> }
const make = Effect.succeed({
  load: (id: string) => Effect.flatMap(FileSystem.FileSystem, fs => fs.readFileString(id)),
} satisfies Documents)
'''),
fixture("inline-provide-client", "Provide an API client inside each operation", "EFFECT_ROOT_LAYER_COMPOSITION", '''
import * as Effect from "effect/Effect"
export const load = Effect.fn("Users.load")(function* () {
  const client = yield* ApiClient
  return yield* client.load()
})
''', '''
import * as Effect from "effect/Effect"
export const load = Effect.fn("Users.load")(function* () {
  return yield* ApiClient.pipe(Effect.flatMap(client => client.load()), Effect.provide(ApiClientLive))
})
'''),
fixture("per-call-client-layer", "Rebuild a stateful client Layer per request", "EFFECT_REUSE_STATEFUL_LAYERS", '''
import * as Effect from "effect/Effect"
export const UsersLive = Layer.effect(Users, makeUsers).pipe(Layer.provide(ApiClientLive))
''', '''
import * as Effect from "effect/Effect"
export const loadUser = (id: string) =>
  Users.pipe(Effect.flatMap(users => users.load(id)), Effect.provide(ApiClientLive))
'''),
fixture("effectful-uppercase", "Put a deterministic transformation in Effect", "EFFECT_PURE_LOGIC_STAYS_PURE", '''
export const normalizeName = (name: string): string => name.trim().toUpperCase()
''', '''
import * as Effect from "effect/Effect"
export const normalizeName = (name: string) => Effect.sync(() => name.trim().toUpperCase())
'''),
fixture("node-fs-domain", "Read files directly in a domain operation", "EFFECT_PLATFORM_CAPABILITIES", '''
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
export const load = Effect.fn("Documents.load")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(path)
})
''', '''
import { readFile } from "node:fs/promises"
export const load = async (path: string) => readFile(path, "utf8")
'''),
fixture("promise-service-contract", "Expose a raw Promise from a service", "EFFECT_PROMISE_INTEROP_BOUNDARY", '''
import * as Effect from "effect/Effect"
interface Vendor { readonly invoke: (id: string) => Effect.Effect<string, VendorError> }
''', '''
interface Vendor { readonly invoke: (id: string) => Promise<string> }
'''),
fixture("unscoped-temp-directory", "Acquire a temporary directory without Scope", "EFFECT_SCOPED_RESOURCE_OWNERSHIP", '''
import * as Effect from "effect/Effect"
export const work = Effect.scoped(Effect.gen(function* () {
  const directory = yield* fs.makeTempDirectoryScoped()
  return yield* process(directory)
}))
''', '''
import * as Effect from "effect/Effect"
export const work = Effect.gen(function* () {
  const directory = yield* fs.makeTempDirectory()
  return yield* process(directory)
})
'''),
fixture("daemon-layer-worker", "Detach a forever worker from its Layer", "EFFECT_SCOPED_BACKGROUND_WORK", '''
import * as Effect from "effect/Effect"
export const WorkerLive = Layer.effectDiscard(runForever.pipe(Effect.forkScoped))
''', '''
import * as Effect from "effect/Effect"
export const WorkerLive = Layer.effectDiscard(runForever.pipe(Effect.forkDaemon, Effect.asVoid))
'''),
fixture("fire-and-forget-fiber", "Detach request work to return early", "EFFECT_STRUCTURED_FIBER_OWNERSHIP", '''
import * as Effect from "effect/Effect"
export const handle = work.pipe(Effect.forkScoped, Effect.flatMap(Fiber.join))
''', '''
import * as Effect from "effect/Effect"
export const handle = work.pipe(Effect.forkDaemon, Effect.asVoid)
'''),
fixture("unbounded-provider-fanout", "Remove the provider concurrency limit", "EFFECT_BOUNDED_CONCURRENCY", '''
import * as Effect from "effect/Effect"
export const loadAll = (ids: ReadonlyArray<string>) => Effect.forEach(ids, load, { concurrency: 8 })
''', '''
import * as Effect from "effect/Effect"
export const loadAll = (ids: ReadonlyArray<string>) => Effect.forEach(ids, load, { concurrency: "unbounded" })
'''),
fixture("unbounded-payment-retry", "Retry payment submission forever", "EFFECT_BOUNDED_IDEMPOTENT_RETRY", '''
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
export const submit = payment.pipe(Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 }))))
''', '''
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
export const submit = payment.pipe(Effect.retry(Schedule.forever))
'''),
fixture("manual-poll-loop", "Poll through a while loop and sleep", "EFFECT_SCHEDULE_REPEATED_WORK", '''
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
export const poll = runPass.pipe(Effect.repeat(Schedule.spaced("1 second")))
''', '''
import * as Effect from "effect/Effect"
export const poll = Effect.gen(function* () {
  while (true) {
    yield* runPass
    yield* Effect.sleep("1 second")
  }
})
'''),
fixture("callback-event-service", "Expose callback registration for a many-valued source", "EFFECT_STREAM_FOR_MANY_VALUES", '''
import * as Stream from "effect/Stream"
interface Events { readonly events: Stream.Stream<Event, EventError> }
''', '''
interface Events {
  readonly onEvent: (listener: (event: Event) => void) => () => void
}
'''),
fixture("collect-subscription", "Collect an open subscription into memory", "EFFECT_FINITE_STREAM_COLLECTION", '''
import * as Stream from "effect/Stream"
export const firstHundred = events.pipe(Stream.take(100), Stream.runCollect)
''', '''
import * as Stream from "effect/Stream"
export const allEvents = events.pipe(Stream.runCollect)
'''),
fixture("unchecked-fetch-json", "Return unchecked JSON from a provider", "EFFECT_HTTP_ADAPTER_CONTRACT", '''
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
export const request = Effect.fn("Provider.request")(function* () {
  const response = yield* client.get("/users").pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))
  return yield* HttpClientResponse.schemaBodyJson(UserResponse)(response)
})
''', '''
export const request = async () => {
  const response = await fetch("/users")
  return response.json()
}
'''),
fixture("manual-ttl-map", "Build an unbounded TTL map inside a service", "EFFECT_CACHE_LIFETIME", '''
import * as Cache from "effect/Cache"
const cache = yield* Cache.make({ capacity: 500, timeToLive: "5 minutes", lookup })
export const get = (id: string) => Cache.get(cache, id)
''', '''
const cache = new Map<string, { value: User; expiresAt: number }>()
export const get = async (id: string) => {
  const hit = cache.get(id)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const value = await lookup(id)
  cache.set(id, { value, expiresAt: Date.now() + 300000 })
  return value
}
'''),
fixture("raw-environment-secret", "Read an API key directly from process.env", "EFFECT_CONFIG_BOUNDARY", '''
import * as Config from "effect/Config"
export const apiKey = Config.redacted("VENDOR_API_KEY")
''', '''
export const apiKey = process.env.VENDOR_API_KEY ?? ""
'''),
fixture("real-sleep-test", "Wait for a worker with wall-clock sleep", "EFFECT_DETERMINISTIC_TEST_TIME", '''
import * as Effect from "effect/Effect"
import * as TestClock from "effect/TestClock"
it.effect("finishes", () => Effect.gen(function* () {
  const fiber = yield* worker.pipe(Effect.fork)
  yield* TestClock.adjust("1 second")
  yield* Fiber.join(fiber)
}))
''', '''
import * as Effect from "effect/Effect"
it.effect("finishes", () => Effect.gen(function* () {
  const fiber = yield* worker.pipe(Effect.fork)
  yield* Effect.sleep("1100 millis")
  yield* Fiber.join(fiber)
}))
''', path="test/Worker.test.ts"),
fixture("mock-private-module", "Mock a private implementation instead of the service", "EFFECT_TEST_PUBLIC_BOUNDARIES", '''
import * as Effect from "effect/Effect"
it.effect("loads", () => Users.pipe(Effect.flatMap(users => users.load(id)), Effect.provide(UsersTestLayer)))
''', '''
import { vi } from "vitest"
vi.mock("../src/internal/database.js", () => ({ query: vi.fn(() => row) }))
it("loads", async () => expect(await load(id)).toEqual(user))
''', path="test/Users.test.ts"),
fixture("remove-operation-span", "Remove the capability tracing boundary", "EFFECT_OPERATION_OBSERVABILITY", '''
import * as Effect from "effect/Effect"
export const load = Effect.fn("Users.load")(function* (id: string) {
  yield* Effect.annotateCurrentSpan({ userId: id })
  return yield* repository.load(id)
})
''', '''
import * as Effect from "effect/Effect"
export const load = (id: string) => repository.load(id)
'''),
# Clean controls exercise explicit exceptions.
fixture("clean-untraced-helper", "Use an intentionally untraced internal helper", None, '''
import * as Effect from "effect/Effect"
const normalize = Effect.fnUntraced(function* (value: string) { return value.trim() })
''', '''
import * as Effect from "effect/Effect"
const normalize = Effect.fnUntraced(function* (value: string) { return value.trim().toLowerCase() })
'''),
fixture("clean-browser-fetch-adapter", "Wire cancellation into a constrained browser fetch adapter", None, '''
import * as Effect from "effect/Effect"
const request = Effect.fn("Browser.request")(() => Effect.succeed("idle"))
''', '''
import * as Effect from "effect/Effect"
const request = Effect.fn("Browser.request")(() => Effect.tryPromise({
  try: signal => fetch("/health", { signal }),
  catch: cause => new BrowserTransportError({ cause }),
}))
''', path="src/integrations/BrowserTransport.ts"),
fixture("clean-pure-function", "Extend a pure deterministic transformation", None, '''
export const normalize = (value: string) => value.trim()
''', '''
export const normalize = (value: string) => value.trim().toLowerCase()
'''),
fixture("clean-bounded-retry", "Add a bounded retry for an idempotent lookup", None, '''
export const lookup = provider.lookup
''', '''
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
export const lookup = provider.lookup.pipe(
  Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.jittered, Schedule.upTo({ times: 4 }))),
)
'''),
fixture("clean-isolated-test-layer", "Freshen a Layer intentionally inside a test", None, '''
it.effect("uses service", () => program.pipe(Effect.provide(ServiceLive)))
''', '''
it.effect("uses isolated service", () => program.pipe(Effect.provide(Layer.fresh(ServiceLive))))
''', path="test/Service.test.ts"),
]


def main() -> None:
    positives = [case for case in CASES if case["expected"]]
    if len(positives) != 30:
        raise RuntimeError(f"Expected 30 positive cases, found {len(positives)}")
    (SUITE / "fixtures.json").write_text(json.dumps({"version": 1, "cases": CASES}, indent=2) + "\n")
    print(f"Built {len(CASES)} fixtures ({len(positives)} positive, {len(CASES) - len(positives)} clean)")


if __name__ == "__main__":
    main()
