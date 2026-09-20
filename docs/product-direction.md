# Product direction

neuralint is a repository-owned semantic linting system for coding-agent loops and focused human review.

## Product contract

### `neuralint check`

The default path is fast, read-only, and intended to complete within a few seconds:

```text
repository rules × changed code
  → deterministic applicability routing
  → bounded Jev decision matrix
  → changed-construct findings
  → authored generic guidance
```

Agents use this before declaring work complete, committing, or opening a pull request. Confirmed findings should be the default output; uncertainty may be exposed separately as advisories.

### Focused human remediation

Human-facing review reuses semantic findings rather than asking a general model to rediscover a complete catalog:

```text
Jev finding + rule + evidence
  → focused reviewer
  → repository-specific impact and remediation
  → pull-request summary or comment
```

A separate verification model stage is not part of the preferred architecture. It should only be introduced if broader evaluation shows that Jev's confirmed precision is inadequate. Evidence-insufficient results are deferred rather than represented as confirmed findings.

## Rule-pack lifecycle

```text
style guides + historical review corrections + approved examples
  → generate draft rules and fixtures
  → human Git review
  → shadow evaluation
  → stable pack release
  → check and review usage
  → confirmations, dismissals, and reported misses
  → doctor proposals
  → regression evaluation
  → human approval
```

Consumers should normally use only `init`, `check`, and eventually `review`. Pack maintainers use `rules generate`, `rules test`, and `rules doctor`.

Rule authoring remains deliberately constrained:

- context;
- report boundary;
- explicit nonviolations and exceptions;
- authored generic guidance;
- one evidence-scope preset;
- 2–4 contrastive prompt examples;
- a larger external fixture suite;
- pinned provenance and human ownership.

Generated rules are drafts. Common source patterns alone are not organizational policy, and no model-generated rule is activated without human review.

## Evidence and claims

Two independent benchmarks support the architecture:

1. **Semantic linting:** whether Jev detects and localizes policy matches accurately within lint-loop latency.
2. **Remediation handoff:** whether a focused reviewer can turn a correct structured finding into human-quality repository-specific remediation faster and cheaper than full-catalog review.

The current pilots establish technical viability, not broad production reliability. Claims remain scoped to the measured corpora until balanced fixtures, clean PRs, real historical corrections, repetitions, and blinded human evaluation are available.

See:

- [`../benchmark/jev-matrix/README.md`](../benchmark/jev-matrix/README.md)
- [`../benchmark/remediation/SPEC.md`](../benchmark/remediation/SPEC.md)
- [`../benchmark/remediation/results/REPORT.md`](../benchmark/remediation/results/REPORT.md)
