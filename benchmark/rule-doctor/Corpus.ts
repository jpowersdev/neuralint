import type * as Domain from "../../src/Domain.js"

export const checkIds = [
  "operational-boundary",
  "internal-consistency",
  "applicability-clarity",
  "exceptions-operational",
  "evidence-feasible",
  "remediation-actionable",
  "examples-faithful",
  "examples-boundary"
] as const

export type CheckId = typeof checkIds[number]
export type ExpectedStatus = "pass" | "advisory" | "failure"
export type Category = "good" | "defective" | "ambiguous" | "evidence-infeasible"

export interface CalibrationCase {
  readonly id: string
  readonly category: Category
  readonly rationale: string
  readonly rule: Domain.ReviewRule
  readonly expected: Readonly<Record<CheckId, ExpectedStatus>>
}

const expected = (options: {
  readonly advisories?: ReadonlyArray<CheckId>
  readonly failures?: ReadonlyArray<CheckId>
} = {}): Readonly<Record<CheckId, ExpectedStatus>> => {
  const result = Object.fromEntries(checkIds.map((id) => [id, "pass"])) as Record<CheckId, ExpectedStatus>
  for (const id of options.advisories ?? []) result[id] = "advisory"
  for (const id of options.failures ?? []) result[id] = "failure"
  return result
}

const base = (options: {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly instructions: string
  readonly violation: string
  readonly compliant: string
  readonly reportWhen: string
  readonly doNotReport: string
  readonly guidance: string
  readonly evidence?: "changed-span" | "enclosing-symbol" | "complete-file"
  readonly violationCode: string
  readonly violationExplanation: string
  readonly nonviolationCode: string
  readonly nonviolationExplanation: string
}): Domain.ReviewRule => ({
  version: 1,
  id: options.id,
  title: options.title,
  description: options.description,
  severity: "warning",
  scope: { include: ["src/**/*.ts"], exclude: ["**/generated/**", "**/vendor/**"] },
  instructions: options.instructions,
  criteria: { violation: options.violation, compliant: options.compliant },
  thresholds: { screenAt: 0.35, violationAt: 0.8 },
  semantic: {
    context: options.description,
    reportWhen: options.reportWhen,
    doNotReport: options.doNotReport,
    guidance: options.guidance,
    evidence: options.evidence ?? "changed-span",
    examples: [
      { outcome: "violation", code: options.violationCode, explanation: options.violationExplanation },
      { outcome: "nonviolation", code: options.nonviolationCode, explanation: options.nonviolationExplanation }
    ]
  }
})

const bindServices = base({
  id: "CAL_GOOD_BIND_SERVICES",
  title: "Bind Effect services before calling them",
  description: "Effect generators bind a yielded service to a named constant before invoking its methods.",
  instructions: "Report only a changed expression that invokes a method directly on a nested yielded service. Do not report sequential service binding.",
  violation: "A changed Effect generator expression has the form `yield* (yield* Service).method(...)`.",
  compliant: "The generator yields the service into a named constant and invokes the method on that constant.",
  reportWhen: "The changed span contains a method call whose receiver is a parenthesized `yield*` service expression.",
  doNotReport: "Do not report a named service binding followed by a separate method call, or nested generators unrelated to service acquisition.",
  guidance: "Yield the service into a named constant, then invoke the method on that constant.",
  violationCode: "const value = yield* (yield* Project.Service).load(id)",
  violationExplanation: "The service acquisition is nested directly in the method receiver.",
  nonviolationCode: "const project = yield* Project.Service\nconst value = yield* project.load(id)",
  nonviolationExplanation: "The service is bound before its method is invoked."
})

const renamedImports = base({
  id: "CAL_GOOD_RENAMED_IMPORTS",
  title: "Do not rename imports",
  description: "Imported bindings retain the names exported by their modules.",
  instructions: "Report import specifiers that use `as` to rename a binding. Ignore namespace import syntax and type-only markers.",
  violation: "A changed named import specifier renames an imported binding with `as`.",
  compliant: "Named imports retain exported names; namespace imports such as `import * as Schema` are also compliant.",
  reportWhen: "The changed span contains a named import specifier of the form `{ exported as local }`.",
  doNotReport: "Do not report `import * as Name`, export aliases, or an unrenamed named import.",
  guidance: "Use the exported binding name and update local references to that name.",
  violationCode: "import { decodeUnknown as decode } from \"effect/Schema\"",
  violationExplanation: "The named import changes `decodeUnknown` to `decode`.",
  nonviolationCode: "import * as Schema from \"effect/Schema\"",
  nonviolationExplanation: "Namespace import syntax does not rename a named binding."
})

