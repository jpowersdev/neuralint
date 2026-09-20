#!/usr/bin/env python3
"""Build a 30-rule, source-backed Effect v4 semantic guidance catalog."""

from __future__ import annotations

import json
from pathlib import Path

SUITE = Path(__file__).resolve().parent
RULES = SUITE / "rules"

SOURCES = {
    "effect-llms": {
        "title": "Effect library documentation (LLMS.md)",
        "url": "https://github.com/Effect-TS/effect/blob/3b155e3e24e42b603d48dff5d3280715944998f0/LLMS.md",
        "revision": "3b155e3e24e42b603d48dff5d3280715944998f0",
        "license": "MIT",
    },
    "jpowers-effect": {
        "title": "Building maintainable Effect applications",
        "url": "https://github.com/jpowersdev/effect-pi/blob/2dc0f83136bb17bf2e77746b1e98186c57e49471/EFFECT.md",
        "revision": "2dc0f83136bb17bf2e77746b1e98186c57e49471",
        "license": "MIT",
    },
    "kit-effect": {
        "title": "Kit Langton's Effect v4 skill",
        "url": "https://github.com/kitlangton/skills/tree/22c35cb7fd29f931789253fc3c8eb142f2863a8a/skills/effect",
        "revision": "22c35cb7fd29f931789253fc3c8eb142f2863a8a",
        "license": "MIT",
    },
}

