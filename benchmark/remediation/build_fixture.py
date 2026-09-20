#!/usr/bin/env python3
"""Build the blinded remediation-quality fixture from a preserved pilot run."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SUITE = Path(__file__).resolve().parent
RESULT = SUITE / "results/pilot.json"
SOURCE = ROOT / "benchmark/quality/fixtures/home-assistant-54.json"
OUTPUT = SUITE / "fixtures/pilot.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def comment(policy: dict[str, Any], review: dict[str, Any]) -> str:
    return "\n".join([
        f"{policy['title']} ({review['ruleId']})",
        "",
        review["summary"],
        "",
        f"Impact: {review['impact']}",
        "",
        "Evidence:",
        *(f"- {line}" for line in review["evidence"]),
        "",
        "Suggested remediation:",
        review["remediation"],
        "",
        "Validation:",
        *(f"- {item}" for item in review["validation"]),
    ])


def main() -> None:
    result = json.loads(RESULT.read_text())
    source = json.loads(SOURCE.read_text())
    result_by_id = {case["id"]: case for case in result["results"]}
    cases = []
    for source_case in source["cases"]:
        observed = result_by_id[source_case["id"]]
        reviews = []
        for workflow, arm in (("direct", "direct"), ("routed", "goldHandoff")):
            output = observed[arm]["output"]
            matching = [
                review for review in output["reviews"]
                if review["ruleId"] == source_case["groundTruth"]["ruleId"]
                and review["path"] == source_case["groundTruth"]["path"]
            ]
            if len(matching) != 1:
                raise RuntimeError(
                    f"{source_case['id']} {arm}: expected one matching review, found {len(matching)}"
                )
            review = matching[0]
            reviews.append({
                "id": f"{source_case['id']}:{workflow}",
                "workflow": workflow,
                "model": result["model"],
                "thinking": result["thinking"],
                "status": "violation",
                "explanation": f"{review['summary']}\n\n{review['impact']}",
                "evidence": review["evidence"],
                "suggestion": review["remediation"],
                "validation": review["validation"],
                "comment": comment(source_case["policy"], review),
            })
        cases.append({
            "id": source_case["id"],
            "title": source_case["title"],
            "patch": source_case["patch"],
            "groundTruth": source_case["groundTruth"],
            "policy": source_case["policy"],
            "evidence": source_case["evidence"],
            "reviews": reviews,
        })

    fixture = {
        "schemaVersion": 1,
        "source": {
            "result": str(RESULT.relative_to(ROOT)),
            "sha256": digest(RESULT),
            "referenceFixture": str(SOURCE.relative_to(ROOT)),
            "referenceSha256": digest(SOURCE),
            "repository": result["repository"],
        },
        "cases": cases,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"Wrote {OUTPUT}: {len(cases)} cases, {len(cases) * 2} reviews")


if __name__ == "__main__":
    main()