const preferConst = base({
  id: "CAL_GOOD_PREFER_CONST",
  title: "Use const for bindings that are not reassigned",
  description: "Local bindings use `const` unless the binding is reassigned after declaration.",
  instructions: "Report a changed `let` declaration only when the complete changed span shows no reassignment. Do not report loop counters or bindings with an assignment update.",
  violation: "A changed local `let` binding has no subsequent assignment or update in the changed span.",
  compliant: "The binding uses `const`, or a `let` binding is subsequently reassigned or updated.",
  reportWhen: "The changed span declares a local with `let` and contains no assignment or update to that binding.",
  doNotReport: "Do not report `for` loop counters, destructuring that is later assigned, or any binding with `=`, `++`, `--`, or compound assignment after declaration.",
  guidance: "Replace `let` with `const` without changing the initializer.",
  violationCode: "let timeout = 5000\nreturn request(timeout)",
  violationExplanation: "The binding is never reassigned in the shown span.",
  nonviolationCode: "let retries = 0\nretries++",
  nonviolationExplanation: "The binding is updated after declaration."
})

const jsonDecode = base({
  id: "CAL_GOOD_JSON_DECODE",
  title: "Decode parsed JSON at the external boundary",
  description: "Values produced by JSON.parse are decoded with the declared schema before domain use.",
  instructions: "Report a changed JSON.parse result passed into domain logic without schema decoding. Do not report values immediately decoded before use.",
  violation: "Changed code passes the result of JSON.parse into domain logic without first decoding it with a schema.",
  compliant: "The parsed unknown value is decoded with the relevant schema before domain use.",
  reportWhen: "The changed span contains JSON.parse and a subsequent domain use of that result with no intervening schema decode.",
  doNotReport: "Do not report when the parsed result is immediately supplied to a schema decoder before any domain use.",
  guidance: "Keep the parsed value unknown and decode it with the boundary schema before using it as domain data.",
  violationCode: "const account = JSON.parse(body)\nreturn saveAccount(account)",
  violationExplanation: "The parsed value reaches domain logic without decoding.",
  nonviolationCode: "const value = JSON.parse(body)\nconst account = Schema.decodeUnknownSync(Account)(value)",
  nonviolationExplanation: "The parsed unknown value is decoded before domain use."
})

const withId = (rule: Domain.ReviewRule, id: string): Domain.ReviewRule => ({ ...rule, id })

const badRule: Domain.ReviewRule = {
  ...withId(bindServices, "CAL_DEFECTIVE_UNDERSPECIFIED"),
  title: "Use better APIs",
  description: "Use preferred APIs where appropriate.",
  instructions: "Report code that could probably be better.",
  criteria: { violation: "The code does not use the best API.", compliant: "The current API is acceptable or has a good reason." },
  semantic: {
    context: "The repository generally prefers better APIs.",
    reportWhen: "Another API would probably be better.",
    doNotReport: "Do not report when the current API is needed or there is a good reason.",
    guidance: "Fix the issue.",
    evidence: "changed-span",
    examples: [
      { outcome: "violation", code: "const value = foo()", explanation: "A better API might exist." },
      { outcome: "nonviolation", code: "const value = foo()", explanation: "This might be acceptable." }
    ]
  }
}

const contradiction: Domain.ReviewRule = {
  ...withId(preferConst, "CAL_DEFECTIVE_CONTRADICTION"),
  criteria: {
    violation: "Any changed local declaration that uses `let`, including bindings that are reassigned.",
    compliant: "A `let` binding is compliant when it is subsequently reassigned or updated."
  }
}

