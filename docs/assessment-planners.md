# Assessment planner protocol

Status: proposed

This document specifies how neuralint should turn a caller-selected collection of files into bounded semantic assessment cases. It is a design contract for the next implementation; the current alpha still exposes the earlier `semantic.evidence` presets.

## Product boundary

The caller chooses the complete collection that neuralint may assess. A collection is usually a pull-request delta, but it may instead contain explicit files, editor buffers and changed ranges, or a repository snapshot.

A rule chooses how that collection is assessed by naming an assessment planner. A planner may filter, group, and project files already present in the collection. It must not silently expand the collection with additional repository files.

```text
caller-selected collection
  → rule-selected assessment planner
  → bounded, source-linked assessment cases
  → preflight validation and packing
  → Jev rule × case decisions
  → deterministic findings
```

The default planner is `semantic-chunks`. It preserves the semantic meaning of bounded changed regions with local Tree-sitter scopes and comments. Repository-specific planners support relationships that neuralint cannot know universally, such as service-to-test, contract-to-caller, or implementation-to-specification mappings.

## Terminology

- **Collection:** Every file the caller made available for one invocation.
- **Target:** A file or range on which neuralint may report a finding.
- **Assessment planner:** A deterministic function that converts a collection into cases for one rule.
- **Assessment case:** One independently assessable subject plus its supporting evidence.
- **Projection:** Compact structured facts or bounded ranges derived from collection files.
- **Completeness:** Whether the planner searched everything in the supplied collection required by its relationship contract.
- **Preflight:** Local planning, validation, estimation, and budget enforcement performed before model requests.
- **Reporter:** Output rendering after evaluation. Reporter is deliberately not used as a synonym for planner.

## Collection model

A collection preserves both content and change information when the caller has it.

```ts
interface FileCollection {
  readonly schemaVersion: 1
  readonly id: string
  readonly source: "git-delta" | "explicit-files" | "editor" | "snapshot"
  readonly base?: string
  readonly head?: string
  readonly files: ReadonlyArray<CollectionFile>
}

interface CollectionFile {
  readonly id: string
  readonly path: string
  readonly oldPath?: string
  readonly status: "added" | "modified" | "deleted" | "renamed" | "unchanged"
  readonly before?: string
  readonly after?: string
  readonly changedRanges: ReadonlyArray<ChangedRange>
}

interface ChangedRange {
  readonly old?: { readonly startLine: number; readonly endLine: number }
  readonly new?: { readonly startLine: number; readonly endLine: number }
}
```

A snapshot may contain only `after` content and no changed ranges. A rule about a *new* declaration cannot be evaluated identically on that snapshot; its planner must return no applicable cases or report incomplete planning rather than infer a nonexistent baseline.

File IDs, normalized paths, statuses, contents, and ranges are assigned by neuralint. Custom planners reference those IDs instead of returning arbitrary paths or source text.

## Rule configuration

The proposed rule field is:

```yaml
assessment:
  planner: semantic-chunks
```

The field may be omitted because `semantic-chunks` is the default. A repository-specific rule names a configured planner:

```yaml
assessment:
  planner: effect-service-contract-tests
```

A planner controls assessment framing, not policy. The rule continues to own the violation boundary, exceptions, guidance, and contrastive examples.

The current `semantic.evidence` presets should be removed when this protocol is implemented. Tree-sitter scopes become an internal part of `semantic-chunks`, not a rule-authored retrieval choice.

## Built-in planners

### `semantic-chunks`

`semantic-chunks` is the default planner.

For delta collections it:

1. derives deterministic changed spans;
2. splits large hunks on stable lexical boundaries;
3. caps primary spans conservatively (currently approximately 40 lines or 6,000 characters);
4. parses complete supported files locally;
5. attaches bounded enclosing syntax scopes and associated comments;
6. emits source-linked cases whose findings point to the changed span.

For snapshot collections it may use bounded named declarations or other deterministic syntax units as targets. Snapshot behavior must remain explicit in the plan because there is no changed side.

This planner is intended for naming, local API use, control flow, local data flow, and similar policies whose deciding facts belong to one semantic unit.

### `filenames`

`filenames` emits one compact collection-level case containing path facts and, when available, change statuses:

```text
added     src/Accounts.ts
modified  test/Accounts.test.ts
renamed   docs/account.md → docs/accounts.md
deleted   src/LegacyAccounts.ts
```

It sends no source content. It is intended for co-change, file-placement, manifest, migration, documentation, and repository-hygiene policies.

A filenames case is global and unsplittable unless the rule's semantics explicitly permit partitioning. Preflight rejects an oversized manifest rather than silently dropping paths.

### Deliberately excluded defaults

`whole-files` and `whole-collection` are not standard planners. Experiments showed that source files around 400 lines can dilute the deciding signal even when they fit the provider token window. Provider capacity is therefore not a sufficient quality boundary.

