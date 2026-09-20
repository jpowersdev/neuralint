#!/usr/bin/env python3
"""Repository-aware Fable judging for the N=54 Sol/Opus series."""

from __future__ import annotations

import hashlib
import json
import random
import subprocess
import time
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "benchmark/home-assistant/results/strong-reviewers-n54"
RULES = ROOT / "benchmark/home-assistant/rules"
REPOSITORY = ROOT / "benchmark/.cache/home-assistant--core"
OUTPUT = RESULTS / "quality-fable-high.json"
MODEL = "claude-fable-5"
SEED = 20260919

FIELDS = [
    "invariantIdentifiable",
    "locationIdentifiable",
    "impactIdentifiable",
    "remediationUnderstandable",
    "remediationAppropriate",
    "evidenceGrounded",
    "materialError",
    "unsafeRemediation",
]

RESULT_PROPERTIES = {
    "reviewId": {"type": "string"},
    "invariantIdentifiable": {"type": "boolean"},
    "locationIdentifiable": {"type": "boolean"},
    "impactIdentifiable": {"type": "boolean"},
    "remediationUnderstandable": {"type": "boolean"},
    "remediationAppropriate": {"type": "boolean"},
    "evidenceGrounded": {"type": "boolean"},
    "materialError": {"type": "boolean"},
    "unsafeRemediation": {"type": "boolean"},
    "extractedInvariant": {"type": "string"},
    "extractedLocation": {"type": "string"},
    "extractedImpact": {"type": "string"},
    "extractedRemediation": {"type": "string"},
    "repositoryEvidence": {"type": "array", "items": {"type": "string"}},
    "rationale": {"type": "string"},
}
OUTPUT_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": RESULT_PROPERTIES,
                "required": list(RESULT_PROPERTIES),
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
})


def load_rules() -> dict[str, dict[str, Any]]:
    catalog = {}
    for path in RULES.glob("*.yaml"):
        source = "\n".join(line for line in path.read_text().splitlines() if not line.lstrip().startswith("#"))
        rule = json.loads(source)
        catalog[rule["id"]] = rule
    return catalog


def comment(policy: dict[str, Any], finding: dict[str, Any]) -> str:
    evidence = "\n".join(f"- {line}" for line in finding["evidence"])
    return (
        f"Location: {finding['path']}\n{policy['title']} ({finding['ruleId']})\n\n"
        f"{finding['explanation']}\n\nEvidence:\n{evidence}\n\n"
        f"Suggested remediation:\n{finding['suggestion']}"
    )