const mislabeledExamples: Domain.ReviewRule = {
  ...withId(renamedImports, "CAL_DEFECTIVE_MISLABELED_EXAMPLES"),
  semantic: {
    ...renamedImports.semantic!,
    examples: [
      { outcome: "nonviolation", code: "import { decodeUnknown as decode } from \"effect/Schema\"", explanation: "This rename is allowed." },
      { outcome: "violation", code: "import { decodeUnknown } from \"effect/Schema\"", explanation: "This keeps the exported name." }
    ]
  }
}

const circularRemediation: Domain.ReviewRule = {
  ...withId(jsonDecode, "CAL_DEFECTIVE_CIRCULAR_REMEDIATION"),
  semantic: { ...jsonDecode.semantic!, guidance: "Remove the violation and make the code compliant." }
}

const preferredApi = base({
  id: "CAL_AMBIGUOUS_PREFERRED_API",
  title: "Prefer the best API",
  description: "Use the repository's preferred API when practical.",
  instructions: "Report uses of less suitable APIs unless there is a reasonable exception.",
  violation: "Changed code uses a less suitable API when a preferred API is practical.",
  compliant: "Changed code uses the preferred API or has a reasonable exception.",
  reportWhen: "The changed API is not the best choice for the situation.",
  doNotReport: "Do not report when migration would be impractical or the current API is reasonable.",
  guidance: "Move to the preferred API while preserving behavior.",
  violationCode: "const text = await oldRead(path)",
  violationExplanation: "A preferred reader is practical here.",
  nonviolationCode: "const text = await oldRead(path)",
  nonviolationExplanation: "The existing reader is reasonable here."
})

const unclearException = base({
  id: "CAL_AMBIGUOUS_EXCEPTION",
  title: "Avoid direct constructors except for infrastructure",
  description: "Application code obtains clients from services rather than constructing them directly.",
  instructions: "Report direct client construction outside legitimate infrastructure code.",
  violation: "Changed application code directly constructs a client.",
  compliant: "Infrastructure code may construct clients when necessary.",
  reportWhen: "A changed expression invokes a client constructor outside infrastructure.",
  doNotReport: "Do not report legitimate infrastructure or necessary bootstrap construction.",
  guidance: "Obtain the client from its service unless construction belongs to infrastructure.",
  violationCode: "const client = new ApiClient(config)",
  violationExplanation: "Application code constructs the client directly.",
  nonviolationCode: "const client = new ApiClient(config)",
  nonviolationExplanation: "This is legitimate infrastructure."
})

const vaguePerformance = base({
  id: "CAL_AMBIGUOUS_PERFORMANCE",
  title: "Avoid expensive work in hot paths",
  description: "Hot paths avoid expensive operations that could harm performance.",
  instructions: "Report unnecessarily expensive changed operations in performance-sensitive code.",
  violation: "A hot path performs an expensive operation unnecessarily.",
  compliant: "The operation is inexpensive, outside a hot path, or necessary.",
  reportWhen: "Changed performance-sensitive code performs work that is too expensive.",
  doNotReport: "Do not report when the cost is acceptable or necessary.",
  guidance: "Use a less expensive operation while preserving behavior.",
  violationCode: "for (const item of items) await load(item)",
  violationExplanation: "The repeated load is expensive in this hot path.",
  nonviolationCode: "for (const item of items) await load(item)",
  nonviolationExplanation: "The load is necessary and the path is not performance-sensitive."
})

const vagueSecurity = base({
  id: "CAL_AMBIGUOUS_SECURITY",
  title: "Do not expose sensitive information",
  description: "Logs and errors must not expose sensitive information.",
  instructions: "Report changed output that could reveal sensitive values, except when disclosure is safe.",
  violation: "Changed code emits sensitive information.",
  compliant: "Changed code emits nonsensitive information or a safe representation.",
  reportWhen: "A changed log or error contains information that may be sensitive.",
  doNotReport: "Do not report information that is safe to expose.",
  guidance: "Remove or safely redact the sensitive portion.",
  violationCode: "logger.info(\"request\", request.value)",
  violationExplanation: "The value may contain sensitive information.",
  nonviolationCode: "logger.info(\"request\", request.value)",
  nonviolationExplanation: "The value is safe to expose."
})

