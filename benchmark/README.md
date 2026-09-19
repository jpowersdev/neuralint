# Policy classifier benchmark

This benchmark compares neuralint's two-stage Jev classifier with a general coding model given the same repository-authored policy and unified diff.

## Pilot corpus

[`cases.yaml`](cases.yaml) contains 12 human-labeled cases for the two policies in [`examples/unsafe-service`](../examples/unsafe-service/):

- 6 violations and 6 compliant changes;
- direct and indirect dynamic source execution;
- direct and indirect secret logging;
- superficially similar compliant changes such as JSON parsing, explicit redaction, and logging a token-presence boolean.

These synthetic cases are a harness smoke test, not a statistically meaningful quality claim. A useful benchmark needs accepted and rejected findings sampled from real pull requests, blinded adjudication, repeated runs, and confidence intervals.

## Compared configurations

### Jev

The runner reproduces neuralint's cascade for each case:

1. screen at the policy's `screenAt` threshold;
2. localize screened cases;
3. classify at the policy's `violationAt` threshold.

### Coding agent

The runner invokes Pi with a fresh, tool-free, session-free context for every case. The agent receives the same policy description, instructions, violation/compliance criteria, path, and diff. It returns a binary classification, confidence, explanation, and decisive lines.

The default baseline is `openai-codex/gpt-5.6-terra` at low thinking.

## Run

The TypeSafe key is loaded through the repository's `.envrc.local`. Pi uses its configured provider authentication.

```sh
direnv exec . pnpm benchmark -- \
  --model openai-codex/gpt-5.6-terra \
  --thinking low \
  > benchmark/results/terra-low-pilot.json
```

Use `--limit N` for a smoke run.

## Initial pilot result

| Evaluator | Strict accuracy | Coverage | Accuracy when decided | Confirmed recall | Candidate recall | Wall latency | Reported cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jev cascade | 91.7% | 91.7% | 100% | 83.3% | 100% | 2.33 s | $0.000347 |
| GPT-5.6 Terra, low | 100% | 100% | 100% | 100% | 100% | 31.33 s | $0.02465 |

“Confirmed recall” counts only findings above the violation threshold. “Candidate recall” also counts inconclusive findings that neuralint routes onward rather than silently accepting.

Jev was roughly 13.4× faster in sequential wall time. String-based `setTimeout` was its only inconclusive result: screening assigned 69% violation probability and localization 66%, between the 35% screening and 80% violation thresholds. Thus it was not a false negative—the cascade retained it for human or stronger-model review. Terra resolved the case as a violation at 98% reported confidence.

The full per-case output is preserved in [`results/terra-low-pilot.json`](results/terra-low-pilot.json).

Repository-backed suites:

- [`realistic/`](realistic/README.md): five targeted policies against `sindresorhus/p-map`.
- [`home-assistant/`](home-assistant/README.md): all 54 official Integration Quality Scale rules against five generated Home Assistant PRs.

## Next benchmark work

1. Build a corpus from real PRs rather than obvious synthetic examples.
2. Include difficult negatives and insufficient-context cases.
3. Have labels independently adjudicated without seeing model output.
4. Run each evaluator multiple times to measure variance.
5. Measure parallel throughput in addition to sequential latency.
6. Track Jev cost at $0.042/MTok input with free output, alongside competitor pricing.
7. Compare both equal-evidence classification and full repository-access agent review.