def run_fable(prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(1, 4):
        started = time.monotonic()
        completed = subprocess.run(
            [
                "claude", "--print", "--output-format", "json", "--safe-mode",
                "--setting-sources", "", "--disable-slash-commands",
                "--tools", "Read,Bash", "--allowedTools", "Read,Bash",
                "--permission-mode", "dontAsk",
                "--system-prompt",
                "Act as an independent repository-aware code-review quality evaluator. Use read-only tools, do not modify files or access the network, ignore writing style, and return exactly the requested structured data.",
                "--model", MODEL, "--effort", "high", "--json-schema", OUTPUT_SCHEMA,
                prompt,
            ],
            cwd=REPOSITORY,
            text=True,
            capture_output=True,
            timeout=900,
            check=False,
        )
        if completed.returncode != 0:
            last_error = RuntimeError(completed.stderr.strip())
            continue
        try:
            wrapper = json.loads(completed.stdout)
            output = wrapper["structured_output"]
            model_usage = wrapper.get("modelUsage", {}).values()
            usage = {
                "attempt": attempt,
                "latencyMs": round((time.monotonic() - started) * 1000),
                "inputTokens": sum(
                    item.get("inputTokens", 0)
                    + item.get("cacheReadInputTokens", 0)
                    + item.get("cacheCreationInputTokens", 0)
                    for item in model_usage
                ),
                "outputTokens": sum(item.get("outputTokens", 0) for item in wrapper.get("modelUsage", {}).values()),
                "costUsd": wrapper["total_cost_usd"],
            }
            return output, usage
        except Exception as error:
            last_error = error
    raise RuntimeError(f"Fable failed after three attempts: {last_error}")


def derive(score: dict[str, Any]) -> None:
    score["informationSufficient"] = all(
        score[field]
        for field in (
            "invariantIdentifiable", "locationIdentifiable", "impactIdentifiable", "remediationUnderstandable"
        )
    )
    score["actionable"] = (
        score["informationSufficient"]
        and score["remediationAppropriate"]
        and score["evidenceGrounded"]
        and not score["materialError"]
        and not score["unsafeRemediation"]
    )


def main() -> None:
    source_paths = sorted(RESULTS.glob("repetition-*-seed-*.json"))
    if len(source_paths) != 5:
        raise RuntimeError(f"Expected five repetitions, found {len(source_paths)}")
    sources = [json.loads(path.read_text()) for path in source_paths]
    policies = load_rules()
    records = []
    identity = {}

    for source in sources:
        repetition = source["experiment"]["repetition"]
        for scenario in source["results"]:
            expected = scenario["expected"][0]
            policy = policies[expected["ruleId"]]
            candidate = next(
                finding for finding in scenario["neuralint"]["findings"]
                if finding["ruleId"] == expected["ruleId"] and finding["path"] == expected["path"]
            )
            reference = {
                "policy": {
                    "title": policy["title"],
                    "instructions": policy["instructions"],
                    "violationCondition": policy["criteria"]["violation"],
                    "complianceCondition": policy["criteria"]["compliant"],
                },
                "knownViolatingDiff": "\n".join(candidate["evidence"]),
                "expectedPath": expected["path"],
            }
            for section, workflow in (("competitors", "full-catalog"), ("handoffs", "screen-then-review")):
                for reviewer, evaluation in scenario[section].items():
                    for finding_index, finding in enumerate(evaluation["findings"]):
                        raw_id = f"r{repetition}:{reviewer}:{workflow}:{scenario['id']}:{finding_index}"
                        review_id = "R-" + hashlib.sha256(raw_id.encode()).hexdigest()[:12]
                        identity[review_id] = {
                            "reviewId": raw_id,
                            "repetition": repetition,
                            "reviewer": reviewer,
                            "workflow": workflow,
                            "caseId": scenario["id"],
                            "status": finding["status"],
                            "expected": finding["ruleId"] == expected["ruleId"] and finding["path"] == expected["path"],
                        }
                        records.append({
                            "caseId": scenario["id"],
                            "reviewId": review_id,
                            "reference": reference,
                            "reviewAsPresented": comment(policy, finding),
                        })

    by_case: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        by_case.setdefault(record["caseId"], []).append(record)
    for index, values in enumerate(by_case.values()):
        random.Random(SEED + index).shuffle(values)
    batch_count = max(len(values) for values in by_case.values())
    scores = []
    calls = []

    rubric = """Score each review independently for information sufficiency and grounded correctness, not prose quality. The synthetic diff is supplied; the current working directory is the pinned base repository. Use read-only tools to verify context-derived claims. A factual claim can be grounded in repository context even when absent from the diff.

Definitions:
- invariantIdentifiable: the concrete violated requirement is understandable, not merely named.
- locationIdentifiable: the affected path and changed construct are identifiable.
- impactIdentifiable: a concrete consequence or engineering significance is understandable.
- remediationUnderstandable: a corrective direction is understandable.
- remediationAppropriate: at least one unambiguously recommended path fixes the policy violation and no proposed alternative materially undermines it.
- evidenceGrounded: decisive changed-line evidence is accurately quoted; additional repository context is allowed when factual.
- materialError: a demonstrably false or seriously misleading claim that could change understanding or remediation. Minor imprecision is not material.
- unsafeRemediation: following the recommendation creates a clear safety, correctness, or policy problem.

Return exactly one result for each review ID."""

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
        output, usage = run_fable(f"{rubric}\n\nInputs:\n{json.dumps(payload, indent=2)}")
        judged = output["results"]
        if {item["reviewId"] for item in judged} != {item["reviewId"] for item in payload}:
            raise RuntimeError(f"Fable IDs mismatch in batch {batch_index + 1}")
        for score in judged:
            score.update(identity[score["reviewId"]])
            derive(score)
        scores.extend(judged)
        calls.append({"batch": batch_index + 1, **usage})
        print(f"Fable batch {batch_index + 1}/{batch_count}: {usage}", flush=True)

    runs = []
    for source in sources:
        repetition = source["experiment"]["repetition"]
        for section, workflow in (("competitors", "full-catalog"), ("handoffs", "screen-then-review")):
            for reviewer, evaluator in source["evaluators"][section].items():
                selected = [
                    score for score in scores
                    if score["repetition"] == repetition
                    and score["reviewer"] == reviewer
                    and score["workflow"] == workflow
                ]
                metrics = evaluator["metrics"]
                statuses = Counter(score["status"] for score in selected)
                quality100 = (
                    metrics["candidateRecall"] == 1
                    and metrics["candidateFalsePositive"] == 0
                    and len(selected) == metrics["candidateTruePositive"]
                    and all(score["informationSufficient"] and score["actionable"] for score in selected)
                    and all(not score["materialError"] and not score["unsafeRemediation"] for score in selected)
                )
                runs.append({
                    "repetition": repetition,
                    "seed": source["experiment"]["seed"],
                    "reviewer": reviewer,
                    "model": evaluator.get("model", evaluator.get("drafter")),
                    "workflow": workflow,
                    "quality100": quality100,
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

    jev_runs = [
        {
            "repetition": source["experiment"]["repetition"],
            **source["evaluators"]["neuralint"]["metrics"],
        }
        for source in sources
    ]
    result = {
        "schemaVersion": 1,
        "judge": {"model": MODEL, "effort": "high", "repositoryAware": True, "seed": SEED},
        "sourceResults": [str(path.relative_to(ROOT)) for path in source_paths],
        "calls": calls,
        "jevRuns": jev_runs,
        "runs": runs,
        "reviews": scores,
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
