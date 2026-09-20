# Gold-handoff remediation pilot

> **Pilot result:** one paired run on five generated Home Assistant regressions. This tests remediation given a human-authored confirmed packet; it does not test Jev detection or verification.

## Headline

Gold handoff → Terra matched direct full-catalog Terra on every measured quality item while materially reducing latency and cost:

- **10/10 reviews actionable**: 5 direct and 5 gold-handoff;
- **zero material errors** and **zero unsafe remediations** in either arm;
- **10/10 pairwise ties** across two order-reversed judging passes;
- **3.31× faster** end to end;
- **69.8% less wall time**;
- **24.1% lower provider-reported cost**.

## Aggregate result

| Workflow | Reviews | Actionable | Time | Cost | Input tokens | Output tokens | Read-tool paths observed |
|---|---:|---:|---:|---:|---:|---:|---:|
| Full-catalog Terra | 5 | 5/5 | 513.5s | $0.127532 | 37,020 | 2,111 | 298 |
| Gold handoff → Terra | 5 | 5/5 | 154.9s | $0.096778 | 35,317 | 1,880 | 14 |

The read-path count reflects visible `read` tool arguments only; it is not a complete accounting of files accessed through shell commands.

## Per-case economics

| Case | Direct time | Handoff time | Direct cost | Handoff cost |
|---|---:|---:|---:|---:|
| `remove-unload-entry` | 102.1s | 23.7s | $0.01813 | $0.03369 |
| `create-private-websession` | 95.0s | 33.3s | $0.01937 | $0.01063 |
| `remove-sensor-unique-id` | 99.3s | 35.6s | $0.04377 | $0.03586 |
| `untranslated-action-error` | 92.5s | 36.4s | $0.02936 | $0.00765 |
| `remove-parallel-update-limit` | 124.5s | 25.9s | $0.01690 | $0.00895 |

Arm order alternated by case. Both arms used `openai-codex/gpt-5.6-terra` with `low` thinking and the same read/bash tools against the same pinned checkout.

## Blinded quality result

Sol/high scored each review independently in two mixed batches and compared every pair twice with reversed A/B order.

| Measure | Direct | Gold handoff |
|---|---:|---:|
| Invariant identifiable | 100% | 100% |
| Location identifiable | 100% | 100% |
| Impact identifiable | 100% | 100% |
| Remediation understandable | 100% | 100% |
| Remediation appropriate | 100% | 100% |
| Evidence grounded | 100% | 100% |
| Actionable | 100% | 100% |
| Material-error rate | 0% | 0% |
| Unsafe-remediation rate | 0% | 0% |

Pairwise preferences: **0 direct**, **0 handoff**, **10 ties**, **0 neither**.

## What this establishes

For these five localized, confirmed violations, a compact diagnosis/evidence packet was sufficient for Terra to produce remediation guidance with the same measured quality as direct full-catalog review, while avoiding broad policy discovery.

This supports the narrow Step 3 hypothesis:

> Given a correct structured diagnosis, focused Terra can explain repository-specific remediation faster and cheaper than direct full-catalog Terra.

## What this does not establish

- The corpus contains only five generated positive regressions from one Home Assistant integration.
- Gold packets were human-authored from known ground truth.
- There are no false, ambiguous, clean, or multi-finding packets.
- Detection recall and verification accuracy are outside this benchmark.
- Sol and Terra are in the same model family; blinded human evaluation remains necessary.
- One paired run does not estimate provider variance or establish statistical non-inferiority.
- Direct Terra read all 54 policies, while the focused arm received one confirmed packet by design.

## Experimental expense

| Activity | Time | Cost |
|---|---:|---:|
| Valid direct and gold-handoff workflows | 668.4s | $0.224310 |
| Superseded no-evidence-schema pilot | 583.6s | $0.208492 |
| Sol/high blinded judging | 127.1s | $0.273180 |
| **Recorded total** | **1379.2s** | **$0.705982** |

The first workflow run was preserved but excluded from the result because the common output schema accidentally omitted explicit evidence, making groundedness impossible to score consistently.

## Artifacts

- Valid workflow output: `benchmark/remediation/results/pilot.json`
- Superseded schema output: `benchmark/remediation/results/pilot-v1-no-evidence.json`
- Blinded fixture: `benchmark/remediation/fixtures/pilot.json`
- Judge output: `benchmark/remediation/results/quality-sol-high.json`
- Gold case rubrics: `benchmark/remediation/cases.json`
