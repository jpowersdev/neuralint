#!/usr/bin/env python3
"""Render the gold-handoff remediation pilot report."""

from __future__ import annotations

import json
from pathlib import Path

SUITE = Path(__file__).resolve().parent
RESULT = SUITE / "results/pilot.json"
SUPERSEDED = SUITE / "results/pilot-v1-no-evidence.json"
QUALITY = SUITE / "results/quality-sol-high.json"
OUTPUT = SUITE / "results/REPORT.md"


def totals(result: dict, arm: str) -> dict[str, float]:
    evaluations = [case[arm] for case in result["results"]]
    return {
        "latencyMs": sum(item["latencyMs"] for item in evaluations),
        "costUsd": sum(item["usage"].get("costUsd", 0) for item in evaluations),
        "inputTokens": sum(item["usage"].get("inputTokens", 0) for item in evaluations),
        "outputTokens": sum(item["usage"].get("outputTokens", 0) for item in evaluations),
        "filesRead": sum(len(item.get("filesRead", [])) for item in evaluations),
    }


def main() -> None:
    result = json.loads(RESULT.read_text())
    superseded = json.loads(SUPERSEDED.read_text())
    quality = json.loads(QUALITY.read_text())
    direct = totals(result, "direct")
    gold = totals(result, "goldHandoff")
    old_direct = totals(superseded, "direct")
    old_gold = totals(superseded, "goldHandoff")
    speedup = direct["latencyMs"] / gold["latencyMs"]
    time_reduction = 1 - gold["latencyMs"] / direct["latencyMs"]
    cost_reduction = 1 - gold["costUsd"] / direct["costUsd"]
    judge_cost = sum(call.get("costUsd", 0) or 0 for call in quality["calls"])
    judge_latency = sum(call.get("latencyMs", 0) for call in quality["calls"])
    valid_workflow_cost = direct["costUsd"] + gold["costUsd"]
    superseded_cost = old_direct["costUsd"] + old_gold["costUsd"]

    rows = []
    for case in result["results"]:
        rows.append(
            f"| `{case['id']}` | {case['direct']['latencyMs'] / 1000:.1f}s | "
            f"{case['goldHandoff']['latencyMs'] / 1000:.1f}s | "
            f"${case['direct']['usage'].get('costUsd', 0):.5f} | "
            f"${case['goldHandoff']['usage'].get('costUsd', 0):.5f} |"
        )

    summary = quality["summary"]
    pairwise = summary["pairwise"]
    report = f"""# Gold-handoff remediation pilot

> **Pilot result:** one paired run on five generated Home Assistant regressions. This tests remediation given a human-authored confirmed packet; it does not test Jev detection or verification.

## Headline

Gold handoff → Terra matched direct full-catalog Terra on every measured quality item while materially reducing latency and cost:

- **10/10 reviews actionable**: 5 direct and 5 gold-handoff;
- **zero material errors** and **zero unsafe remediations** in either arm;
- **10/10 pairwise ties** across two order-reversed judging passes;
- **{speedup:.2f}× faster** end to end;
- **{time_reduction:.1%} less wall time**;
- **{cost_reduction:.1%} lower provider-reported cost**.

## Aggregate result

| Workflow | Reviews | Actionable | Time | Cost | Input tokens | Output tokens | Read-tool paths observed |
|---|---:|---:|---:|---:|---:|---:|---:|
| Full-catalog Terra | 5 | 5/5 | {direct['latencyMs'] / 1000:.1f}s | ${direct['costUsd']:.6f} | {int(direct['inputTokens']):,} | {int(direct['outputTokens']):,} | {int(direct['filesRead'])} |
| Gold handoff → Terra | 5 | 5/5 | {gold['latencyMs'] / 1000:.1f}s | ${gold['costUsd']:.6f} | {int(gold['inputTokens']):,} | {int(gold['outputTokens']):,} | {int(gold['filesRead'])} |

The read-path count reflects visible `read` tool arguments only; it is not a complete accounting of files accessed through shell commands.

## Per-case economics

| Case | Direct time | Handoff time | Direct cost | Handoff cost |
|---|---:|---:|---:|---:|
{chr(10).join(rows)}

Arm order alternated by case. Both arms used `{result['model']}` with `{result['thinking']}` thinking and the same read/bash tools against the same pinned checkout.

## Blinded quality result

Sol/high scored each review independently in two mixed batches and compared every pair twice with reversed A/B order.

| Measure | Direct | Gold handoff |
|---|---:|---:|
| Invariant identifiable | {summary['direct']['invariantIdentifiable']:.0%} | {summary['routed']['invariantIdentifiable']:.0%} |
| Location identifiable | {summary['direct']['locationIdentifiable']:.0%} | {summary['routed']['locationIdentifiable']:.0%} |
| Impact identifiable | {summary['direct']['impactIdentifiable']:.0%} | {summary['routed']['impactIdentifiable']:.0%} |
| Remediation understandable | {summary['direct']['remediationUnderstandable']:.0%} | {summary['routed']['remediationUnderstandable']:.0%} |
| Remediation appropriate | {summary['direct']['remediationAppropriate']:.0%} | {summary['routed']['remediationAppropriate']:.0%} |
| Evidence grounded | {summary['direct']['evidenceGrounded']:.0%} | {summary['routed']['evidenceGrounded']:.0%} |
| Actionable | {summary['direct']['actionable']:.0%} | {summary['routed']['actionable']:.0%} |
| Material-error rate | {summary['direct']['materialErrorRate']:.0%} | {summary['routed']['materialErrorRate']:.0%} |
| Unsafe-remediation rate | {summary['direct']['unsafeRemediationRate']:.0%} | {summary['routed']['unsafeRemediationRate']:.0%} |

Pairwise preferences: **{pairwise['direct']} direct**, **{pairwise['routed']} handoff**, **{pairwise['tie']} ties**, **{pairwise['neither']} neither**.

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
| Valid direct and gold-handoff workflows | {(direct['latencyMs'] + gold['latencyMs']) / 1000:.1f}s | ${valid_workflow_cost:.6f} |
| Superseded no-evidence-schema pilot | {(old_direct['latencyMs'] + old_gold['latencyMs']) / 1000:.1f}s | ${superseded_cost:.6f} |
| Sol/high blinded judging | {judge_latency / 1000:.1f}s | ${judge_cost:.6f} |
| **Recorded total** | **{(direct['latencyMs'] + gold['latencyMs'] + old_direct['latencyMs'] + old_gold['latencyMs'] + judge_latency) / 1000:.1f}s** | **${valid_workflow_cost + superseded_cost + judge_cost:.6f}** |

The first workflow run was preserved but excluded from the result because the common output schema accidentally omitted explicit evidence, making groundedness impossible to score consistently.

## Artifacts

- Valid workflow output: `benchmark/remediation/results/pilot.json`
- Superseded schema output: `benchmark/remediation/results/pilot-v1-no-evidence.json`
- Blinded fixture: `benchmark/remediation/fixtures/pilot.json`
- Judge output: `benchmark/remediation/results/quality-sol-high.json`
- Gold case rubrics: `benchmark/remediation/cases.json`
"""
    OUTPUT.write_text(report)
    print(OUTPUT)


if __name__ == "__main__":
    main()
