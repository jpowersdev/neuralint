#!/usr/bin/env python3
"""Run the five-repetition N=54 Sol/Opus reviewer series."""

from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SUITE = ROOT / "benchmark/home-assistant"
RESULTS = SUITE / "results/strong-reviewers-n54"
SEEDS = [20260919, 20260920, 20260921, 20260922, 20260923]

SOL = {
    "id": "sol-low",
    "kind": "pi",
    "model": "openai-codex/gpt-5.6-sol",
    "thinking": "low",
    "tools": ["read", "bash"],
}
OPUS = {
    "id": "opus-low",
    "kind": "claude",
    "model": "claude-opus-4-8",
    "thinking": "low",
    "tools": ["Read", "Bash"],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--repetitions", default="1,2,3,4,5")
    return parser.parse_args()


def load_rule(path: Path) -> dict[str, Any]:
    source = "\n".join(line for line in path.read_text().splitlines() if not line.lstrip().startswith("#"))
    value = json.loads(source)
    if not isinstance(value, dict) or not isinstance(value.get("id"), str):
        raise ValueError(f"Invalid rule file: {path}")
    return value


def run_repetition(repetition: int, force: bool) -> None:
    seed = SEEDS[repetition - 1]
    output = RESULTS / f"repetition-{repetition}-seed-{seed}.json"
    if output.exists() and not force:
        print(f"skip existing {output}")
        return

    catalog = [(path, load_rule(path)) for path in sorted((SUITE / "rules").glob("*.yaml"))]
    random.Random(seed).shuffle(catalog)
    reviewers = [SOL, OPUS] if repetition % 2 == 1 else [OPUS, SOL]
    handoff_first = repetition % 2 == 0

    with tempfile.TemporaryDirectory(prefix=f"neuralint-strong-r{repetition}-") as temporary:
        suite = Path(temporary)
        shutil.copy2(SUITE / "benchmark.yaml", suite / "benchmark.yaml")
        shutil.copytree(SUITE / "patches", suite / "patches")
        (suite / "competitors.yaml").write_text(json.dumps({
            "version": 1,
            "competitors": reviewers,
        }, indent=2))
        rules = suite / "rules"
        rules.mkdir()
        for index, (source, _) in enumerate(catalog):
            shutil.copy2(source, rules / f"{index:03d}-{source.name}")

        args = [
            "pnpm", "tsx", "benchmark/realistic/Run.ts", "--suite", str(suite)
        ]
        if handoff_first:
            args.append("--handoff-first")
        print(
            f"repetition {repetition}/5 seed={seed} reviewers={[item['id'] for item in reviewers]} "
            f"workflow={'handoff-first' if handoff_first else 'direct-first'}",
            flush=True,
        )
        completed = subprocess.run(
            args,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"Repetition {repetition} exited {completed.returncode}")
        report = json.loads(completed.stdout)
        report["experiment"] = {
            "kind": "strong-reviewers-n54",
            "repetition": repetition,
            "seed": seed,
            "reviewerOrder": [item["id"] for item in reviewers],
            "workflowOrder": "handoff-first" if handoff_first else "direct-first",
            "ruleOrder": [rule["id"] for _, rule in catalog],
        }
        RESULTS.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(f"wrote {output}", flush=True)


def main() -> None:
    args = parse_args()
    repetitions = [int(value) for value in args.repetitions.split(",")]
    for repetition in repetitions:
        if repetition < 1 or repetition > len(SEEDS):
            raise ValueError(f"Invalid repetition {repetition}")
        run_repetition(repetition, args.force)


if __name__ == "__main__":
    main()