Complete files may still be read locally by a planner, but the planner should project them into bounded ranges or compact facts before evaluation.

## Planner function

Conceptually, every planner implements:

```ts
interface AssessmentPlanner {
  readonly name: string
  readonly partitioning: "independent-cases" | "global-unsplittable"
  readonly plan: (
    request: PlannerRequest
  ) => Promise<PlannerResult>
}

interface PlannerRequest {
  readonly schemaVersion: 1
  readonly ruleId: string
  readonly collection: FileCollection
  readonly limits: PlannerLimits
}
```

The same protocol may be implemented by a library callback, a separate executable, or a precomputed manifest. Transport does not change validation semantics.

## Planner result

A planner returns independently assessable cases, not a flat unstructured file list.

```ts
interface PlannerResult {
  readonly schemaVersion: 1
  readonly planner: string
  readonly cases: ReadonlyArray<AssessmentCase>
  readonly coverage: PlanningCoverage
}

interface AssessmentCase {
  readonly id: string
  readonly subjects: ReadonlyArray<Projection>
  readonly evidence: ReadonlyArray<Projection>
  readonly completeness: PlanningCoverage
}

interface Projection {
  readonly label: string
  readonly sources: ReadonlyArray<SourceReference>
  readonly facts?: JsonValue
}

interface SourceReference {
  readonly fileId: string
  readonly side: "before" | "after"
  readonly range?: { readonly startLine: number; readonly endLine: number }
}

interface PlanningCoverage {
  readonly status: "complete" | "partial" | "unavailable"
  readonly basis: string
  readonly filesConsidered: number
}
```

`subjects` identify where a finding may be reported. `evidence` supports the decision but cannot become an invented finding location. A projection may provide bounded source references, compact facts, or both.

`basis` is an auditable factual explanation of planner coverage, not a policy judgment. Examples include `all files in the supplied collection were matched against the configured test convention` or `three files were omitted after the planner byte limit was reached`.

## Minimum sufficient evidence

Custom planners should return the smallest deterministic, source-linked representation that preserves every fact required to decide the rule. They should not return complete files when names, signatures, relationships, or bounded syntax ranges are sufficient.

For a rule requiring tests for new Effect services, a repository planner might return:

```json
{
  "id": "AccountsService",
  "subjects": [
    {
      "label": "service surface",
      "sources": [
        {
          "fileId": "F001",
          "side": "after",
          "range": { "startLine": 12, "endLine": 38 }
        }
      ],
      "facts": {
        "service": "AccountsService",
        "exportedMethods": ["create", "findById", "disable"]
      }
    }
  ],
  "evidence": [
    {
      "label": "related tests",
      "sources": [
        {
          "fileId": "F002",
          "side": "after",
          "range": { "startLine": 8, "endLine": 74 }
        }
      ],
      "facts": {
        "suite": "AccountsService",
        "tests": [
          "creates an account",
          "finds an account by id",
          "disables an active account"
        ]
      }
    }
  ],
  "completeness": {
    "status": "complete",
    "basis": "all selected TypeScript test modules were checked using the repository service-test convention",
    "filesConsidered": 42
  }
}
```

The planner extracts service and test facts. Jev decides whether those facts satisfy the rule. The planner must not emit conclusions such as `compliant`, `violation`, or `all contracts are tested`.

Test names alone are sufficient only when the repository's policy and conventions make them decisive. Otherwise the planner must retain relevant calls, assertions, signatures, or bounded test bodies. Small but insufficient evidence is not a valid optimization.

Custom planner guidance:

- Extract facts; do not make the policy decision.
- Link every material fact to collection source locations.
- State whether the relationship search was complete, partial, or unavailable.
- Use stable case IDs and deterministic ordering.
- Exclude unrelated implementation details, generated content, and secrets.
- Keep each case independently understandable.
- Preserve counterexamples and exceptions required by the rule boundary.
- Test misleading names and superficially related files, not only happy paths.

## Completeness and absence

Absence-based conclusions require complete planning. For example, `no corresponding test module was present` can support a definitive finding only when the planner reports complete coverage of the supplied collection under its declared relationship convention.

`complete` is always relative to the caller-selected collection. It does not claim that files outside that collection were searched. Reports must identify the collection source and planner coverage so users can distinguish `no related test in this PR` from `no related test in the repository snapshot`.

A partial or unavailable case may produce an inconclusive advisory but never a definitive absence-based finding.

## Preflight and limits

Neuralint performs preflight for every rule and planner before making any model request:

```text
collection validation
  → planner execution
  → planner-result validation
  → semantic concentration checks
  → Jev token estimation
  → request packing
  → run-budget decision
```

Initial operational limits should cover:

```yaml
limits:
  maxFiles: 500
  maxCollectionBytes: 5000000
  maxCases: 1000
  maxFilesPerCase: 20
  maxCaseBytes: 100000
  maxRequests: 20
  maxInputTokens: 500000
```

