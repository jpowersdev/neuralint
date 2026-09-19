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
