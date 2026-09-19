# Realistic top-of-funnel benchmark

This benchmark evaluates neuralint as a fast routing layer rather than as a final reviewer. The primary question is whether it retains defect-bearing PRs and relevant policy locations for deeper analysis while reducing the rule × PR search space.

## Corpus

The corpus uses the real [`sindresorhus/p-map`](https://github.com/sindresorhus/p-map) repository pinned at commit `f0c43e358a449584c2045c89d1b9ae3cd5a9f293`.

Five synthetic PRs make small, plausible “cleanup” or “optimization” changes to production code:

1. bypass coordinated abort cleanup;
2. invoke a mapper after the operation has settled;
3. swallow exactly one mapper error;
4. abandon an unfinished source iterator;
5. exceed the configured backpressure limit by one.

The changes preserve realistic surrounding code and include plausible but incorrect comments. Five repository-specific policies produce 25 rule × PR pairs. There are six labeled findings because bypassing abort cleanup also permits mapper work after settlement.

The patches and labels are stored in [`patches/`](patches/) and [`benchmark.yaml`](benchmark.yaml). They are generated defects, not allegations about upstream PR authors.

## Evaluators

### neuralint

Runs the production two-stage Jev cascade against each Git diff. Both `violation` and `inconclusive` results count as top-of-funnel candidates.

### Coding-agent competitors

Each competitor receives a fresh checkout and may inspect the full repository using read-only review instructions. It reads the same policy artifacts and reviews `base...HEAD`. Competitors are configured in [`competitors.yaml`](competitors.yaml).

Adding another Pi-backed model requires only another entry:

```yaml
- id: sol-low
  kind: pi
  model: openai-codex/gpt-5.6-sol
  thinking: low
  tools: [read, bash]
```

## Run

```sh
direnv exec . pnpm benchmark:realistic \
  > benchmark/realistic/results/p-map-terra-low.json
```

The first run clones the pinned upstream repository into ignored `benchmark/.cache/`. Scenario checkouts are temporary and removed afterward.

## Initial result

| Evaluator | PR routing recall | Exact candidate recall | Candidate precision | Confirmed recall | Latency | Input tokens | Reported cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| neuralint / Jev | 100% (5/5) | 83.3% (5/6) | 83.3% (5/6) | 50% (3/6) | 2.26 s | 12,005 | $0.000504 |
| GPT-5.6 Terra, low | 100% (5/5) | 100% (6/6) | 100% (6/6) | 100% (6/6) | 82.33 s | 27,761 | $0.068802 |

Jev cost is calculated at **$0.042/MTok input with free output**. neuralint was approximately **36× faster**. It routed all five defect-bearing PRs onward. At exact policy granularity it missed the secondary “work after settlement” consequence of the abort bug, marked two expected findings inconclusive instead of confirmed, and emitted one extra inconclusive candidate. Terra found all six expected policy matches and no extras.

This is consistent with the intended funnel: neuralint quickly reduced 25 possible policy/PR combinations to six candidates without dropping an entire defective PR; Terra spent substantially more time to resolve the exact diagnoses.

Full per-scenario output, probabilities, agent explanations, token usage, and costs are in [`results/p-map-terra-low.json`](results/p-map-terra-low.json).

## Limitations

- Five generated PRs are still a tiny corpus.
- Policies and labels were authored with knowledge of the seeded defects, not blindly adjudicated.
- Every PR contains a defect; the 20 nonmatching rule/PR pairs provide negatives, but clean PRs are still needed.
- Terra had repository tools while neuralint currently reasons primarily over diff evidence. This intentionally compares workflows, not isolated model capability.
- Results are single runs and do not measure variance.
- Exact-rule scoring penalizes neuralint even when another finding routes the same hunk onward; PR routing recall better reflects the top-of-funnel goal.

The next iteration should mix clean PRs, seeded PRs, and independently labeled real historical bugs across multiple repositories, then run each evaluator repeatedly.
