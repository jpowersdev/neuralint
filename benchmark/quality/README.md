# Review-quality fixtures

This directory separates review generation from review scoring. The committed fixture preserves model outputs so judge development does not repeatedly call Terra or accidentally change the answers being evaluated.

## Home Assistant 54-rule fixture

[`fixtures/home-assistant-54.json`](fixtures/home-assistant-54.json) contains:

- five independently labeled Home Assistant regression cases;
- five direct-Terra reviews generated while considering all 54 policies;
- five routed-Terra reviews generated only from neuralint candidates;
- the relevant policy, canonical diff hunk, source commit, and patch path;
- explanations, cited evidence, and suggested remediation;
- a SHA-256 digest of the source benchmark result.

The `workflow` field is fixture metadata. Judges must not receive it. Scoring code should create purpose-specific views:

1. **Comprehension:** expose only one assembled review comment and an anonymous review ID.
2. **Grounding:** expose the extracted interpretation, policy, diff, and pinned repository context.
3. **Pairwise:** expose anonymized `A` and `B` comments, with deterministic randomized order and an order-reversed replicate.

The original generated text must remain unchanged. Intentionally degraded reviews belong in a separate adversarial fixture.

## Regenerate and verify

```sh
pnpm quality:fixture
pnpm quality:fixture:check
```

`BuildFixture.ts` fails unless every scenario has exactly one expected finding, one neuralint candidate, one direct review, and one routed review. `--check` also fails if the source result changed without regenerating the committed fixture.

## Current Sol/high result

The first blinded run scored all ten original reviews as information-sufficient, grounded, and actionable, with no material errors or unsafe remediation. In two pairwise passes with exact A/B order reversal, all five direct-versus-routed comparisons were ties in both orders.

| Measure | Direct Terra | neuralint → Terra |
| --- | ---: | ---: |
| Violation comprehension | 5/5 | 5/5 |
| Location comprehension | 5/5 | 5/5 |
| Impact comprehension | 5/5 | 5/5 |
| Remediation comprehension | 5/5 | 5/5 |
| Grounded evidence | 5/5 | 5/5 |
| Actionable review | 5/5 | 5/5 |
| Material errors | 0/5 | 0/5 |
| Unsafe remediation | 0/5 | 0/5 |

The pairwise result was 10 ties, zero direct preferences, zero routed preferences, and zero unusable pairs. All preferences were stable under order reversal.

This judge was also run against six hand-authored calibration controls: one valid review and reviews with missing impact, vague content, unsafe remediation, fabricated location/evidence, and missing remediation. It matched all 25 asserted labels across all six controls. This is a minimal sanity check, not broad judge validation.

The quality run used four Sol/high requests, cost `$0.25308`, and took 118.49 seconds. The adversarial calibration used one request, cost `$0.09295`, and took 55.41 seconds. Parsed outputs are under `results/`; raw provider responses are not retained.

Run the evaluations with:

```sh
pnpm quality:judge
pnpm quality:judge:adversarial
```

## Cross-model scaling result

The nested 10/25/54-policy pilot now compares four pinned reviewer models spanning provider and capability tiers:

- GPT-5.6 Terra through Pi;
- GPT-5.6 Luna through Pi;
- Claude Sonnet 5 through Claude CLI;
- Claude Haiku 4.5 through Claude CLI.

Each model performs both full-catalog review and focused drafting from the same frozen Jev candidates. The complete grouped tables, quality-gated cost/time rankings, raw structured results, and limitations are in the [scaling report](../home-assistant/results/scaling/REPORT.md).

The initial context-free judge incorrectly rejected valid repository-derived details, including Terra's correct claim that Home Assistant moves an integration without `async_unload_entry` to `FAILED_UNLOAD`. The current scaling result therefore uses a blinded context-free pass followed by repository-aware adjudication for every non-passing review. This correction is part of the result provenance, not a manual model-specific override.

Sol remains the primary judge for that scaling matrix, but the benchmark still needs human calibration or an additional independent judge because Terra and Luna share its provider family. Contestant models do not judge their own outputs in the primary evaluation.

A separate [N=54 repeated study](../home-assistant/results/strong-reviewers-n54/REPORT.md) uses repository-aware Fable/high to judge five paired repetitions of Sol and Opus full-catalog versus Jev-screened review. All 100 comments passed the frozen absolute quality rubric. Fable and Opus share a provider family, so that result still requires human or cross-provider calibration.

## Planned scoring outputs

Absolute assessment should record atomic information sufficiency rather than prose quality:

- violation identifiable;
- location identifiable;
- impact understandable;
- remediation understandable or legitimately not applicable;
- evidence grounded;
- material factual error present;
- unsafe remediation present;
- usable without hidden inference.

Pairwise assessment is secondary and allows `A`, `B`, `tie`, or `neither`. Judges must ignore grammar, tone, eloquence, formatting, verbosity, and concision except when wording prevents reliable understanding.