const callGraphEvidence = base({
  id: "CAL_EVIDENCE_CALL_GRAPH",
  title: "Await promises before request completion",
  description: "Request handlers await every promise they start before completing.",
  instructions: "Report a promise started by changed handler code when no transitive caller awaits it before request completion.",
  violation: "A changed handler starts a promise that no transitive caller awaits before completing the request.",
  compliant: "The promise is awaited locally or by a transitive caller before request completion.",
  reportWhen: "The changed span starts a promise and the repository call graph shows that no caller awaits it.",
  doNotReport: "Do not report when any transitive caller awaits completion or intentionally owns the background task.",
  guidance: "Transfer ownership to a scoped background service or await completion before the request returns.",
  evidence: "changed-span",
  violationCode: "sendAudit(event)",
  violationExplanation: "No transitive caller awaits the started promise.",
  nonviolationCode: "sendAudit(event)",
  nonviolationExplanation: "A transitive caller awaits the returned completion signal."
})

const bunEvidence = base({
  id: "CAL_EVIDENCE_BUN_RUNTIME",
  title: "Prefer Bun APIs when runtime semantics permit",
  description: "Use Bun APIs when they preserve required runtime and execution semantics.",
  instructions: "Judge the API choice in its enclosing operation, including runtime, compatibility, and synchronous behavior constraints.",
  violation: "Changed code uses a Node filesystem API although a Bun API has equivalent runtime and execution semantics.",
  compliant: "The code uses a Bun API, or a runtime, compatibility, capability, or synchronous constraint makes substitution non-equivalent.",
  reportWhen: "The complete enclosing operation uses a Node filesystem API and no repository runtime or caller constraint makes the Bun replacement non-equivalent.",
  doNotReport: "Do not report when complete evidence is unavailable or a runtime, caller, compatibility, capability, or synchronous constraint may make substitution non-equivalent.",
  guidance: "Use the Bun API only when it preserves all required semantics; otherwise retain the necessary platform API.",
  evidence: "enclosing-symbol",
  violationCode: "const text = await readFile(path, \"utf8\")",
  violationExplanation: "The operation has no conflicting runtime or execution constraint.",
  nonviolationCode: "// Must complete synchronously before first IPC response.\nreturn readFileSync(path, \"utf8\")",
  nonviolationExplanation: "The documented synchronous constraint makes the asynchronous Bun substitute non-equivalent."
})

const crossFileEvidence = base({
  id: "CAL_EVIDENCE_CROSS_FILE",
  title: "Keep dependency direction inward",
  description: "Domain modules do not depend on adapter implementations.",
  instructions: "Report changed imports when the imported declaration belongs to an adapter layer anywhere in the repository.",
  violation: "A changed domain module imports a declaration implemented by an adapter module.",
  compliant: "The domain module imports only domain declarations or inward-facing interfaces.",
  reportWhen: "The changed import resolves to a declaration whose repository layer is adapter.",
  doNotReport: "Do not report imports that resolve to domain interfaces, even when an adapter implements them elsewhere.",
  guidance: "Depend on an inward-facing domain interface and provide the adapter at composition time.",
  evidence: "changed-span",
  violationCode: "import { Users } from \"../postgres/Users\"",
  violationExplanation: "Repository resolution identifies the declaration as an adapter implementation.",
  nonviolationCode: "import { Users } from \"../domain/Users\"",
  nonviolationExplanation: "Repository resolution identifies an inward-facing domain interface."
})

const deploymentEvidence = base({
  id: "CAL_EVIDENCE_DEPLOYMENT_CONFIG",
  title: "Use only production-enabled features",
  description: "Code references feature names enabled in every production deployment.",
  instructions: "Report a feature reference unless all external production deployment manifests enable it.",
  violation: "Changed code references a feature absent from at least one external production deployment manifest.",
  compliant: "Every external production deployment manifest enables the referenced feature.",
  reportWhen: "The complete source file references a feature and all deployment manifests prove it is not universally enabled.",
  doNotReport: "Do not report when every production deployment enables the feature or deployment evidence is unavailable.",
  guidance: "Gate the behavior or update deployment policy through the human-owned release process.",
  evidence: "complete-file",
  violationCode: "if (features.newCheckout) launchCheckout()",
  violationExplanation: "An external production manifest does not enable the feature.",
  nonviolationCode: "if (features.newCheckout) launchCheckout()",
  nonviolationExplanation: "Every external production manifest enables the feature."
})

