# N=54 strong-reviewer benchmark

> Five paired repetitions on five generated Home Assistant regressions. Every repetition contains all 54 official Integration Quality Scale policies in a different deterministic order. Treat this as a controlled stability study, not a production reliability estimate.

## Result

All four workflows passed the repository-aware Fable quality gate in **all five repetitions**:

- 100/100 generated reviews were information-complete, grounded, actionable, and free of material errors or unsafe remediation.
- Jev retained all 25 expected candidates across the five repetitions and emitted no extra candidates.
- Focused review reduced median cost by 45.5% for Sol and 46.2% for Opus.
- Focused review was 2.42× faster at the median for Sol and 1.58× faster for Opus.

## Summary

| Reviewer | Workflow | 100%-quality runs | Actionable reviews | Median time (range) | Median cost (range) |
|---|---|---:|---:|---:|---:|
| **GPT-5.6 Sol, low** | Full-catalog review | 5/5 | 25/25 | 201.0s (175.1s–228.7s) | $0.1886 ($0.1614–$0.2418) |
| **GPT-5.6 Sol, low** | Jev screen → focused review | 5/5 | 25/25 | 94.5s (78.9s–115.0s) | $0.1029 ($0.0773–$0.1680) |
| **Claude Opus 4.8, low** | Full-catalog review | 5/5 | 25/25 | 117.2s (111.1s–141.0s) | $0.5278 ($0.4878–$0.5541) |
| **Claude Opus 4.8, low** | Jev screen → focused review | 5/5 | 25/25 | 77.2s (71.4s–85.7s) | $0.2763 ($0.2460–$0.3112) |

## Paired effect of Jev screening

| Reviewer | Mean cost reduction | Median cost reduction | Mean speedup | Median speedup | Mean absolute saving/run |
|---|---:|---:|---:|---:|---:|
| **GPT-5.6 Sol, low** | 44.3% | 45.5% | 2.14× | 2.42× | $0.0875 |
| **Claude Opus 4.8, low** | 47.2% | 46.2% | 1.57× | 1.58× | $0.2485 |

## Repetition-level measurements

| Repetition | Seed | Reviewer | Full time | Focused time | Speedup | Full cost | Focused cost | Savings | Quality |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20260919 | GPT-5.6 Sol, low | 201.0s | 114.4s | 1.76× | $0.2415 | $0.1680 | 30.4% | 100% / 100% |
| 1 | 20260919 | Claude Opus 4.8, low | 111.1s | 85.7s | 1.30× | $0.5492 | $0.3112 | 43.3% | 100% / 100% |
| 2 | 20260920 | GPT-5.6 Sol, low | 191.9s | 78.9s | 2.43× | $0.1614 | $0.0846 | 47.6% | 100% / 100% |
| 2 | 20260920 | Claude Opus 4.8, low | 141.0s | 71.4s | 1.97× | $0.5278 | $0.2460 | 53.4% | 100% / 100% |
| 3 | 20260921 | GPT-5.6 Sol, low | 213.9s | 82.8s | 2.58× | $0.1886 | $0.1029 | 45.5% | 100% / 100% |
| 3 | 20260921 | Claude Opus 4.8, low | 117.2s | 74.4s | 1.58× | $0.5088 | $0.2738 | 46.2% | 100% / 100% |
| 4 | 20260922 | GPT-5.6 Sol, low | 175.1s | 115.0s | 1.52× | $0.2418 | $0.1428 | 41.0% | 100% / 100% |
| 4 | 20260922 | Claude Opus 4.8, low | 111.1s | 82.0s | 1.36× | $0.4878 | $0.2763 | 43.4% | 100% / 100% |
| 5 | 20260923 | GPT-5.6 Sol, low | 228.7s | 94.5s | 2.42× | $0.1799 | $0.0773 | 57.0% | 100% / 100% |
| 5 | 20260923 | Claude Opus 4.8, low | 128.7s | 77.2s | 1.67× | $0.5541 | $0.2777 | 49.9% | 100% / 100% |

## Jev stability

| Repetition | Candidate recall | Extra candidates | Definitive | Inconclusive | Time | Cost |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 5/5 | 0 | 4 | 1 | 2.5s | $0.0035 |
| 2 | 5/5 | 0 | 5 | 0 | 2.7s | $0.0035 |
| 3 | 5/5 | 0 | 4 | 1 | 2.9s | $0.0035 |
| 4 | 5/5 | 0 | 4 | 1 | 2.8s | $0.0035 |
| 5 | 5/5 | 0 | 4 | 1 | 3.0s | $0.0035 |

## Quality evaluation

Fable 5/high judged reviews anonymously in 20 batches, with one review per scenario in each batch. It had read-only access to the pinned Home Assistant checkout, so repository-derived claims were not rejected merely for being absent from the diff.

| Measure | Result |
|---|---:|
| Reviews judged | 100 |
| Actionable reviews | 100/100 |
| Material errors | 0 |
| Unsafe remediation | 0 |
| Judge time | 1592.9s |
| Judge cost | $13.1121 |

Judge cost is benchmark-evaluation overhead and is excluded from workflow costs. Fable is in the same provider family as Opus, so human or cross-provider calibration remains desirable despite blinded identities.

## Cost and time consumed

| Activity | Measured time | Provider-reported cost |
|---|---:|---:|
| Successful reviewer workflows | 2496.1s | $5.6013 |
| Fable judging | 1592.9s | $13.1121 |
| **Recorded total** | **4089.0s** | **$18.7134** |

One malformed Opus response caused the first attempt at repetition 4 to abort before an artifact was written. The repetition was rerun after adding Claude structured-output enforcement. The failed attempt's unrecorded cost and time are not included above.

## Interpretation

At N=54, focusing the stronger reviewer preserved measured quality in every repetition while materially reducing both cost and latency. The economic effect was much larger than with Luna: average absolute savings were about $0.09 per five-PR Sol run and $0.25 per five-PR Opus run.

Sol was the lower-cost option; Opus was generally faster. Because all quality measurements tied, this study does not establish that one reviewer writes better comments. It establishes that both tolerated the Jev handoff without a measured quality loss on these five controlled regressions.

## Limitations

- The five PRs are generated, positive, mostly localized regressions; there are no clean PRs.
- Repetitions vary policy order and provider sampling but reuse the same five defects.
- A perfect 25/25 result per workflow is still a small, correlated sample.
- Fable and Opus share a provider family.
- Provider pricing, caching, and CLI agent behavior may change.
- Results apply to N=54 only; they do not establish the shape of the scaling curve.

## Reproduce

```sh
direnv exec . python benchmark/strong-reviewers/run.py
direnv exec . python benchmark/strong-reviewers/judge.py
python benchmark/strong-reviewers/report.py
```
