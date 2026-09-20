#!/usr/bin/env python3
"""Run nested Home Assistant catalog sizes through all configured reviewers."""

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
RESULTS = SUITE / "results/scaling"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--counts", default="10,25,54")
    parser.add_argument("--seed", type=int, default=20260919)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def load_rule(path: Path) -> dict[str, Any]:
    source = "\n".join(line for line in path.read_text().splitlines() if not line.lstrip().startswith("#"))
    value = json.loads(source)
    if not isinstance(value, dict) or not isinstance(value.get("id"), str):
        raise ValueError(f"Invalid rule file: {path}")
    return value


def expected_rule_ids() -> set[str]:
    ids = set()
    for line in (SUITE / "benchmark.yaml").read_text().splitlines():
        stripped = line.strip().removeprefix("- ")
        if stripped.startswith("ruleId:"):
            ids.add(stripped.split(":", 1)[1].strip())
    if not ids:
        raise ValueError("No expected rule IDs found")
    return ids


def run_catalog(count: int, seed: int, selected: list[tuple[Path, dict[str, Any]]], force: bool) -> None:
    output = RESULTS / f"airgradient-n{count}-seed{seed}.json"
    if output.exists() and not force:
        print(f"skip existing {output}")
        return
    with tempfile.TemporaryDirectory(prefix=f"neuralint-ha-n{count}-") as temporary:
        suite = Path(temporary)
        shutil.copy2(SUITE / "benchmark.yaml", suite / "benchmark.yaml")
        shutil.copy2(SUITE / "competitors.yaml", suite / "competitors.yaml")
        shutil.copytree(SUITE / "patches", suite / "patches")
        rules = suite / "rules"
        rules.mkdir()
        ordered = list(selected)
        random.Random(seed + count).shuffle(ordered)
        for index, (source, _) in enumerate(ordered):
            shutil.copy2(source, rules / f"{index:03d}-{source.name}")

        print(f"run N={count}: {len(ordered)} rules", flush=True)
        completed = subprocess.run(
            [
                "pnpm",
                "tsx",
                "benchmark/realistic/Run.ts",
                "--suite",
                str(suite),
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"N={count} benchmark exited {completed.returncode}")
        report = json.loads(completed.stdout)
        report["experiment"] = {
            "kind": "nested-catalog-scaling",
            "catalogSize": count,
            "catalogSeed": seed,
            "ruleOrder": [rule["id"] for _, rule in ordered],
        }
        RESULTS.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(f"wrote {output}", flush=True)


def main() -> None:
    args = parse_args()
    counts = [int(value) for value in args.counts.split(",")]
    rule_files = sorted((SUITE / "rules").glob("*.yaml"))
    catalog = [(path, load_rule(path)) for path in rule_files]
    expected = expected_rule_ids()
    targets = [(path, rule) for path, rule in catalog if rule["id"] in expected]
    distractors = [(path, rule) for path, rule in catalog if rule["id"] not in expected]
    if len(targets) != len(expected):
        raise ValueError(f"Expected {len(expected)} target rules, found {len(targets)}")
    random.Random(args.seed).shuffle(distractors)
    nested = targets + distractors
    for count in counts:
        if count < len(targets) or count > len(nested):
            raise ValueError(f"Catalog size {count} must be between {len(targets)} and {len(nested)}")
        run_catalog(count, args.seed, nested[:count], args.force)


if __name__ == "__main__":
    main()