export const cases: ReadonlyArray<CalibrationCase> = [
  { id: "good-bind-services", category: "good", rationale: "Concrete lexical boundary, exception, remediation, evidence, and contrastive examples.", rule: bindServices, expected: expected() },
  { id: "good-renamed-imports", category: "good", rationale: "Concrete import syntax boundary with a namespace-import near miss.", rule: renamedImports, expected: expected() },
  { id: "good-prefer-const", category: "good", rationale: "Observable reassignment boundary and explicit update exceptions.", rule: preferConst, expected: expected() },
  { id: "good-json-decode", category: "good", rationale: "Observable data-flow boundary within the selected changed span.", rule: jsonDecode, expected: expected() },
  { id: "defective-underspecified", category: "defective", rationale: "Subjective circular policy, contradictory identical examples, infeasible evidence, and no remediation.", rule: badRule, expected: expected({ failures: [...checkIds] }) },
  { id: "defective-contradiction", category: "defective", rationale: "Violation and compliant criteria explicitly disagree about reassigned let bindings.", rule: contradiction, expected: expected({ failures: ["internal-consistency", "examples-faithful"] }) },
  { id: "defective-mislabeled-examples", category: "defective", rationale: "Both example labels are reversed under the otherwise operational rule.", rule: mislabeledExamples, expected: expected({ failures: ["internal-consistency", "examples-faithful", "examples-boundary"] }) },
  { id: "defective-circular-remediation", category: "defective", rationale: "Guidance merely repeats that the violation should be removed.", rule: circularRemediation, expected: expected({ failures: ["remediation-actionable"] }) },
  { id: "ambiguous-preferred-api", category: "ambiguous", rationale: "Preferred, suitable, practical, and reasonable are undefined policy judgments.", rule: preferredApi, expected: expected({ advisories: ["operational-boundary", "applicability-clarity", "exceptions-operational", "remediation-actionable", "examples-faithful", "examples-boundary"] }) },
  { id: "ambiguous-exception", category: "ambiguous", rationale: "Infrastructure, legitimate, and necessary are not operationally defined.", rule: unclearException, expected: expected({ advisories: ["applicability-clarity", "exceptions-operational", "examples-faithful", "examples-boundary"] }) },
  { id: "ambiguous-performance", category: "ambiguous", rationale: "Hot, expensive, unnecessary, acceptable, and necessary lack measurable boundaries.", rule: vaguePerformance, expected: expected({ advisories: ["operational-boundary", "applicability-clarity", "exceptions-operational", "examples-faithful", "examples-boundary"] }) },
  { id: "ambiguous-security", category: "ambiguous", rationale: "Sensitive and safe are not tied to a classification or observable value flow.", rule: vagueSecurity, expected: expected({ advisories: ["operational-boundary", "applicability-clarity", "exceptions-operational", "examples-faithful", "examples-boundary"] }) },
  { id: "evidence-call-graph", category: "evidence-infeasible", rationale: "Changed-span evidence cannot establish transitive caller behavior or ownership.", rule: callGraphEvidence, expected: expected({ failures: ["evidence-feasible"] }) },
  { id: "evidence-bun-runtime", category: "evidence-infeasible", rationale: "An enclosing symbol cannot prove repository runtime targets, caller constraints, or compatibility requirements.", rule: bunEvidence, expected: expected({ failures: ["evidence-feasible"] }) },
  { id: "evidence-cross-file", category: "evidence-infeasible", rationale: "Changed-span evidence cannot resolve imported declarations and repository-layer ownership.", rule: crossFileEvidence, expected: expected({ failures: ["evidence-feasible"] }) },
  { id: "evidence-deployment-config", category: "evidence-infeasible", rationale: "Complete-file evidence cannot establish external production deployment configuration.", rule: deploymentEvidence, expected: expected({ failures: ["evidence-feasible"] }) }
]
