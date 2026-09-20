#!/usr/bin/env python3
"""Run one PR-shaped 30-file diff against the complete 30-rule catalog."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = Path(__file__).resolve().parent
FIXTURES = SUITE / "fixtures.json"
RULES = SUITE / "rules"
OUTPUT = SUITE / "results/pr-30-files-production-matrix.json"
CLI = ROOT / "dist/Main.js"
JEV_INPUT_USD_PER_MILLION = 0.042


def command(args: list[str], cwd: Path, valid: set[int] = {0}) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)
    if result.returncode not in valid:
        raise RuntimeError(f"{' '.join(args)} exited {result.returncode}\n{result.stdout}\n{result.stderr}")
    return result


def main() -> None:
    cases = [case for case in json.loads(FIXTURES.read_text())["cases"] if case["expected"]]
    if len(cases) != 30:
        raise RuntimeError(f"Expected 30 positive fixtures, found {len(cases)}")
    with tempfile.TemporaryDirectory(prefix="neuralint-effect30-pr-") as directory:
        checkout = Path(directory)
        command(["git", "init", "--quiet", "--initial-branch=main"], checkout)
        command(["git", "config", "user.name", "neuralint Benchmark"], checkout)
        command(["git", "config", "user.email", "benchmark@neuralint.local"], checkout)
        paths: dict[str, str] = {}
        for index, case in enumerate(cases, 1):
            relative = f"src/changes/{index:02d}-{case['id']}.ts"
            paths[case["id"]] = relative
            path = checkout / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(case["before"])
        command(["git", "add", "-A"], checkout)
        command(["git", "commit", "--quiet", "-m", "Base Effect application"], checkout)
        base = command(["git", "rev-parse", "HEAD"], checkout).stdout.strip()
        for case in cases:
            (checkout / paths[case["id"]]).write_text(case["after"])
        command(["git", "add", "-A"], checkout)
        command(["git", "commit", "--quiet", "-m", "Implement thirty application changes"], checkout)
        shutil.copytree(RULES, checkout / ".neuralint/rules")
        diff = command(["git", "diff", "--unified=8", base, "HEAD"], checkout).stdout
        started = time.monotonic()
        evaluated = command([
            "node", str(CLI), "check", "--root", str(checkout), "--base", base,
            "--format", "json", "--context", "8", "--max-state-chars", "24000",
        ], ROOT, {0, 1, 2})
        latency_ms = round((time.monotonic() - started) * 1000)
        try:
            report = json.loads(evaluated.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"neuralint returned non-JSON output\n{evaluated.stdout}\n{evaluated.stderr}") from error
        expected = {(case["expected"][0]["ruleId"], paths[case["id"]]) for case in cases}
        observed = {(finding["ruleId"], finding["path"]) for finding in report["findings"]}
        primary = []
        for case in cases:
            rule_id = case["expected"][0]["ruleId"]
            path = paths[case["id"]]
            findings = [finding for finding in report["findings"] if finding["ruleId"] == rule_id and finding["path"] == path]
            primary.append({
                "caseId": case["id"],
                "title": case["title"],
                "ruleId": rule_id,
                "path": path,
                "retained": bool(findings),
                "status": findings[0]["status"] if findings else "missed",
                "screeningProbability": findings[0]["screeningProbability"] if findings else None,
                "violationProbability": findings[0]["violationProbability"] if findings else None,
            })
        payload = {
            "schemaVersion": 1,
            "experiment": {
                "kind": "single-pr-shaped-diff",
                "changedFiles": 30,
                "rules": 30,
                "ruleFilePairs": 900,
                "synthetic": True,
            },
            "metrics": {
                "primaryRetained": len(expected & observed),
                "primaryMissed": len(expected - observed),
                "primaryDefinitive": sum(item["status"] == "violation" for item in primary),
                "primaryInconclusive": sum(item["status"] == "inconclusive" for item in primary),
                "unanticipatedUnique": len(observed - expected),
                "findings": len(report["findings"]),
                "definitiveFindings": sum(finding["status"] == "violation" for finding in report["findings"]),
                "inconclusiveFindings": sum(finding["status"] == "inconclusive" for finding in report["findings"]),
                "latencyMs": latency_ms,
                "requests": report["usage"]["requests"],
                "inputTokens": report["usage"]["inputTokens"],
                "outputTokens": report["usage"]["outputTokens"],
                "costUsd": report["usage"]["inputTokens"] / 1_000_000 * JEV_INPUT_USD_PER_MILLION,
            },
            "primary": primary,
            "diff": diff,
            "report": report,
        }
        OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")
        print(json.dumps(payload["metrics"], indent=2))
        print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
