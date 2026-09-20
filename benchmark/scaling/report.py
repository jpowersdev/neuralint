#!/usr/bin/env python3
"""Generate the human-readable nested-catalog benchmark report."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "benchmark/home-assistant/results/scaling"
QUALITY = RESULTS / "quality-sol-high-adjudicated.json"
OUTPUT = RESULTS / "REPORT.md"

REVIEWERS = {
    "terra-low": "GPT-5.6 Terra, low",
    "luna-low": "GPT-5.6 Luna, low",
    "sonnet-low": "Claude Sonnet 5, low",
    "haiku-low": "Claude Haiku 4.5, low",
}
REVIEWER_ORDER = ("terra-low", "luna-low", "sonnet-low", "haiku-low")
WORKFLOWS = {
    "full-catalog": "Full-catalog review",
    "screen-then-review": "Jev screen → focused review",
}


def percent(value: float, digits: int = 1) -> str:
    return f"{value * 100:.{digits}f}%"


def money(value: float) -> str:
    return f"${value:.6f}"


def seconds(milliseconds: int) -> str:
    return f"{milliseconds / 1000:.2f}s"


def quality_rate(workflow: dict[str, Any]) -> float:
    return workflow["groundedActionable"] / workflow["reviews"]


def quality_label(workflow: dict[str, Any]) -> str:
    rate = quality_rate(workflow)
    return "**100% ✓**" if workflow["quality100"] else f"{percent(rate, 0)} ({workflow['groundedActionable']}/{workflow['reviews']})"


def ranking_table(workflows: list[dict[str, Any]], metric: str) -> list[str]:
    units = "End-to-end cost" if metric == "costUsd" else "End-to-end time"
    lines = [
        f"| N | Rank | Reviewer | Workflow | Quality | Issues reviewed | Status | {units} |",
        "|---:|---:|---|---|---:|---:|---:|---:|",
    ]
    for count in sorted({workflow["catalogSize"] for workflow in workflows}):
        qualified = sorted(
            (workflow for workflow in workflows if workflow["catalogSize"] == count and workflow["quality100"]),
            key=lambda workflow: workflow[metric],
        )[:3]
        for rank, workflow in enumerate(qualified, 1):
            value = money(workflow[metric]) if metric == "costUsd" else seconds(workflow[metric])
            lines.append(
                f"| {count} | {rank} | {REVIEWERS[workflow['reviewer']]} | "
                f"{WORKFLOWS[workflow['workflow']]} | 100% ✓ | "
                f"{workflow['expectedIssuesReviewed']}/{workflow['expectedIssues']} | "
                f"{workflow['violations']} V / {workflow['inconclusive']} I | {value} |"
            )
    return lines


def main() -> None:
    quality = json.loads(QUALITY.read_text())
    workflows = quality["workflows"]
    sources = {
        source["rules"]: source
        for source in (
            json.loads(path.read_text())
            for path in sorted(RESULTS.glob("airgradient-n*-seed*.json"))
        )
    }
    lines = [
        "# neuralint nested-catalog benchmark",
        "",
        "> **Pilot result:** one run per catalog size on five generated Home Assistant regressions. "
        "All 54 source policies are independently authored official Integration Quality Scale rules. "
        "These results measure this fixture, not general production reliability.",
        "",
        "## Headline",
        "",
        "Jev found all five expected issues with no extra candidates at 10, 25, and 54 policies. "
        "No reviewer won every group. The cheapest qualified workflows were **Jev → Luna at N=10**, "
        "**Jev → Terra at N=25**, and **full-catalog Luna at N=54**. The fastest qualified workflows "
        "were **Jev → Sonnet at N=10** and **Jev → Terra at N=25 and N=54**. Screening reduced "
        "expensive-review scope by 90.0%, 96.0%, and 98.1% as the catalog grew.",
        "",
        "A workflow passes the **100% quality gate** only when it reviews every expected issue, "
        "emits no extra review, and every review is information-complete, grounded, actionable, "
        "free of material errors, and free of unsafe remediation. An explicitly inconclusive but "
        "complete and useful review remains eligible.",
        "",
        "## Cheapest workflows with 100% quality",
        "",
        *ranking_table(workflows, "costUsd"),
        "",
        "## Fastest workflows with 100% quality",
        "",
        *ranking_table(workflows, "latencyMs"),
        "",
        "## End-to-end results by catalog size",
        "",
    ]

    for count in sorted(sources):
        source = sources[count]
        pairs = count * source["scenarios"]
        current = [workflow for workflow in workflows if workflow["catalogSize"] == count]
        by_key = {(workflow["reviewer"], workflow["workflow"]): workflow for workflow in current}
        lines.extend([
            f"### {count} policies",
            "",
            f"**5 PRs · {pairs} policy/PR decisions · 5 expected issues · seed `{source['experiment']['catalogSeed']}`**",
            "",
            "| Reviewer | Workflow | Work allocation | Issues reviewed | Status | Information-complete | Grounded/actionable | Material errors | Time | Cost |",
            "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
        ])
        for reviewer in REVIEWER_ORDER:
            for workflow_name in ("full-catalog", "screen-then-review"):
                workflow = by_key[(reviewer, workflow_name)]
                allocation = (
                    f"{REVIEWERS[reviewer].split(',')[0]} evaluates {pairs} decisions"
                    if workflow_name == "full-catalog"
                    else f"Jev screens {pairs}; reviewer receives 5 packets"
                )
                lines.append(
                    f"| **{REVIEWERS[reviewer]}** | {WORKFLOWS[workflow_name]} | {allocation} | "
                    f"{workflow['expectedIssuesReviewed']}/{workflow['expectedIssues']} (+{workflow['extraReviews']} extra) | "
                    f"{workflow['violations']} V / {workflow['inconclusive']} I | "
                    f"{workflow['informationComplete']}/{workflow['reviews']} | {quality_label(workflow)} | "
                    f"{workflow['materialErrors']}/{workflow['reviews']} | {seconds(workflow['latencyMs'])} | "
                    f"{money(workflow['costUsd'])} |"
                )
        lines.append("")
        scope_reduction = 1 - 5 / pairs
        for reviewer in REVIEWER_ORDER:
            full = by_key[(reviewer, "full-catalog")]
            screened = by_key[(reviewer, "screen-then-review")]
            speedup = full["latencyMs"] / screened["latencyMs"]
            time_reduction = 1 - screened["latencyMs"] / full["latencyMs"]
            cost_reduction = 1 - screened["costUsd"] / full["costUsd"]
            quality_delta = quality_rate(screened) - quality_rate(full)
            coverage_delta = screened["expectedIssuesReviewed"] - full["expectedIssuesReviewed"]
            coverage_text = (
                "unchanged at 5/5"
                if coverage_delta == 0 and full["expectedIssuesReviewed"] == full["expectedIssues"]
                else f"{full['expectedIssuesReviewed']}/{full['expectedIssues']} → "
                f"{screened['expectedIssuesReviewed']}/{screened['expectedIssues']} ({coverage_delta:+d})"
            )
            lines.append(
                f"> **{REVIEWERS[reviewer]} difference:** {percent(scope_reduction)} less expensive-review scope; "
                f"issue coverage {coverage_text}; actionable quality "
                f"{percent(quality_rate(full), 0)} → {percent(quality_rate(screened), 0)} "
                f"({quality_delta * 100:+.0f} points); **{speedup:.2f}× faster** "
                f"({percent(time_reduction)} less time); **{percent(cost_reduction)} cheaper**."
            )
        lines.append("")

    lines.extend([
        "## Jev screening diagnostics",
        "",
        "| N | Decisions screened | Candidates | Final status | Expected issue recall | Extra candidates | Fraction routed | Time | Cost |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for count, source in sorted(sources.items()):
        metrics = source["evaluators"]["neuralint"]["metrics"]
        lines.append(
            f"| {count} | {metrics['reviewedRulePrPairs']} | "
            f"{metrics['candidateTruePositive'] + metrics['candidateFalsePositive']} | "
            f"{metrics['confirmedTruePositive']} V / "
            f"{metrics['candidateTruePositive'] - metrics['confirmedTruePositive']} I | "
            f"{metrics['candidateTruePositive']}/{metrics['expectedFindings']} | "
            f"{metrics['candidateFalsePositive']} | {percent(metrics['candidateRate'])} | "
            f"{seconds(metrics['latencyMs'])} | {money(metrics['costUsd'])} |"
        )

    failed = [workflow for workflow in workflows if not workflow["quality100"]]
    lines.extend([
        "",
        "## Workflows that did not pass the 100% quality gate",
        "",
        "| N | Reviewer | Workflow | Actionable | Material errors | Why excluded |",
        "|---:|---|---|---:|---:|---|",
    ])
    reviews = quality["reviews"]
    for workflow in sorted(failed, key=lambda item: (item["catalogSize"], item["reviewer"], item["workflow"])):
        failures = [
            review for review in reviews
            if review["catalogSize"] == workflow["catalogSize"]
            and review["reviewer"] == workflow["reviewer"]
            and review["workflow"] == workflow["workflow"]
            and not review["actionable"]
        ]
        reasons = "; ".join(
            f"`{failure['caseId']}`: {failure['rationale']}" for failure in failures
        ).replace("|", "\\|")
        missing = workflow["expectedIssues"] - workflow["expectedIssuesReviewed"]
        if missing > 0:
            missing_reason = f"Missing {missing} expected review{'s' if missing != 1 else ''}."
            reasons = f"{missing_reason} {reasons}".strip()
        lines.append(
            f"| {workflow['catalogSize']} | {REVIEWERS[workflow['reviewer']]} | "
            f"{WORKFLOWS[workflow['workflow']]} | {workflow['groundedActionable']}/{workflow['reviews']} | "
            f"{workflow['materialErrors']}/{workflow['reviews']} | {reasons} |"
        )

    judge_cost = sum(call["costUsd"] for call in quality["calls"])
    judge_time = sum(call["latencyMs"] for call in quality["calls"])
    adjudication_cost = sum(call["costUsd"] for call in quality["adjudication"]["calls"])
    adjudication_time = sum(call["latencyMs"] for call in quality["adjudication"]["calls"])
    lines.extend([
        "",
        "## Models and methodology",
        "",
        "| Role | Model | Configuration |",
        "|---|---|---|",
        "| Full/focused reviewer | GPT-5.6 Terra | low thinking, Pi repository read/bash tools |",
        "| Full/focused reviewer | GPT-5.6 Luna | low thinking, Pi repository read/bash tools |",
        "| Full/focused reviewer | Claude Sonnet 5 | low effort, Claude CLI safe mode with Read/Bash tools |",
        "| Full/focused reviewer | Claude Haiku 4.5 | low effort, Claude CLI safe mode with Read/Bash tools |",
        "| Quality judge | GPT-5.6 Sol | high thinking; blinded context-free pass, then repository-aware adjudication |",
        "| Screening router | TypeSafe AI Jev | current `jev-latest` endpoint |",
        "",
        f"The quality judge evaluated {len(quality['reviews'])} reviews in {len(quality['calls'])} blinded batches. "
        f"The initial judge had no tools; {quality['adjudication']['disputedReviews']} non-passing reviews then received repository-aware adjudication against the pinned checkout. "
        f"Initial judge overhead was {seconds(judge_time)} and {money(judge_cost)}; repository-aware adjudication added {seconds(adjudication_time)} and {money(adjudication_cost)}. Both are excluded from production workflow time and cost.",
        "",
        "Each catalog contains all five target policies. The remaining policies are a deterministic, nested sample "
        "from the same frozen 54-rule official catalog. Rule order is independently shuffled at each N. The same "
        "Jev candidates are handed to all four reviewers within a run. Screened reviewers must draft every candidate "
        "without rejecting or suppressing it.",
        "",
        "## Limitations",
        "",
        "- This is one run per N, so latency, cost, and model-output variance are not yet estimated.",
        "- All five PRs are generated regressions and every PR is positive; there are no clean-PR controls.",
        "- The suite covers one Home Assistant integration and five relatively localized policy failures.",
        "- The quality judge is in the same provider family as Terra and Luna; human or cross-provider calibration remains necessary.",
        "- A 100% result means five of five reviews in this fixture, not a population-level reliability estimate.",
        "",
        "## Reproduce",
        "",
        "```sh",
        "direnv exec . python benchmark/scaling/run.py",
        "direnv exec . python benchmark/scaling/judge.py",
        "direnv exec . python benchmark/scaling/adjudicate.py",
        "python benchmark/scaling/report.py",
        "```",
        "",
    ])
    OUTPUT.write_text("\n".join(lines))
    print(OUTPUT)


if __name__ == "__main__":
    main()
