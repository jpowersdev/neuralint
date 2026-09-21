# Rule doctor calibration

This controlled corpus contains four good, four clearly defective, four ambiguous, and four evidence-infeasible rules. Labels are human-authored at the fixed-check level. Controlled mutations isolate known authorship defects; this is a calibration baseline, not an estimate of production prevalence.

## Execution

- 16 rules × 8 checks = 128 labeled observations
- Median probability across 3 repeated evaluations per rule
- 48 Jev requests at concurrency 4
- 1822 ms wall time
- 78,633 input tokens
- Estimated Jev input cost: $0.00330
- Maximum repeated-score spread: 8 percentage points; 4 advisory and 5 failure threshold crossings

## Rule-level detection

| Category | Cases | Expected concern | Flagged ≥45% | Failed ≥75% |
|---|---:|---:|---:|---:|
| good | 4 | 0 | 1 | 0 |
| defective | 4 | 4 | 4 | 3 |
| ambiguous | 4 | 4 | 4 | 4 |
| evidence-infeasible | 4 | 4 | 4 | 3 |

## Threshold metrics

Advisory metrics treat both human-labeled advisories and failures as positive. Failure metrics treat only human-labeled failures as positive. Rule-level scores use each rule's maximum check probability, matching whether the CLI emits any concern at a band.

| Band | Threshold | Precision | Recall | Specificity | F1 | TP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Rule: current advisory | 0.45 | 92% | 100% | 75% | 96% | 12 | 1 | 0 |
| Rule: best observed advisory | 0.70 | 100% | 100% | 100% | 100% | 12 | 0 | 0 |
| Rule: current failure | 0.75 | 60% | 75% | 50% | 67% | 6 | 4 | 2 |
| Rule: best observed failure | 0.70 | 67% | 100% | 50% | 80% | 8 | 4 | 0 |
| Check: current advisory | 0.45 | 50% | 97% | 59% | 66% | 37 | 37 | 1 |
| Check: best observed advisory | 0.65 | 72% | 89% | 86% | 80% | 34 | 13 | 4 |
| Check: current failure | 0.75 | 37% | 78% | 78% | 50% | 14 | 24 | 4 |
| Check: best observed failure | 0.85 | 56% | 50% | 94% | 53% | 9 | 7 | 9 |

## Current-advisory mismatches

- `good-json-decode` / `evidence-feasible`: expected pass, Jev 47% (advisory)
- `defective-contradiction` / `operational-boundary`: expected pass, Jev 62% (advisory)
- `defective-contradiction` / `applicability-clarity`: expected pass, Jev 54% (advisory)
- `defective-contradiction` / `exceptions-operational`: expected pass, Jev 63% (advisory)
- `defective-contradiction` / `evidence-feasible`: expected pass, Jev 57% (advisory)
- `defective-contradiction` / `examples-faithful`: expected failure, Jev 32% (pass)
- `defective-mislabeled-examples` / `operational-boundary`: expected pass, Jev 74% (advisory)
- `defective-mislabeled-examples` / `applicability-clarity`: expected pass, Jev 79% (failure)
- `defective-mislabeled-examples` / `exceptions-operational`: expected pass, Jev 88% (failure)
- `defective-mislabeled-examples` / `evidence-feasible`: expected pass, Jev 47% (advisory)
- `defective-mislabeled-examples` / `remediation-actionable`: expected pass, Jev 62% (advisory)
- `ambiguous-preferred-api` / `internal-consistency`: expected pass, Jev 53% (advisory)
- `ambiguous-preferred-api` / `evidence-feasible`: expected pass, Jev 80% (failure)
- `ambiguous-exception` / `operational-boundary`: expected pass, Jev 85% (failure)
- `ambiguous-exception` / `internal-consistency`: expected pass, Jev 71% (advisory)
- `ambiguous-exception` / `evidence-feasible`: expected pass, Jev 76% (failure)
- `ambiguous-exception` / `remediation-actionable`: expected pass, Jev 45% (advisory)
- `ambiguous-performance` / `internal-consistency`: expected pass, Jev 52% (advisory)
- `ambiguous-performance` / `evidence-feasible`: expected pass, Jev 82% (failure)
- `ambiguous-performance` / `remediation-actionable`: expected pass, Jev 61% (advisory)
- `ambiguous-security` / `internal-consistency`: expected pass, Jev 75% (failure)
- `ambiguous-security` / `evidence-feasible`: expected pass, Jev 74% (advisory)
- `ambiguous-security` / `remediation-actionable`: expected pass, Jev 56% (advisory)
- `evidence-call-graph` / `operational-boundary`: expected pass, Jev 55% (advisory)
- `evidence-call-graph` / `applicability-clarity`: expected pass, Jev 55% (advisory)
- `evidence-call-graph` / `exceptions-operational`: expected pass, Jev 52% (advisory)
- `evidence-call-graph` / `examples-faithful`: expected pass, Jev 72% (advisory)
- `evidence-call-graph` / `examples-boundary`: expected pass, Jev 64% (advisory)
- `evidence-bun-runtime` / `operational-boundary`: expected pass, Jev 64% (advisory)
- `evidence-bun-runtime` / `applicability-clarity`: expected pass, Jev 46% (advisory)
- `evidence-cross-file` / `operational-boundary`: expected pass, Jev 53% (advisory)
- `evidence-cross-file` / `applicability-clarity`: expected pass, Jev 54% (advisory)
- `evidence-deployment-config` / `operational-boundary`: expected pass, Jev 56% (advisory)
- `evidence-deployment-config` / `internal-consistency`: expected pass, Jev 59% (advisory)
- `evidence-deployment-config` / `applicability-clarity`: expected pass, Jev 76% (failure)
- `evidence-deployment-config` / `exceptions-operational`: expected pass, Jev 60% (advisory)
- `evidence-deployment-config` / `examples-faithful`: expected pass, Jev 66% (advisory)
- `evidence-deployment-config` / `examples-boundary`: expected pass, Jev 50% (advisory)

## Interpretation boundary

Do not change product thresholds from this small controlled corpus alone. Prefer thresholds that preserve precision for good rules, then expand with independently authored and blinded examples before treating the bands as calibrated.
