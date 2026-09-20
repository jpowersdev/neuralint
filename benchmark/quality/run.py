#!/usr/bin/env python3
"""Run blinded review-quality judging against a frozen fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = ROOT / "benchmark/quality/fixtures/home-assistant-54.json"
DEFAULT_CONTROLS = ROOT / "benchmark/quality/adversarial/home-assistant-54.json"
DEFAULT_MODEL = "openai-codex/gpt-5.6-sol"
DEFAULT_THINKING = "high"
DEFAULT_SEED = 20260919

SYSTEM = """You are an independent code-review quality evaluator. Measure information sufficiency and grounded correctness, not writing quality. Ignore grammar, tone, polish, eloquence, formatting, verbosity, and concision except where wording prevents reliable understanding. Evaluate only the supplied material. Do not infer that longer text is better."""

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

ABSOLUTE_SCHEMA = """{"results":[{"reviewId":string,"invariantIdentifiable":boolean,"locationIdentifiable":boolean,"impactIdentifiable":boolean,"remediationUnderstandable":boolean,"remediationAppropriate":boolean,"evidenceGrounded":boolean,"materialError":boolean,"unsafeRemediation":boolean,"extractedInvariant":string,"extractedLocation":string,"extractedImpact":string,"extractedRemediation":string,"rationale":string}]}"""

RUBRIC = """Definitions:
- invariantIdentifiable: the violated requirement is concretely understandable, not merely named.
- locationIdentifiable: the affected repository path and changed construct are identifiable. Contradictory or fabricated locations are false.
- impactIdentifiable: a concrete consequence or engineering significance is understandable.
- remediationUnderstandable: a corrective direction is understandable.
- remediationAppropriate: the suggestion would address the supplied policy violation and does not contradict the diff. Missing remediation is false.
- evidenceGrounded: cited evidence corresponds to the supplied diff and supports the central claim. Missing or fabricated evidence is false.
- materialError: a factual error or unsupported assertion that could materially mislead the reviewer. Minor imprecision or plausible nonessential detail is not material.
- unsafeRemediation: following the suggestion would introduce a clear safety, correctness, or policy problem."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("quality", "adversarial"), default="quality")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--controls", type=Path, default=DEFAULT_CONTROLS)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--thinking", default=DEFAULT_THINKING)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def digest(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def opaque(prefix: str, value: str) -> str:
    return f"{prefix}-{digest(value)[:12]}"


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def extract_json(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError(f"Judge did not return JSON: {text}")
    value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("Judge output must be a JSON object")
    return value


def run_pi(prompt: str, model: str, thinking: str) -> tuple[dict[str, Any], dict[str, Any]]:
    started = time.monotonic()
    completed = subprocess.run(
        [
            "pi",
            "--mode", "json",
            "--print",
            "--no-session",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-context-files",
            "--no-tools",
            "--approve",
            "--model", model,
            "--thinking", thinking,
            prompt,
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=900,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"pi exited {completed.returncode}: {completed.stderr.strip()}")
    final: dict[str, Any] | None = None
    for line in completed.stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant":
            final = event["message"]
    if final is None:
        raise RuntimeError("pi emitted no final assistant response")
    text = "".join(
        part.get("text", "")
        for part in final.get("content", [])
        if part.get("type") == "text"
    )
    usage = final.get("usage", {})
    metrics = {
        "latencyMs": round((time.monotonic() - started) * 1000),
        "inputTokens": usage.get("input", 0),
        "outputTokens": usage.get("output", 0),
        "costUsd": usage.get("cost", {}).get("total"),
        "promptSha256": digest(prompt),
    }
    return extract_json(text), metrics


def validate_results(output: dict[str, Any], expected_ids: set[str]) -> list[dict[str, Any]]:
    results = output.get("results")
    if not isinstance(results, list):
        raise ValueError("Judge output has no results array")
    ids = {result.get("reviewId", result.get("caseId")) for result in results}
    if ids != expected_ids:
        raise ValueError(f"Judge IDs differ: expected {expected_ids}, received {ids}")
    return results


def reference(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "policy": case["policy"],
        "knownViolatingDiff": case["evidence"]["diff"],
        "expectedPath": case["groundTruth"]["path"],
    }


def presented(case: dict[str, Any], comment: str) -> str:
    return f"Location: {case['groundTruth']['path']}\n{comment}"


def derive(score: dict[str, Any]) -> None:
    score["informationSufficient"] = all(
        score[field]
        for field in (
            "invariantIdentifiable",
            "locationIdentifiable",
            "impactIdentifiable",
            "remediationUnderstandable",
        )
    )
    score["actionable"] = (
        score["informationSufficient"]
        and score["remediationAppropriate"]
        and score["evidenceGrounded"]
        and not score["materialError"]
        and not score["unsafeRemediation"]
    )


def absolute_prompt(payload: list[dict[str, Any]], calibration: bool = False) -> str:
    qualification = (
        "These include calibration controls and may be incomplete or wrong."
        if calibration
        else "The reference identifies a known policy violation. Do not compare reviews."
    )
    return f"""{SYSTEM}

Score each review independently. {qualification} Determine whether the review itself gives a human or agent enough correct information to understand and act. The displayed Location line is part of the review, but naming only a file without the changed construct is insufficient.

{RUBRIC}

Return only JSON with exactly one result per review:
{ABSOLUTE_SCHEMA}

Inputs:
{json.dumps(payload, indent=2)}"""


def run_absolute_batches(
    fixture: dict[str, Any], model: str, thinking: str, seed: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    all_reviews = {
        review["id"]: (case, review)
        for case in fixture["cases"]
        for review in case["reviews"]
    }
    batches: list[list[tuple[dict[str, Any], dict[str, Any]]]] = [[], []]
    for case in fixture["cases"]:
        offset = int(digest(case["id"]), 16) % 2
        batches[0].append(all_reviews[case["reviews"][offset]["id"]])
        batches[1].append(all_reviews[case["reviews"][1 - offset]["id"]])
    for index, batch in enumerate(batches):
        random.Random(seed + index).shuffle(batch)

    scores: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    identity: dict[str, dict[str, str]] = {}
    for index, batch in enumerate(batches):
        payload = []
        for case, review in batch:
            review_id = opaque("R", review["id"])
            identity[review_id] = {
                "reviewId": review["id"],
                "workflow": review["workflow"],
                "caseId": case["id"],
            }
            payload.append({
                "reviewId": review_id,
                "reference": reference(case),
                "reviewAsPresented": presented(case, review["comment"]),
            })
        prompt = absolute_prompt(payload)
        output, usage = run_pi(prompt, model, thinking)
        batch_scores = validate_results(output, {item["reviewId"] for item in payload})
        calls.append({"kind": "absolute", "batch": index + 1, **usage})
        scores.extend(batch_scores)
        print(f"absolute batch {index + 1}: {usage}", flush=True)

    for score in scores:
        score.update(identity[score["reviewId"]])
        derive(score)
    return scores, calls


def run_pairwise(
    fixture: dict[str, Any], model: str, thinking: str, seed: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    passes: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    cases_by_opaque = {opaque("C", case["id"]): case for case in fixture["cases"]}
    for pass_index in range(2):
        cases = list(fixture["cases"])
        random.Random(seed + 10 + pass_index).shuffle(cases)
        payload = []
        order: dict[str, tuple[str, str]] = {}
        for case in cases:
            first_direct = int(digest(case["id"]), 16) % 2 == 0
            if pass_index == 1:
                first_direct = not first_direct
            a_workflow = "direct" if first_direct else "routed"
            b_workflow = "routed" if first_direct else "direct"
            a = next(review for review in case["reviews"] if review["workflow"] == a_workflow)
            b = next(review for review in case["reviews"] if review["workflow"] == b_workflow)
            case_id = opaque("C", case["id"])
            order[case_id] = (a_workflow, b_workflow)
            payload.append({
                "caseId": case_id,
                "reference": reference(case),
                "reviewA": presented(case, a["comment"]),
                "reviewB": presented(case, b["comment"]),
            })
        prompt = f"""{SYSTEM}

Compare A and B for each case. Prefer only material differences in the ability to identify the violated invariant, location, impact, grounded evidence, and appropriate remediation. Do not prefer a review for being longer, more detailed, better formatted, more polished, or more confident when both are sufficient. Choose tie when both are usable and no material information-quality difference exists. Choose neither when neither is usable.

Return only JSON with exactly one result per case:
{{"results":[{{"caseId":string,"aUsable":boolean,"bUsable":boolean,"preference":"A"|"B"|"tie"|"neither","materialDifference":string,"rationale":string}}]}}

Inputs:
{json.dumps(payload, indent=2)}"""
        output, usage = run_pi(prompt, model, thinking)
        scores = validate_results(output, {item["caseId"] for item in payload})
        calls.append({
            "kind": "pairwise",
            "pass": pass_index + 1,
            "order": "initial" if pass_index == 0 else "reversed",
            **usage,
        })
        for score in scores:
            opaque_id = score["caseId"]
            score["caseId"] = cases_by_opaque[opaque_id]["id"]
            score["aWorkflow"], score["bWorkflow"] = order[opaque_id]
            preference = score["preference"]
            score["preferredWorkflow"] = (
                preference.lower()
                if preference in ("tie", "neither")
                else score["aWorkflow"] if preference == "A" else score["bWorkflow"]
            )
        passes.append({
            "pass": pass_index + 1,
            "order": "initial" if pass_index == 0 else "reversed",
            "results": scores,
        })
        print(f"pairwise pass {pass_index + 1}: {usage}", flush=True)
    return passes, calls


def quality_summary(
    fixture: dict[str, Any], absolute: list[dict[str, Any]], pairwise: list[dict[str, Any]]
) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    positive_fields = FIELDS[:6] + ["informationSufficient", "actionable"]
    for workflow in ("direct", "routed"):
        scores = [score for score in absolute if score["workflow"] == workflow]
        summary[workflow] = {
            field: sum(bool(score[field]) for score in scores) / len(scores)
            for field in positive_fields
        }
        summary[workflow]["materialErrorRate"] = sum(score["materialError"] for score in scores) / len(scores)
        summary[workflow]["unsafeRemediationRate"] = sum(score["unsafeRemediation"] for score in scores) / len(scores)
    all_pairs = [score for judged_pass in pairwise for score in judged_pass["results"]]
    summary["pairwise"] = {
        outcome: sum(score["preferredWorkflow"] == outcome for score in all_pairs)
        for outcome in ("direct", "routed", "tie", "neither")
    }
    summary["pairwiseByCase"] = {}
    for case in fixture["cases"]:
        scores = [score for score in all_pairs if score["caseId"] == case["id"]]
        preferences = [score["preferredWorkflow"] for score in scores]
        summary["pairwiseByCase"][case["id"]] = {
            "preferences": preferences,
            "orderStable": len(set(preferences)) == 1,
        }
    return summary


def run_quality(args: argparse.Namespace, fixture: dict[str, Any]) -> dict[str, Any]:
    absolute, absolute_calls = run_absolute_batches(fixture, args.model, args.thinking, args.seed)
    pairwise, pairwise_calls = run_pairwise(fixture, args.model, args.thinking, args.seed)
    return {
        "schemaVersion": 1,
        "fixture": str(args.fixture.relative_to(ROOT)),
        "fixtureSha256": digest(args.fixture.read_bytes()),
        "judge": {"model": args.model, "thinking": args.thinking, "seed": args.seed},
        "calls": absolute_calls + pairwise_calls,
        "summary": quality_summary(fixture, absolute, pairwise),
        "absolute": absolute,
        "pairwise": pairwise,
    }


def run_adversarial(
    args: argparse.Namespace, fixture: dict[str, Any], controls_fixture: dict[str, Any]
) -> dict[str, Any]:
    cases = {case["id"]: case for case in fixture["cases"]}
    reviews = {
        review["id"]: review
        for case in fixture["cases"]
        for review in case["reviews"]
    }
    payload = []
    expected: dict[str, dict[str, bool]] = {}
    for control in controls_fixture["controls"]:
        case = cases[control["caseId"]]
        comment = (
            reviews[control["sourceReviewId"]]["comment"]
            if "sourceReviewId" in control
            else control["comment"]
        )
        expected[control["id"]] = control["expected"]
        payload.append({
            "reviewId": control["id"],
            "reference": reference(case),
            "reviewAsPresented": presented(case, comment),
        })
    prompt = absolute_prompt(payload, calibration=True)
    output, usage = run_pi(prompt, args.model, args.thinking)
    scores = validate_results(output, set(expected))
    for score in scores:
        derive(score)
        score["expected"] = expected[score["reviewId"]]
        score["matches"] = {
            field: score[field] == value
            for field, value in score["expected"].items()
        }
    assertions = sum(len(score["matches"]) for score in scores)
    matched = sum(sum(score["matches"].values()) for score in scores)
    return {
        "schemaVersion": 1,
        "fixture": str(args.fixture.relative_to(ROOT)),
        "controls": str(args.controls.relative_to(ROOT)),
        "judge": {"model": args.model, "thinking": args.thinking},
        "usage": usage,
        "summary": {
            "assertions": assertions,
            "matched": matched,
            "agreement": matched / assertions,
            "controlsPassingAllAssertions": sum(all(score["matches"].values()) for score in scores),
            "controls": len(scores),
        },
        "results": scores,
    }


def main() -> None:
    args = parse_args()
    args.fixture = args.fixture.resolve()
    args.controls = args.controls.resolve()
    if args.output is not None:
        args.output = args.output.resolve()
    fixture = read_json(args.fixture)
    if args.mode == "quality":
        result = run_quality(args, fixture)
        default_name = "home-assistant-54-sol-high.json"
    else:
        result = run_adversarial(args, fixture, read_json(args.controls.resolve()))
        default_name = "home-assistant-54-sol-high-adversarial.json"
    output = (args.output or ROOT / "benchmark/quality/results" / default_name).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["summary"], indent=2))
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