# Each entry contains authored, operational criteria rather than copied prose.
# `evidence` and provenance are retained outside the current v1 runtime schema.
CATALOG = [
    ("EFFECT_REUSABLE_FUNCTIONS", "Define reusable workflows with Effect.fn", "warning", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Reusable functions returning Effect should use Effect.fn when they represent a useful traced operation or Effect.fnUntraced for intentionally untraced helpers.",
     "Apply to a changed reusable function, not an inline one-off workflow. Inspect the complete declaration. Do not require tracing for a small helper deliberately using Effect.fnUntraced.",
     "A reusable function merely returns Effect.gen, becomes an anonymous Effect-returning function, or removes an appropriate Effect.fn/Effect.fnUntraced boundary.",
     "Inline workflow code may use Effect.gen; reusable workflows use Effect.fn with a stable name when traced or Effect.fnUntraced when tracing is intentionally unnecessary."),
    ("EFFECT_DECODE_EXTERNAL_VALUES", "Decode unknown values at external boundaries", "error", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Files, environment input, HTTP payloads, database rows, SDK responses, and other untrusted values should be decoded through Schema rather than asserted into domain types.",
     "Apply where changed code accepts external or persistence data. A cast may describe evidence already established by types, but must not replace runtime validation.",
     "Changed boundary code casts, manually narrows, or directly consumes untrusted data as a domain value without Schema decoding or an equivalent validated boundary.",
     "The boundary preserves unknown and uses Schema decoding, an HttpApi/SQL decoder, or another established validated constructor before domain use."),
    ("EFFECT_BRANDED_IDENTITIES", "Preserve domain identity brands end to end", "warning", "file", ["jpowers-effect", "kit-effect"],
     "Identifiers that are unsafe to interchange should use constrained branded schemas and retain their brand through APIs, services, persistence, and client state.",
     "Apply to identity-bearing fields and parameters. Do not demand a brand for arbitrary display strings or values whose interchange is harmless.",
     "Changed code weakens a branded identity to string/number, introduces an interchangeable primitive for a domain identity, or recreates a weaker transport identity.",
     "The corresponding branded schema is decoded at the boundary and its type is preserved through domain and service contracts."),
    ("EFFECT_CLOSED_VOCABULARIES", "Model closed vocabularies as literal schemas", "warning", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Finite domain vocabularies should be represented by literal unions rather than unconstrained strings.",
     "Apply only when the surrounding domain establishes a closed set. Do not report genuinely open labels, user text, provider-defined values, or forward-compatible extension points.",
     "Changed code uses Schema.String or string for a value whose allowed domain alternatives are known and finite.",
     "The value uses Schema.Literals, a tagged union, or another exhaustive representation of the closed vocabulary."),
    ("EFFECT_TAGGED_STATE_VARIANTS", "Represent mutually exclusive states as tagged variants", "error", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Lifecycle and workflow states should use tagged variants carrying exactly the data valid for each state instead of status fields plus conditionally valid optional properties.",
     "Inspect the complete model and its consumers. Do not report simple independent optional fields or serialization contracts that genuinely permit partial data.",
     "Changed code models mutually exclusive states with a status and optional-field bag that permits contradictory, incomplete, or impossible combinations.",
     "State is an exhaustive tagged union/enum whose variants contain only their valid data and are matched exhaustively."),
    ("EFFECT_EXPLICIT_ABSENCE", "Represent domain absence explicitly", "warning", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Domain and service APIs should use Option for semantic absence and reserve nullish values for encoded contracts or foreign platform boundaries that require them.",
     "Apply to decoded domain models and service contracts. Do not report optional JSON keys, host APIs requiring undefined, or values whose encoded contract explicitly includes null.",
     "Changed domain code introduces null or undefined to mean ordinary absence, or spreads nullish handling through domain operations instead of normalizing it at the boundary.",
     "Absence is represented by Option in domain code and converted to/from nullish values only at an explicit boundary."),
    ("EFFECT_TYPED_EXPECTED_ERRORS", "Model expected failures as tagged values", "error", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Expected domain and operational failures should be typed tagged values, normally Schema.TaggedError when serialization or schema support matters.",
     "Distinguish expected failure from defects. Native Error values are acceptable as defect causes or when dying on a violated invariant, not as recoverable domain control flow.",
     "Changed code throws, rejects, defects, or returns a generic Error for an expected failure that callers should recover from.",
     "The operation fails with a specific tagged error carrying structured fields and callers recover by tag or typed reason."),
    ("EFFECT_BOUNDARY_ERROR_TRANSLATION", "Translate infrastructure failures at adapter boundaries", "error", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Adapters should map low-level SDK, persistence, transport, and parsing failures into specific boundary/domain errors while preserving useful operation and cause information.",
     "Apply where changed code crosses an external integration boundary. Do not erase evidence into a generic message or repeatedly remap the same error at unrelated layers.",
     "Changed adapter code leaks a foreign error through the application contract or collapses it into vague prose without operation, cause, or relevant identity context.",
     "The adapter maps the foreign failure once into a typed error with enough structured context for diagnosis and preserves the underlying cause safely."),
    ("EFFECT_NARROW_ERROR_RECOVERY", "Recover only at a boundary with a truthful response", "error", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Recovery should target typed failures at the narrowest boundary that can retry, fallback, translate, or otherwise respond truthfully; defects and interruption should remain distinct.",
     "Inspect what the handler does after catching. Cause-level recovery is appropriate only at explicit supervision boundaries with an interruption-aware policy.",
     "Changed code catches all errors/causes, swallows a failure, converts defects to success, or retries broadly without a boundary-specific truthful policy.",
     "Recovery uses catchTag/catchTags/typed predicates or an explicit supervision policy, preserves interruption, and leaves exhausted or unhandled failures visible."),
    ("EFFECT_CAPABILITY_SERVICES", "Represent operational capabilities as Effect services", "warning", "file", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Reusable operational capabilities should be exposed through cohesive Context services and Layers rather than mutable singletons, direct construction in consumers, or unrelated function namespaces.",
     "Do not wrap pure transformations in services solely for mocking. Apply when the capability owns effects, configuration, resources, replaceable infrastructure, concurrency, or state.",
     "Changed code introduces a reusable operational capability as a global/singleton or constructs its implementation directly inside consumers, bypassing Effect service composition.",
     "A cohesive service contract describes the capability, its implementation is supplied by a Layer, and pure domain logic remains ordinary pure functions."),
    ("EFFECT_CAPTURE_PRIVATE_DEPENDENCIES", "Capture implementation dependencies inside the service Layer", "error", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "A service Layer should acquire private dependencies once, close over them in methods, and expose a contract whose environment contains only requirements consumers genuinely own.",
     "Required evidence includes the service contract, constructor, exported Layer, and method signatures. Do not report intentional higher-order effects whose caller truly supplies authority.",
     "Changed service methods leak FileSystem, Path, client, configuration, or implementation-only requirements into consumer environments instead of the owning Layer providing them.",
     "The owning Layer acquires and provides private dependencies; consumers require only the service and explicit domain capabilities they are responsible for."),
    ("EFFECT_ROOT_LAYER_COMPOSITION", "Compose dependencies at explicit Layer boundaries", "warning", "file", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Application dependencies should be assembled as named Layer graphs at runtime/module boundaries rather than repeatedly provided inline inside business operations.",
     "Small local provisioning may be appropriate for a deliberately local capability. Distinguish Layer.provide from provideMerge based on whether the dependency must remain exposed.",
     "Changed business code adds inline Effect.provide/provideService calls or manually constructs dependencies that belong in the application or capability Layer graph.",
     "Named Layer values compose the dependency graph, hide private dependencies with Layer.provide, and expose dependencies with provideMerge only deliberately."),
    ("EFFECT_REUSE_STATEFUL_LAYERS", "Build stateful Layers once per intended lifetime", "error", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Memoized Layers, clients, caches, pools, and stateful services should be constructed at their owning lifetime, not recreated inside each request or method.",
     "Apply to stateful or resource-owning layers. Layer.fresh or local provisioning is compliant when isolation is deliberate, usually in tests or a bounded operation.",
     "Changed code constructs/provides a stateful Layer, client, cache, or pool per call so state and resource reuse are lost.",
     "The stateful Layer value is hoisted to and shared by its owning application, service, or test scope."),
    ("EFFECT_PURE_LOGIC_STAYS_PURE", "Keep deterministic transformations out of Effect services", "warning", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Deterministic transformations should remain pure functions; Effect and service boundaries should represent actual effects or meaningful operational capabilities.",
     "Do not report a pure helper merely because it is called from Effect code. Effect.sync is appropriate when evaluating code can actually throw or perform a side effect that must be suspended.",
     "Changed code wraps a deterministic transformation in Effect or a service solely for uniformity, dependency injection, or mocking despite having no effectful boundary.",
     "The transformation is an ordinary pure function with explicit inputs and outputs and is composed into Effect workflows where needed."),
    ("EFFECT_PLATFORM_CAPABILITIES", "Use Effect platform services in application code", "warning", "file", ["jpowers-effect", "kit-effect"],
     "Application and domain code should use Effect services for filesystem, path, time, randomness, processes, HTTP, configuration, and other supported platform capabilities.",
     "Raw host APIs are allowed in named platform adapters, entrypoints, and genuine library/runtime gaps. Do not report an adapter merely for containing the foreign call it encapsulates.",
     "Changed ordinary application/domain code directly imports or calls a replaced Node/browser global capability instead of depending on the corresponding Effect service.",
     "Host-specific operations are isolated in an adapter/entrypoint or use the Effect platform service so dependencies, errors, and tests remain explicit."),
    ("EFFECT_PROMISE_INTEROP_BOUNDARY", "Convert Promise and callback APIs once at the edge", "error", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Foreign Promise/callback APIs should be wrapped once with Effect interop in an adapter; raw Promises must not escape through application service contracts.",
     "Inspect whether this is the actual integration boundary. A ManagedRuntime may bridge into a non-Effect host, but Effect-native business code should not become Promise-first.",
     "Changed application code exposes a Promise-returning service method, uses async/await for business control flow, or repeatedly wraps the same foreign SDK away from its adapter.",
     "The adapter uses Effect.tryPromise/async with typed error mapping and cancellation where supported; consumers receive Effects."),
    ("EFFECT_SCOPED_RESOURCE_OWNERSHIP", "Tie acquired resources to Scope", "critical", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Files, clients, processes, servers, subscriptions, temporary directories, and other resources requiring cleanup should be acquired in Scope with an explicit owner.",
     "Inspect acquisition, use, interruption, and release together. Values with no lifecycle or resources owned by an existing scoped service are compliant.",
     "Changed code acquires a cleanup-requiring resource without a scoped constructor/finalizer, creates it at module import time, or relies on process exit/manual happy-path cleanup.",
     "The resource uses a scoped API, Effect.acquireRelease/addFinalizer, or an owning scoped Layer that releases it on success, failure, and interruption."),
    ("EFFECT_SCOPED_BACKGROUND_WORK", "Fork long-lived work into its owning Layer scope", "critical", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Streams, listeners, subscriptions, workers, and forever loops owned by a Layer should be forked into that Layer's Scope so acquisition completes and release interrupts them.",
     "Manual start/stop methods are acceptable only when lifecycle control is an explicit domain responsibility. Inspect whether acquisition blocks or work escapes its owner.",
     "Changed Layer construction runs forever work inline, detaches it, or starts background work without connecting its Fiber lifetime to the owning scope.",
     "The owner uses forkScoped, FiberSet/FiberMap, or forkIn(capturedScope), and Layer acquisition completes while cleanup interrupts the work."),
    ("EFFECT_STRUCTURED_FIBER_OWNERSHIP", "Keep child fibers owned by a parent Scope", "critical", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Concurrent work should remain attached to an explicit parent operation or Scope unless a reviewed design establishes a daemon lifetime and supervision policy.",
     "Apply to changed forks and asynchronous launches. Do not report a runtime's intentional top-level launch or a documented supervised daemon.",
     "Changed code uses detached/daemon fibers or fire-and-forget execution merely to reduce latency, with no owner, supervision, or cancellation path.",
     "Child work is joined, scoped, supervised, or otherwise owned so parent interruption and shutdown produce defined behavior."),
    ("EFFECT_BOUNDED_CONCURRENCY", "Bound concurrency by the protected resource", "critical", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Collection and stream concurrency should have a finite bound chosen for the downstream resource; queues and buffers should apply backpressure rather than unbounded growth.",
     "Do not require concurrency where work should be sequential. An unbounded source may still be safe when bounded by a downstream semaphore or other visible capacity control.",
     "Changed code makes input-sized work fully unbounded, introduces an unbounded queue/buffer without an external bound, or removes the capacity protecting a downstream service.",
     "Concurrency/capacity is finite and justified by the protected database, provider, CPU, memory, or ordering requirement, with backpressure where applicable."),
    ("EFFECT_BOUNDED_IDEMPOTENT_RETRY", "Retry only idempotent operations with finite policy", "critical", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Retries should occur at the narrowest boundary, only for failures and operations proven safe to repeat, with finite attempt/time bounds and visible exhaustion.",
     "Inspect operation semantics, schedule, and terminal behavior. Provider-directed retry delays may augment backoff; non-idempotent operations need a durable idempotency mechanism.",
     "Changed code adds unbounded retry, retries a non-idempotent operation without protection, catches defects/interruption for retry, or hides exhausted failure without a truthful fallback.",
     "A typed transient-failure policy uses a bounded Schedule, optional jitter/backoff, preserves interruption, and exposes exhaustion or a real fallback."),
    ("EFFECT_SCHEDULE_REPEATED_WORK", "Use Schedule for retry, polling, and repeated work", "warning", "enclosing-symbol", ["effect-llms", "kit-effect"],
     "Retries, polling, pacing, and recurring passes should use Schedule with Effect.retry/repeat rather than manual loops and sleeps.",
     "A single deliberate delay is not recurring work. Use Stream instead when emitted values and stream transformations/backpressure are the core abstraction.",
     "Changed code implements recurring Effect work with while/recursive loops plus sleep or ad hoc counters instead of an explicit Schedule.",
     "Effect.retry/repeat/retryOrElse composes an explicit bounded or paced Schedule whose semantics are visible and testable."),
    ("EFFECT_STREAM_FOR_MANY_VALUES", "Use Stream for effectful many-valued sources", "warning", "enclosing-symbol", ["effect-llms", "kit-effect"],
     "Time-ordered effectful sources with multiple values, transformation, interruption, or backpressure should expose Stream rather than callbacks, raw async iterables, or public producer queues.",
     "Do not use Stream merely for one repeated effect whose emitted values are irrelevant; Effect.repeat with Schedule is clearer there.",
     "Changed service code exposes callback registration, AsyncIterable, Queue/PubSub mutation, or ad hoc event loops directly to consumers when a Stream is the appropriate read interface.",
     "The implementation keeps producers private and exposes a typed Stream with lifecycle, errors, and backpressure owned by the service."),
    ("EFFECT_FINITE_STREAM_COLLECTION", "Prove stream finiteness before collecting", "critical", "enclosing-symbol", ["effect-llms", "kit-effect"],
     "Stream.runCollect is appropriate only when the stream is known finite or explicitly bounded before collection.",
     "Tests may collect finite fixtures. A production stream is compliant when take/takeUntil/timeout or source semantics establish a finite bound visible in the pipeline.",
     "Changed code collects a subscription, event stream, repeat source, queue stream, or otherwise potentially unbounded stream into memory without a termination bound.",
     "The consumer drains/processes incrementally or establishes a clear finite bound before runCollect."),
    ("EFFECT_HTTP_ADAPTER_CONTRACT", "Own the complete HTTP boundary in a named adapter", "error", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Outgoing HTTP adapters should construct requests, attach auth, classify statuses, decode unknown bodies, map typed failures, and apply cancellation/retry policy in one named boundary.",
     "Raw fetch is acceptable in constrained adapters, browser transports, or libraries avoiding unstable APIs, but it still needs cancellation, status classification, decoding, and typed errors.",
     "Changed HTTP code returns response.json unchecked, treats non-2xx as success, leaks transport errors, omits cancellation, or scatters auth/decoding/retry through business code.",
     "A named HttpClient/raw-fetch adapter owns request and response semantics, decodes through Schema, maps typed errors, redacts evidence, and retries only idempotent operations."),
    ("EFFECT_CACHE_LIFETIME", "Construct bounded caches once in their owning Layer", "error", "enclosing-symbol", ["kit-effect"],
     "Use Effect Cache/ScopedCache for bounded keyed memoization and concurrent lookup deduplication, constructing the cache once at the lifetime that should share entries.",
     "A simple local memo of a pure value may not need Cache. RequestResolver is appropriate only when the backend has a real batch endpoint.",
     "Changed code hand-rolls Map+TTL/prune/in-flight dedupe when Cache fits, builds a cache per call, leaves capacity unbounded, or acquires an expensive client inside each lookup.",
     "A bounded Cache/ScopedCache is created in the owning Layer, uses semantically correct success/failure TTLs, and shares its handle across calls."),
    ("EFFECT_CONFIG_BOUNDARY", "Read and validate runtime configuration through Config", "error", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Runtime settings and credentials should be decoded through Config in a Layer or configuration service rather than read from process.env throughout workflows.",
     "Entrypoints/providers may establish ConfigProvider. Defaults are for missing data, not malformed values; credentials should remain redacted.",
     "Changed application code reads process.env directly, leaves configuration unvalidated, threads settings through many layer factories, or represents credentials as ordinary strings.",
     "A Config recipe validates/refines values, uses option/default semantics deliberately, redacts credentials, and the owning Layer exposes decoded configuration."),
    ("EFFECT_DETERMINISTIC_TEST_TIME", "Use TestClock and synchronization instead of real sleeps", "warning", "enclosing-symbol", ["jpowers-effect", "kit-effect"],
     "Effect tests should control time and concurrent readiness deterministically with TestClock, Deferred, Queue, Latch, Ref, or explicit hooks rather than waiting in wall-clock time.",
     "Use it.live only when real time is itself the behavior under test. Fork sleeping effects before advancing TestClock.",
     "Changed tests add arbitrary Effect.sleep/setTimeout polling or timing margins to coordinate fibers or await retries, making the test slow or flaky.",
     "The test advances TestClock or waits on a deterministic synchronization signal tied to the behavior being asserted."),
    ("EFFECT_TEST_PUBLIC_BOUNDARIES", "Test behavior through services and production boundaries", "warning", "file", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Tests should exercise public service contracts, real schemas, controlled Layers, scoped resources, and generated transport clients rather than mocking implementation modules or reimplementing production logic.",
     "Small pure units may be tested directly. Test doubles should model capabilities and provide control/inspection without coupling assertions to private implementation steps.",
     "Changed tests mock modules/private methods, bypass production decoding/contracts, operate on a developer's real workspace, or reproduce the implementation they intend to verify.",
     "Tests provide controlled service Layers, use disposable scoped fixtures, and assert externally meaningful success, typed failure, interruption, and finalization behavior."),
    ("EFFECT_OPERATION_OBSERVABILITY", "Instrument capability and integration boundaries", "warning", "enclosing-symbol", ["effect-llms", "jpowers-effect", "kit-effect"],
     "Meaningful public operations and integration boundaries should have stable Effect.fn/withSpan names plus structured context that supports diagnosis without exposing secrets.",
     "Do not require a span for every trivial helper or hot-path library function. Logs should describe boundary events and outcomes rather than scatter formatted prose through domain logic.",
     "Changed code removes the only useful tracing boundary from a capability/integration operation, emits unstructured context-only logs, or records credentials/unbounded sensitive payloads.",
     "The operation has a stable span where useful, attaches bounded structured identity/operation fields, preserves correlation, and excludes secrets."),
]


