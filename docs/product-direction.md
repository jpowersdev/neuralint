# Product direction

neuralint is a repository-owned semantic linting system for coding-agent loops and focused human review.

## Lifecycle goal

neuralint should move repository-authored engineering guidance as early as possible in the lifecycle of a change, then re-evaluate the complete change at progressively stronger publication boundaries:

```text
repository rules
  → context before generation
  → guard before mutation
  → check before push
  → check again in trusted CI
  → focused remediation for human review
```

This is progressive integration rather than a requirement to adopt one coding harness:

1. **Teach before generation.** Any agent or human can use `neuralint context` to load applicable idioms and constraints.
2. **Prevent before mutation.** Supported harnesses can use `neuralint guard` to evaluate a proposed edit before it reaches the working tree.
3. **Validate before publication.** Developers can run `neuralint check` directly or from a Git pre-push hook.
4. **Enforce before merge.** Organizations run the same check in CI, where local bypasses do not define policy.
5. **Escalate uncertainty.** Structured findings can feed focused human review rather than being represented as proof.

The desired contract is: **teach early, prevent locally, verify globally, and escalate uncertainty to humans.** Each stage is read-only with respect to reviewed source code. A harness may decline its own proposed write after consulting `guard`, but neuralint does not perform the mutation.

## Product contract

### `neuralint context` (planned)

`context` will render repository-authored rules as compact guidance before an agent generates code. It should be usable through ordinary stdout in any harness, with optional path-based applicability filtering and a versioned structured format for integrations.

The rendering must be deterministic and derived from authored rule fields. It should not ask another model to summarize policy, because generated summaries can omit exceptions or distort the rule's intended boundary. When the complete applicable catalog exceeds a context budget, the output should expose that truncation and retain rule identities for later retrieval.

### `neuralint guard` (planned)

`guard` will compare current working-tree content with a proposed candidate state and evaluate only the resulting virtual delta. It will return a host-neutral allow, warn, or deny result without writing the candidate. Thin integrations can translate Edit or Write requests from supported harnesses into this protocol and translate findings back into actionable tool feedback.

Pre-edit denial should remain conservative. Definitive, locally decidable candidates may block an edit; inconclusive or evidence-insufficient results remain warnings. Aggregate and cross-file behavior is still checked after the complete change, and future integrations may submit multi-file edit transactions where the harness supports them.

### `neuralint check`

The default path is fast, read-only, and intended to complete within a few seconds:

```text
caller-selected file collection × repository rules
  → rule-selected assessment planners
  → bounded, source-linked semantic cases
  → deterministic applicability routing and preflight
  → dual-budget Jev decision packs
  → deterministic findings
  → authored generic guidance
```

Agents use this before declaring work complete, committing, pushing, or opening a pull request. A pre-push hook provides early aggregate feedback for humans and agents that do not have a `guard` integration, while CI remains the authoritative organizational boundary because local hooks are optional and bypassable. Definitive candidate findings should be the default output; uncertainty may be exposed separately as advisories.

### Focused human remediation

Human-facing review reuses semantic findings rather than asking a general model to rediscover a complete catalog:

```text
Jev finding + rule + evidence
  → focused reviewer
  → repository-specific impact and remediation
  → pull-request summary or comment
```

A separate verification model stage is not part of the preferred architecture. The caller controls the available file collection, while each rule selects an assessment planner that deterministically projects that collection into bounded semantic cases. The default planner uses changed spans and local Tree-sitter context; repository-specific planners may group related files and emit compact source-linked facts. Broader verification should only be introduced if confirmed precision remains inadequate. Partial, oversized, or otherwise evidence-insufficient plans are reported explicitly rather than represented as confirmed findings.

## Rule-pack lifecycle

```text
style guides + historical review corrections + approved examples
  → generate draft rules and fixtures
  → human Git review
  → shadow evaluation
  → stable pack release
  → check and review usage
  → confirmations, dismissals, and reported misses
  → doctor diagnostics and maintainer decisions
  → regression evaluation
  → human approval
```

Consumers should normally use only `init`, `context`, `check`, and eventually supported `guard` integrations and `review`. Pack maintainers use `rules generate`, `rules test`, and `rules doctor`.

Rule authoring remains deliberately constrained:

- context;
- report boundary;
- explicit nonviolations and exceptions;
- authored generic guidance;
- one assessment planner, defaulting to semantic chunks;
- 2–4 contrastive prompt examples;
- a larger external fixture suite;
- pinned provenance and human ownership.

Generated rules are drafts. Common source patterns alone are not organizational policy, and no model-generated rule is activated without human review.

The initial `rules doctor` command combines deterministic validation with a fixed Jev rule-quality matrix. Jev scores operational boundaries, consistency, applicability, exceptions, evidence feasibility, remediation, examples, and optional source alignment. The default report maps each concern to an authored explanation, relevant rule fields, and general next steps; no general model is required. With `--explain`, a concise Astra call through `effect-pi` may contextualize the concern, quote supporting wording, and identify maintainer questions, but it is prohibited from rewriting the rule or inventing policy. Output remains a diagnostic report under `.neuralint/doctor/`, and active rules are never modified. Rule changes remain human-authored and require behavioral regression against the complete active pack.

## Evidence and claims

Two independent benchmarks support the architecture:

1. **Semantic linting:** whether Jev detects and localizes policy matches accurately within lint-loop latency.
2. **Remediation handoff:** whether a focused reviewer can turn a correct structured finding into human-quality repository-specific remediation faster and cheaper than full-catalog review.

The current pilots establish technical viability, not broad production reliability. Claims remain scoped to the measured corpora until balanced fixtures, clean PRs, real historical corrections, repetitions, and blinded human evaluation are available.

Future lifecycle evaluation should compare no integration, context only, guard only, immediate post-edit feedback, and context plus guard followed by the same final check. Success requires both functional acceptance and independently adjudicated policy compliance; neuralint's own findings cannot serve as their own ground truth. Useful secondary measures include first-attempt compliance, guard denials, recovery after denial, false blocks, completion time, token cost, and edit churn.

See:

- [`assessment-planners.md`](assessment-planners.md)
- [`../benchmark/jev-matrix/README.md`](../benchmark/jev-matrix/README.md)
- [`../benchmark/remediation/SPEC.md`](../benchmark/remediation/SPEC.md)
- [`../benchmark/remediation/results/REPORT.md`](../benchmark/remediation/results/REPORT.md)
