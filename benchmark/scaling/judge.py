#!/usr/bin/env python3
"""Blindly quality-judge all reviews from nested catalog scaling runs."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import random
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCALING_RESULTS = ROOT / "benchmark/home-assistant/results/scaling"
RULES = ROOT / "benchmark/home-assistant/rules"
OUTPUT = SCALING_RESULTS / "quality-sol-high.json"

spec = importlib.util.spec_from_file_location("quality_runner", ROOT / "benchmark/quality/run.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load quality runner")
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="openai-codex/gpt-5.6-sol")
    parser.add_argument("--thinking", default="high")
    parser.add_argument("--seed", type=int, default=20260919)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    return parser.parse_args()


def rule_catalog() -> dict[str, dict[str, Any]]:
    catalog = {}
    for path in RULES.glob("*.yaml"):
        source = "\n".join(line for line in path.read_text().splitlines() if not line.lstrip().startswith("#"))
        rule = json.loads(source)
        catalog[rule["id"]] = rule
    return catalog


def review_comment(policy: dict[str, Any], finding: dict[str, Any]) -> str:
    evidence = "\n".join(f"- {line}" for line in finding["evidence"])
    return (
        f"{policy['title']} ({finding['ruleId']})\n\n"
        f"{finding['explanation']}\n\n"
        f"Evidence:\n{evidence}\n\n"
        f"Suggested remediation:\n{finding['suggestion']}"
    )


def run_judge(prompt: str, model: str, thinking: str) -> tuple[dict[str, Any], dict[str, Any]]:
    last_error: Exception | None = None
    for _ in range(3):
        try:
            return quality.run_pi(prompt, model, thinking)
        except Exception as error:  # Judge output may occasionally be malformed.
            last_error = error
    raise RuntimeError(f"Judge failed after three attempts: {last_error}")


def main() -> None:
    args = parse_args()
    sources = [
        json.loads(path.read_text())
        for path in sorted(SCALING_RESULTS.glob("airgradient-n*-seed*.json"))
    ]
    if not sources:
        raise RuntimeError("No scaling results found")
    policies = rule_catalog()
    records = []
    identity: dict[str, dict[str, Any]] = {}

    for source in sources:
        count = source["rules"]
        for scenario in source["results"]:
            expected = scenario["expected"]
            if len(expected) != 1:
                raise ValueError(f"{scenario['id']} must have one expected finding")
            expected_finding = expected[0]
            policy = policies[expected_finding["ruleId"]]
            candidate = next(
                finding
                for finding in scenario["neuralint"]["findings"]
                if finding["ruleId"] == expected_finding["ruleId"]
                and finding["path"] == expected_finding["path"]
            )
            reference = {
                "policy": {
                    "id": policy["id"],
                    "title": policy["title"],
                    "description": policy["description"],
                    "instructions": policy["instructions"],
                    "violationCondition": policy["criteria"]["violation"],
                    "complianceCondition": policy["criteria"]["compliant"],
                },
                "knownViolatingDiff": "\n".join(candidate["evidence"]),
                "expectedPath": expected_finding["path"],
            }
            for section, workflow in (("competitors", "full-catalog"), ("handoffs", "screen-then-review")):
                for reviewer, evaluation in scenario[section].items():
                    for finding_index, finding in enumerate(evaluation["findings"]):
                        raw_id = f"n{count}:{reviewer}:{workflow}:{scenario['id']}:{finding_index}"
                        opaque_id = "R-" + hashlib.sha256(raw_id.encode()).hexdigest()[:12]
                        identity[opaque_id] = {
                            "reviewId": raw_id,
                            "catalogSize": count,
                            "reviewer": reviewer,
                            "workflow": workflow,
                            "caseId": scenario["id"],
                            "status": finding["status"],
                            "expected": finding["ruleId"] == expected_finding["ruleId"]
                            and finding["path"] == expected_finding["path"],
                        }
                        records.append({
                            "caseId": scenario["id"],
                            "reviewId": opaque_id,
                            "reference": reference,
                            "reviewAsPresented": (
                                f"Location: {finding['path']}\n"
                                f"{review_comment(policy, finding)}"
                            ),
                        })

    by_case: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        by_case.setdefault(record["caseId"], []).append(record)
    for index, values in enumerate(by_case.values()):
        random.Random(args.seed + index).shuffle(values)

    scores = []
    calls = []
    batch_count = max(len(values) for values in by_case.values())
    for batch_index in range(batch_count):
        payload = [
            {
                "reviewId": by_case[case_id][batch_index]["reviewId"],
                "reference": by_case[case_id][batch_index]["reference"],
                "reviewAsPresented": by_case[case_id][batch_index]["reviewAsPresented"],
            }
            for case_id in sorted(by_case)
            if batch_index < len(by_case[case_id])
        ]
        prompt = quality.absolute_prompt(payload)
        output, usage = run_judge(prompt, args.model, args.thinking)
        judged = quality.validate_results(output, {item["reviewId"] for item in payload})
        for score in judged:
            score.update(identity[score["reviewId"]])
            quality.derive(score)
        scores.extend(judged)
        calls.append({"batch": batch_index + 1, **usage})
        print(f"quality batch {batch_index + 1}/{batch_count}: {usage}", flush=True)

    workflows = []
    for source in sources:
        count = source["rules"]
        for section, workflow in (("competitors", "full-catalog"), ("handoffs", "screen-then-review")):
            for reviewer, evaluator in source["evaluators"][section].items():
                selected = [
                    score for score in scores
                    if score["catalogSize"] == count
                    and score["reviewer"] == reviewer
                    and score["workflow"] == workflow
                ]
                metrics = evaluator["metrics"]
                statuses = Counter(score["status"] for score in selected)
                all_information_complete = all(score["informationSufficient"] for score in selected)
                all_grounded_actionable = all(score["actionable"] for score in selected)
                no_material_errors = all(not score["materialError"] for score in selected)
                no_unsafe_remediation = all(not score["unsafeRemediation"] for score in selected)
                qualified = (
                    metrics["candidateRecall"] == 1
                    and metrics["candidateFalsePositive"] == 0
                    and len(selected) == metrics["candidateTruePositive"]
                    and all_information_complete
                    and all_grounded_actionable
                    and no_material_errors
                    and no_unsafe_remediation
                )
                workflows.append({
                    "catalogSize": count,
                    "reviewer": reviewer,
                    "model": evaluator.get("model", evaluator.get("drafter")),
                    "thinking": evaluator["thinking"],
                    "workflow": workflow,
                    "quality100": qualified,
                    "expectedIssuesReviewed": metrics["candidateTruePositive"],
                    "expectedIssues": metrics["expectedFindings"],
                    "extraReviews": metrics["candidateFalsePositive"],
                    "violations": statuses["violation"],
                    "inconclusive": statuses["inconclusive"],
                    "informationComplete": sum(score["informationSufficient"] for score in selected),
                    "groundedActionable": sum(score["actionable"] for score in selected),
                    "materialErrors": sum(score["materialError"] for score in selected),
                    "unsafeRemediation": sum(score["unsafeRemediation"] for score in selected),
                    "reviews": len(selected),
                    "latencyMs": metrics["latencyMs"],
                    "costUsd": metrics["costUsd"],
                    "inputTokens": metrics["inputTokens"],
                    "outputTokens": metrics["outputTokens"],
                    "requests": metrics["requests"],
                })

    result = {
        "schemaVersion": 1,
        "judge": {"model": args.model, "thinking": args.thinking, "seed": args.seed},
        "sourceResults": [str(path.relative_to(ROOT)) for path in sorted(SCALING_RESULTS.glob("airgradient-n*-seed*.json"))],
        "calls": calls,
        "workflows": workflows,
        "reviews": scores,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