# Pilot a deliberately small semantic-authoring surface before expanding it to
# the full catalog. The examples are authored contrasts, not copied source.
SEMANTIC_PILOTS = {
    "EFFECT_REUSE_STATEFUL_LAYERS": {
        "context": (
            "A resource-owning Layer defines a lifecycle. Supplying it inside a repeatedly executed "
            "operation can reacquire and release resources on every execution and prevents state, pools, "
            "caches, and clients from being shared for their intended lifetime."
        ),
        "reportWhen": (
            "The change constructs or supplies a stateful or resource-owning Layer inside a callable "
            "operation, especially when provisioning moved inward from an application or service Layer graph."
        ),
        "doNotReport": (
            "Do not report stateless value Layers, intentionally operation-scoped resources, deliberate "
            "test isolation, or Layer.fresh used because each invocation requires independent state."
        ),
        "guidance": (
            "Hoist the Layer to the application, service, or test-scope owner and compose it into that "
            "owner's Layer graph; keep local provisioning only when the local lifetime is intentional."
        ),
        "evidence": "related-definitions",
        "examples": [
            {
                "outcome": "violation",
                "explanation": "A scoped client Layer is supplied inside a function that can run for every request.",
                "code": (
                    "const ApiClientLive = Layer.scoped(ApiClient, acquireClient)\n\n"
                    "const loadUser = (id: UserId) =>\n"
                    "  fetchUser(id).pipe(Effect.provide(ApiClientLive))"
                ),
            },
            {
                "outcome": "nonviolation",
                "explanation": "The resource-owning client is composed once at the application lifetime.",
                "code": (
                    "const ApplicationLive = UsersLive.pipe(\n"
                    "  Layer.provide(ApiClientLive)\n"
                    ")"
                ),
            },
            {
                "outcome": "nonviolation",
                "explanation": "A stateless value Layer can be local when no resource or reusable state is rebuilt.",
                "code": (
                    "const operation = Effect.provide(\n"
                    "  Layer.succeed(FeatureFlags, staticFlags)\n"
                    ")"
                ),
            },
        ],
    },
}


