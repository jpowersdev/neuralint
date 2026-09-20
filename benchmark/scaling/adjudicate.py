#!/usr/bin/env python3
"""Repository-aware adjudication for reviews rejected by the context-free judge."""

from __future__ import annotations

import json
import subprocess
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "benchmark/home-assistant/results/scaling"
QUALITY = RESULTS / "quality-sol-high.json"
OUTPUT = RESULTS / "quality-sol-high-adjudicated.json"
REPOSITORY = ROOT / "benchmark/.cache/home-assistant--core"

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


def extract_final(stdout: str) -> tuple[dict[str, Any], dict[str, Any]]:
    final = None
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant":
            final = event["message"]
    if final is None:
        raise RuntimeError("pi emitted no final message")
    text = "".join(part.get("text", "") for part in final.get("content", []) if part.get("type") == "text")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise RuntimeError(f"No JSON in adjudication: {text}")
    usage = final.get("usage", {})
    return json.loads(text[start : end + 1]), {
        "inputTokens": usage.get("input", 0),
        "outputTokens": usage.get("output", 0),
        "costUsd": usage.get("cost", {}).get("total"),
    }


def run_pi(prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    started = time.monotonic()
    completed = subprocess.run(
        [
            "pi", "--mode", "json", "--print", "--no-session", "--no-extensions",
            "--no-skills", "--no-prompt-templates", "--no-context-files", "--approve",
            "--tools", "read,bash", "--model", "openai-codex/gpt-5.6-sol",
            "--thinking", "high", prompt,
        ],
        cwd=REPOSITORY,
        text=True,
        capture_output=True,
        timeout=900,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"pi failed: {completed.stderr}")
    output, usage = extract_final(completed.stdout)
    usage["latencyMs"] = round((time.monotonic() - started) * 1000)
    return output, usage


def rule_catalog() -> dict[str, dict[str, Any]]:
    rules = {}
    for path in (ROOT / "benchmark/home-assistant/rules").glob("*.yaml"):
        source = "\n".join(line for line in path.read_text().splitlines() if not line.lstrip().startswith("#"))
        rule = json.loads(source)
        rules[rule["id"]] = rule
    return rules


def comment(policy: dict[str, Any], finding: dict[str, Any]) -> str:
    evidence = "\n".join(f"- {line}" for line in finding["evidence"])
    return (
        f"Location: {finding['path']}\n{policy['title']} ({finding['ruleId']})\n\n"
        f"{finding['explanation']}\n\nEvidence:\n{evidence}\n\n"
        f"Suggested remediation:\n{finding['suggestion']}"
    )


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
    quality = json.loads(QUALITY.read_text())
    sources = {
        source["rules"]: source
        for source in (
            json.loads(path.read_text())
            for path in RESULTS.glob("airgradient-n*-seed*.json")
        )
    }
    policies = rule_catalog()
    disputed = [score for score in quality["reviews"] if not score["actionable"]]
    by_case: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for score in disputed:
        source = sources[score["catalogSize"]]
        scenario = next(result for result in source["results"] if result["id"] == score["caseId"])
        section = "competitors" if score["workflow"] == "full-catalog" else "handoffs"
        finding = scenario[section][score["reviewer"]]["findings"][0]
        expected = scenario["expected"][0]
        policy = policies[expected["ruleId"]]
        candidate = next(
            item for item in scenario["neuralint"]["findings"]
            if item["ruleId"] == expected["ruleId"] and item["path"] == expected["path"]
        )
        by_case[score["caseId"]].append({
            "reviewId": score["reviewId"],
            "catalogSize": score["catalogSize"],
            "reviewer": score["reviewer"],
            "workflow": score["workflow"],
            "policy": {
                "title": policy["title"],
                "instructions": policy["instructions"],
                "violationCondition": policy["criteria"]["violation"],
                "complianceCondition": policy["criteria"]["compliant"],
            },
            "knownViolatingDiff": "\n".join(candidate["evidence"]),
            "review": comment(policy, finding),
            "initialScore": {field: score[field] for field in FIELDS},
            "initialRationale": score["rationale"],
        })

    adjudications = []
    calls = []
    for case_id, reviews in sorted(by_case.items()):
        prompt = f"""Act as the repository-aware adjudicator for disputed code-review quality labels.

The current working directory is Home Assistant Core at the exact pinned base commit used by the benchmark. The synthetic diff is supplied with each review. Use read-only repository tools to verify factual claims against framework and integration source when needed. Do not modify files, install dependencies, or use the network.

The first judge had no repository tools and sometimes treated claims absent from the diff as false. Correct that error: a claim may be grounded in repository context even when it is not visible in the diff. Do not mark a statement erroneous merely because it required repository inspection.

Apply these standards:
- invariantIdentifiable: the concrete violated requirement is understandable.
- locationIdentifiable: the path and changed construct are identifiable.
- impactIdentifiable: a concrete consequence or engineering significance is understandable.
- remediationUnderstandable: a corrective direction is understandable.
- remediationAppropriate: at least one unambiguously recommended path fixes the violation, and no alternative recommendation materially undermines it.
- evidenceGrounded: decisive changed-line evidence is accurately quoted. Additional repository-context evidence is allowed if factual; fabricated lines, incorrect +/- direction, or evidence for the wrong change fails.
- materialError: only a demonstrably false or seriously misleading claim that could change understanding or remediation. Minor overstatement and valid repository-derived detail are not material.
- unsafeRemediation: following the recommendation creates a clear safety, correctness, or policy problem.

Re-score every field independently. Return only JSON:
{{"results":[{{"reviewId":string,"invariantIdentifiable":boolean,"locationIdentifiable":boolean,"impactIdentifiable":boolean,"remediationUnderstandable":boolean,"remediationAppropriate":boolean,"evidenceGrounded":boolean,"materialError":boolean,"unsafeRemediation":boolean,"repositoryEvidence":string[],"rationale":string}}]}}

Disputed reviews for scenario {case_id}:
{json.dumps(reviews, indent=2)}"""
        output, usage = run_pi(prompt)
        results = output.get("results", [])
        if {result.get("reviewId") for result in results} != {review["reviewId"] for review in reviews}:
            raise RuntimeError(f"Adjudication IDs mismatch for {case_id}")
        adjudications.extend(results)
        calls.append({"caseId": case_id, **usage})
        print(f"adjudicated {case_id}: {len(results)} reviews", flush=True)

    by_id = {result["reviewId"]: result for result in adjudications}
    for score in quality["reviews"]:
        adjudicated = by_id.get(score["reviewId"])
        if adjudicated is None:
            continue
        score["initialJudge"] = {field: score[field] for field in FIELDS} | {"rationale": score["rationale"]}
        for field in FIELDS:
            score[field] = adjudicated[field]
        score["rationale"] = adjudicated["rationale"]
        score["repositoryEvidence"] = adjudicated["repositoryEvidence"]
        derive(score)

    # Rebuild workflow quality aggregates while preserving discovery and resource metrics.
    for workflow in quality["workflows"]:
        selected = [
            score for score in quality["reviews"]
            if score["catalogSize"] == workflow["catalogSize"]
            and score["reviewer"] == workflow["reviewer"]
            and score["workflow"] == workflow["workflow"]
        ]
        workflow["informationComplete"] = sum(score["informationSufficient"] for score in selected)
        workflow["groundedActionable"] = sum(score["actionable"] for score in selected)
        workflow["materialErrors"] = sum(score["materialError"] for score in selected)
        workflow["unsafeRemediation"] = sum(score["unsafeRemediation"] for score in selected)
        workflow["quality100"] = (
            workflow["expectedIssuesReviewed"] == workflow["expectedIssues"]
            and workflow["extraReviews"] == 0
            and len(selected) == workflow["expectedIssuesReviewed"]
            and all(score["informationSufficient"] for score in selected)
            and all(score["actionable"] for score in selected)
            and all(not score["materialError"] for score in selected)
            and all(not score["unsafeRemediation"] for score in selected)
        )

    quality["schemaVersion"] = 2
    quality["adjudication"] = {
        "model": "openai-codex/gpt-5.6-sol",
        "thinking": "high",
        "repository": "home-assistant/core@40fcd7dc6b37781291745e3d6c39601563e87349",
        "disputedReviews": len(disputed),
        "calls": calls,
    }
    OUTPUT.write_text(json.dumps(quality, indent=2) + "\n")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
