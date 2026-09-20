#!/usr/bin/env python3
"""Generate the N=54 Sol/Opus repeated benchmark report."""

from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "benchmark/home-assistant/results/strong-reviewers-n54"
QUALITY = RESULTS / "quality-fable-high.json"
OUTPUT = RESULTS / "REPORT.md"

NAMES = {
    "sol-low": "GPT-5.6 Sol, low",
    "opus-low": "Claude Opus 4.8, low",
}
WORKFLOWS = {
    "full-catalog": "Full-catalog review",
    "screen-then-review": "Jev screen → focused review",
}


def money(value: float) -> str:
    return f"${value:.4f}"


def seconds(value: float) -> str:
    return f"{value:.1f}s"


def pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def values(runs: list[dict[str, Any]], reviewer: str, workflow: str, field: str) -> list[float]:
    return [
        float(run[field])
        for run in sorted(runs, key=lambda item: item["repetition"])
        if run["reviewer"] == reviewer and run["workflow"] == workflow
    ]


def main() -> None:
    result = json.loads(QUALITY.read_text())
    runs = result["runs"]
    lines = [
        "# N=54 strong-reviewer benchmark",
        "",
        "> Five paired repetitions on five generated Home Assistant regressions. Every repetition contains all 54 official Integration Quality Scale policies in a different deterministic order. Treat this as a controlled stability study, not a production reliability estimate.",
        "",
        "## Result",
        "",
        "All four workflows passed the repository-aware Fable quality gate in **all five repetitions**:",
        "",
        "- 100/100 generated reviews were information-complete, grounded, actionable, and free of material errors or unsafe remediation.",
        "- Jev retained all 25 expected candidates across the five repetitions and emitted no extra candidates.",
        "- Focused review reduced median cost by 45.5% for Sol and 46.2% for Opus.",
        "- Focused review was 2.42× faster at the median for Sol and 1.58× faster for Opus.",
        "",
        "## Summary",
        "",
        "| Reviewer | Workflow | 100%-quality runs | Actionable reviews | Median time (range) | Median cost (range) |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for reviewer in ("sol-low", "opus-low"):
        for workflow in ("full-catalog", "screen-then-review"):
            selected = [run for run in runs if run["reviewer"] == reviewer and run["workflow"] == workflow]
            times = [run["latencyMs"] / 1000 for run in selected]
            costs = [run["costUsd"] for run in selected]
            lines.append(
                f"| **{NAMES[reviewer]}** | {WORKFLOWS[workflow]} | "
                f"{sum(run['quality100'] for run in selected)}/5 | "
                f"{sum(run['groundedActionable'] for run in selected)}/{sum(run['reviews'] for run in selected)} | "
                f"{seconds(statistics.median(times))} ({seconds(min(times))}–{seconds(max(times))}) | "
                f"{money(statistics.median(costs))} ({money(min(costs))}–{money(max(costs))}) |"
            )

    lines.extend([
        "",
        "## Paired effect of Jev screening",
        "",
        "| Reviewer | Mean cost reduction | Median cost reduction | Mean speedup | Median speedup | Mean absolute saving/run |",
        "|---|---:|---:|---:|---:|---:|",
    ])
    for reviewer in ("sol-low", "opus-low"):
        full = {
            run["repetition"]: run
            for run in runs
            if run["reviewer"] == reviewer and run["workflow"] == "full-catalog"
        }
        routed = {
            run["repetition"]: run
            for run in runs
            if run["reviewer"] == reviewer and run["workflow"] == "screen-then-review"
        }
        savings = [1 - routed[index]["costUsd"] / full[index]["costUsd"] for index in range(1, 6)]
        speedups = [full[index]["latencyMs"] / routed[index]["latencyMs"] for index in range(1, 6)]
        absolute = [full[index]["costUsd"] - routed[index]["costUsd"] for index in range(1, 6)]
        lines.append(
            f"| **{NAMES[reviewer]}** | {pct(statistics.mean(savings))} | "
            f"{pct(statistics.median(savings))} | {statistics.mean(speedups):.2f}× | "
            f"{statistics.median(speedups):.2f}× | {money(statistics.mean(absolute))} |"
        )

    lines.extend([
        "",
        "## Repetition-level measurements",
        "",
        "| Repetition | Seed | Reviewer | Full time | Focused time | Speedup | Full cost | Focused cost | Savings | Quality |",
        "|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for repetition in range(1, 6):
        for reviewer in ("sol-low", "opus-low"):
            full = next(
                run for run in runs
                if run["repetition"] == repetition and run["reviewer"] == reviewer and run["workflow"] == "full-catalog"
            )
            routed = next(
                run for run in runs
                if run["repetition"] == repetition and run["reviewer"] == reviewer and run["workflow"] == "screen-then-review"
            )
            speedup = full["latencyMs"] / routed["latencyMs"]
            saving = 1 - routed["costUsd"] / full["costUsd"]
            quality = "100% / 100%" if full["quality100"] and routed["quality100"] else "failed"
            lines.append(
                f"| {repetition} | {full['seed']} | {NAMES[reviewer]} | "
                f"{seconds(full['latencyMs'] / 1000)} | {seconds(routed['latencyMs'] / 1000)} | "
                f"{speedup:.2f}× | {money(full['costUsd'])} | {money(routed['costUsd'])} | "
                f"{pct(saving)} | {quality} |"
            )

    lines.extend([
        "",
        "## Jev stability",
        "",
        "| Repetition | Candidate recall | Extra candidates | Definitive | Inconclusive | Time | Cost |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for run in result["jevRuns"]:
        lines.append(
            f"| {run['repetition']} | {run['candidateTruePositive']}/{run['expectedFindings']} | "
            f"{run['candidateFalsePositive']} | {run['confirmedTruePositive']} | "
            f"{run['candidateTruePositive'] - run['confirmedTruePositive']} | "
            f"{seconds(run['latencyMs'] / 1000)} | {money(run['costUsd'])} |"
        )

    generation_cost = sum(run["costUsd"] for run in runs)
    generation_time = sum(run["latencyMs"] for run in runs) / 1000
    judge_cost = sum(call["costUsd"] for call in result["calls"])
    judge_time = sum(call["latencyMs"] for call in result["calls"]) / 1000
    lines.extend([
        "",
        "## Quality evaluation",
        "",
        "Fable 5/high judged reviews anonymously in 20 batches, with one review per scenario in each batch. It had read-only access to the pinned Home Assistant checkout, so repository-derived claims were not rejected merely for being absent from the diff.",
        "",
        "| Measure | Result |",
        "|---|---:|",
        f"| Reviews judged | {len(result['reviews'])} |",
        f"| Actionable reviews | {sum(review['actionable'] for review in result['reviews'])}/{len(result['reviews'])} |",
        f"| Material errors | {sum(review['materialError'] for review in result['reviews'])} |",
        f"| Unsafe remediation | {sum(review['unsafeRemediation'] for review in result['reviews'])} |",
        f"| Judge time | {seconds(judge_time)} |",
        f"| Judge cost | {money(judge_cost)} |",
        "",
        "Judge cost is benchmark-evaluation overhead and is excluded from workflow costs. Fable is in the same provider family as Opus, so human or cross-provider calibration remains desirable despite blinded identities.",
        "",
        "## Cost and time consumed",
        "",
        "| Activity | Measured time | Provider-reported cost |",
        "|---|---:|---:|",
        f"| Successful reviewer workflows | {seconds(generation_time)} | {money(generation_cost)} |",
        f"| Fable judging | {seconds(judge_time)} | {money(judge_cost)} |",
        f"| **Recorded total** | **{seconds(generation_time + judge_time)}** | **{money(generation_cost + judge_cost)}** |",
        "",
        "One malformed Opus response caused the first attempt at repetition 4 to abort before an artifact was written. The repetition was rerun after adding Claude structured-output enforcement. The failed attempt's unrecorded cost and time are not included above.",
        "",
        "## Interpretation",
        "",
        "At N=54, focusing the stronger reviewer preserved measured quality in every repetition while materially reducing both cost and latency. The economic effect was much larger than with Luna: average absolute savings were about $0.09 per five-PR Sol run and $0.25 per five-PR Opus run.",
        "",
        "Sol was the lower-cost option; Opus was generally faster. Because all quality measurements tied, this study does not establish that one reviewer writes better comments. It establishes that both tolerated the Jev handoff without a measured quality loss on these five controlled regressions.",
        "",
        "## Limitations",
        "",
        "- The five PRs are generated, positive, mostly localized regressions; there are no clean PRs.",
        "- Repetitions vary policy order and provider sampling but reuse the same five defects.",
        "- A perfect 25/25 result per workflow is still a small, correlated sample.",
        "- Fable and Opus share a provider family.",
        "- Provider pricing, caching, and CLI agent behavior may change.",
        "- Results apply to N=54 only; they do not establish the shape of the scaling curve.",
        "",
        "## Reproduce",
        "",
        "```sh",
        "direnv exec . python benchmark/strong-reviewers/run.py",
        "direnv exec . python benchmark/strong-reviewers/judge.py",
        "python benchmark/strong-reviewers/report.py",
        "```",
        "",
    ])
    OUTPUT.write_text("\n".join(lines))
    print(OUTPUT)


if __name__ == "__main__":
    main()