These are cost and resource limits, not policy thresholds. Product defaults must be conservative and overridable by the caller or trusted project configuration.

Preflight enforces two independent boundaries:

1. **Provider capacity:** Jev's aggregate and longest-binding limits, with conservative packing targets.
2. **Semantic concentration:** an empirical case-size limit below provider capacity, because large inputs can dilute the deciding signal despite fitting the token window.

The packer may combine independent cases into requests. It may not split a case unless the planner declared and produced independent subcases. A `global-unsplittable` case that exceeds either boundary is unassessable.

## Run outcomes

Every run has one of three completion outcomes:

- **complete:** every planned case was evaluated;
- **incomplete:** valid cases existed, but the configured run budget prevented complete evaluation;
- **unassessable:** at least one required case could not fit without violating its semantic boundary.

Incomplete and unassessable runs exit 2. Findings from completed cases may be rendered, but the overall result cannot be clean. Neuralint never silently truncates files, projections, facts, or cases.

When preflight can identify the failure, no model requests are made. A diagnostic should name the planner, rule, observed size, applicable limit, and remediation:

```text
planner "filenames" produced an unsplittable case estimated at
31,420 binding tokens; configured limit is 27,000.

Narrow the input collection or use a partitioning planner.
No model requests were made.
```

Provider-side limit errors discovered after preflight retain the existing deterministic split-and-retry behavior only for independent cases. Otherwise the run becomes incomplete and exits 2.

## Plan inspection

A planned command should expose preflight without model cost:

```sh
neuralint check --plan
```

Its text and versioned JSON output should include:

- collection source, files, bytes, and changed ranges;
- planner selected by each rule;
- cases, subjects, evidence references, and completeness;
- semantic concentration violations;
- estimated requests and input tokens;
- unsplittable or unassessable cases;
- whether model execution would proceed.

## Custom command transport

A future command adapter may configure a planner as an argument vector, never an interpolated shell string:

```yaml
assessmentPlanners:
  effect-service-contract-tests:
    command:
      - node
      - tools/neuralint/effect-service-contract-tests.mjs
    timeoutMs: 2000
```

Neuralint writes one `PlannerRequest` JSON value to stdin and accepts one `PlannerResult` JSON value from stdout. Stderr is reserved for diagnostics. The process receives cancellation and is terminated on timeout.

A custom planner is trusted executable code and can read files or environment outside the protocol. Output validation limits what neuralint accepts and sends onward, but it is not an operating-system sandbox. CI must load executable planner configuration from a trusted source, not silently execute planner changes introduced by an untrusted pull request. A precomputed planner-result manifest is the safer transport when that trust boundary cannot be guaranteed.

## Validation

Neuralint validates planner output before token estimation:

- planner name matches the configured planner;
- case IDs are unique, stable nonempty strings;
- all file IDs exist in the supplied collection;
- sides and line ranges exist and are in bounds;
- subjects are nonempty and source-linked;
- facts are finite JSON values within byte limits;
- counts and aggregate bytes stay within configured limits;
- completeness is explicit;
- ordering is canonicalized before hashing and packing;
- no source content is accepted outside collection references.

Invalid output is an operational planner failure and exits 2. It is never converted into a clean or policy finding.

## Doctor and regression fixtures

Doctor checks planner feasibility, not arbitrary future collection size. Deterministic checks should verify that:

- the named planner exists;
- partitioning behavior is declared;
- subjects and material facts are source-linked;
- completeness is explicit;
- the planner has bounded output;
- absence-based rules require complete coverage;
- representative oversized fixtures do not produce monolithic cases;
- contrastive fixtures preserve the rule's deciding facts after projection.

Planner fixture suites should include:

- compliant and violating relationships;
- missing related files;
- misleading filenames and test names;
- multiple subjects sharing one evidence file;
- renamed and deleted files;
- snapshot input without a baseline;
- partial collections;
- oversized files and collections;
- deterministic repeated output.

Doctor cannot certify planner correctness. Human review and whole-pack behavioral regression remain required.

## Migration plan

1. Introduce `AssessmentCase` and collection completion metadata internally.
2. Implement `semantic-chunks` using the current changed-span and Tree-sitter code.
3. Implement `filenames` and `check --plan`.
4. Replace public `semantic.evidence` with rule-selected assessment planners.
5. Add planner-result schema validation and preflight failure semantics.
6. Add precomputed-manifest and library callback transports.
7. Add trusted command planners after the execution threat model is implemented.
8. Validate the first cross-file vertical slice with an Effect service-to-test planner.
9. Remove compatibility handling for the old evidence presets before 1.0.

The first implementation should not attempt universal repository relationship inference. Neuralint supplies the bounded protocol; repositories supply their own deterministic relationship knowledge.
