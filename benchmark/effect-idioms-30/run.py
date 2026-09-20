#!/usr/bin/env python3
"""Run the 30 source-backed Effect idiom rules against synthetic diffs."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SUITE = Path(__file__).resolve().parent
FIXTURES = SUITE / "fixtures.json"
RULES = SUITE / "rules"
OUTPUT = SUITE / "results/jev.json"
CLI = ROOT / "dist/Main.js"
JEV_INPUT_USD_PER_MILLION = 0.042


def command(args: list[str], cwd: Path, valid: set[int] = {0}) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)
    if result.returncode not in valid:
        raise RuntimeError(f"{' '.join(args)} exited {result.returncode}\n{result.stdout}\n{result.stderr}")
    return result


def save(results: list[dict[str, Any]], complete: bool) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "experiment": {
            "catalog": "30 source-backed Effect v4 semantic guidance rules",
            "rules": 30,
            "positiveScenarios": 30,
            "cleanScenarios": 5,
            "complete": complete,
            "costNote": "Jev input estimated at $0.042/MTok with free output",
        },
        "results": results,
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> None:
    fixtures = json.loads(FIXTURES.read_text())["cases"]
    if not CLI.exists():
        command(["pnpm", "build"], ROOT)
    results: list[dict[str, Any]] = []
    for index, case in enumerate(fixtures, 1):
        print(f"[{index}/{len(fixtures)}] {case['id']}", flush=True)
        with tempfile.TemporaryDirectory(prefix=f"neuralint-effect30-{case['id']}-") as directory:
            checkout = Path(directory)
            command(["git", "init", "--quiet", "--initial-branch=main"], checkout)
            command(["git", "config", "user.name", "neuralint Benchmark"], checkout)
            command(["git", "config", "user.email", "benchmark@neuralint.local"], checkout)
            path = checkout / case["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(case["before"])
            command(["git", "add", "-A"], checkout)
            command(["git", "commit", "--quiet", "-m", "Base fixture"], checkout)
            base = command(["git", "rev-parse", "HEAD"], checkout).stdout.strip()
            path.write_text(case["after"])
            command(["git", "add", "-A"], checkout)
            command(["git", "commit", "--quiet", "-m", case["title"]], checkout)
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
            expected = {(item["ruleId"], item["path"]) for item in case["expected"]}
            observed = {(item["ruleId"], item["path"]) for item in report["findings"]}
            results.append({
                "id": case["id"],
                "title": case["title"],
                "path": case["path"],
                "expected": case["expected"],
                "diff": diff,
                "report": report,
                "evaluation": {
                    "primaryRetained": len(expected & observed),
                    "primaryMissed": len(expected - observed),
                    "unanticipatedUnique": len(observed - expected),
                    "missed": [{"ruleId": rule, "path": path} for rule, path in sorted(expected - observed)],
                    "unanticipated": [{"ruleId": rule, "path": path} for rule, path in sorted(observed - expected)],
                    "latencyMs": latency_ms,
                    "costUsd": report["usage"]["inputTokens"] / 1_000_000 * JEV_INPUT_USD_PER_MILLION,
                },
            })
            save(results, False)
    save(results, True)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