def slug(rule_id: str) -> str:
    return rule_id.removeprefix("EFFECT_").lower().replace("_", "-")


def main() -> None:
    if len(CATALOG) != 30:
        raise RuntimeError(f"Expected 30 rules, found {len(CATALOG)}")
    RULES.mkdir(parents=True, exist_ok=True)
    for old in RULES.glob("*.yaml"):
        old.unlink()
    provenance = {"version": 1, "sources": SOURCES, "rules": []}
    for rule_id, title, severity, evidence, sources, description, instructions, violation, compliant in CATALOG:
        rule = {
            "version": 1,
            "id": rule_id,
            "title": title,
            "description": description,
            "severity": severity,
            "scope": {
                "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "test/**/*.tsx"],
                "exclude": ["**/*.d.ts", "**/generated/**", "**/dist/**", "**/node_modules/**"],
            },
            "instructions": instructions,
            "criteria": {"violation": violation, "compliant": compliant},
            "thresholds": {"screenAt": 0.35, "violationAt": 0.8},
        }
        if rule_id in SEMANTIC_PILOTS:
            rule["semantic"] = SEMANTIC_PILOTS[rule_id]
        (RULES / f"{slug(rule_id)}.yaml").write_text(json.dumps(rule, indent=2) + "\n")
        provenance["rules"].append({
            "id": rule_id,
            "evidenceScope": evidence,
            "sources": sources,
        })
    (SUITE / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(f"Built {len(CATALOG)} rules")


if __name__ == "__main__":
    main()
