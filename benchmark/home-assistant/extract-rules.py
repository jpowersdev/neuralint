#!/usr/bin/env python3
"""Generate neuralint rules from a pinned Home Assistant developer-docs checkout."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

DOCS_COMMIT = "17a7d242991cd7a22d11087acfe60545fa58ee49"
SOURCE_PREFIX = "https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/"


def section(source: str, name: str) -> str:
    match = re.search(rf"^## {re.escape(name)}\s*\n(.*?)(?=^## |\Z)", source, re.M | re.S)
    return match.group(1).strip() if match else ""


def plain_text(source: str) -> str:
    source = re.sub(r"```.*?```", " ", source, flags=re.S)
    source = re.sub(r":::.*?:::", " ", source, flags=re.S)
    source = re.sub(r"<[^>]+>", " ", source)
    source = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", source)
    source = re.sub(r"[`*_>#]+", "", source)
    return re.sub(r"\s+", " ", source).strip()


def generate(source_directory: Path, output_directory: Path) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    for generated_rule in output_directory.glob("*.yaml"):
        generated_rule.unlink()
    provenance: list[dict[str, str]] = []

    for path in sorted(source_directory.glob("*.md")):
        source = path.read_text()
        frontmatter = re.match(r"^---\n(.*?)\n---\n", source, re.S)
        if frontmatter is None:
            raise ValueError(f"missing frontmatter: {path}")
        title_match = re.search(r'^title:\s*["\']?(.*?)["\']?\s*$', frontmatter.group(1), re.M)
        if title_match is None:
            raise ValueError(f"missing title: {path}")

        slug = path.stem
        title = title_match.group(1)
        guidance = plain_text(section(source, "Reasoning"))
        exceptions = plain_text(section(source, "Exceptions"))
        sentences = re.split(r"(?<=[.!?])\s+", guidance)
        description = sentences[0] if sentences and sentences[0] else title
        instructions = (
            f'Evaluate the official Home Assistant Integration Quality Scale rule "{title}". '
            f"Official guidance: {guidance}"
        )
        if exceptions and exceptions.lower() not in {
            "there are no exceptions to this rule.",
            "there are no exceptions to this rule",
        }:
            instructions += f" Exceptions: {exceptions}"

        rule_id = "HA_IQS_" + slug.upper().replace("-", "_")
        source_url = SOURCE_PREFIX + slug
        rule = {
            "version": 1,
            "id": rule_id,
            "title": title,
            "description": description,
            "severity": "warning",
            "scope": {
                "include": ["homeassistant/components/**/*", "tests/components/**/*"],
                "exclude": [],
            },
            "instructions": instructions,
            "criteria": {
                "violation": (
                    "The change introduces or worsens a concrete failure to satisfy the "
                    f"integration requirement: {title}."
                ),
                "compliant": (
                    f'The change preserves the requirement "{title}", is unrelated to it, '
                    "or the integration is explicitly covered by an official exception."
                ),
            },
            "thresholds": {"screenAt": 0.35, "violationAt": 0.8},
        }
        (output_directory / f"{slug}.yaml").write_text(
            f"# Source: {source_url}\n" + json.dumps(rule, indent=2) + "\n"
        )
        provenance.append(
            {
                "id": rule_id,
                "slug": slug,
                "title": title,
                "source": source_url,
                "docsCommit": DOCS_COMMIT,
            }
        )

    if len(provenance) != 54:
        raise ValueError(f"expected 54 rules, generated {len(provenance)}")
    (output_directory.parent / "provenance.json").write_text(
        json.dumps({"schemaVersion": 1, "rules": provenance}, indent=2) + "\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "docs_checkout",
        type=Path,
        help="developers.home-assistant checkout pinned to the documented commit",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "rules",
    )
    args = parser.parse_args()
    source = args.docs_checkout / "docs/core/integration-quality-scale/rules"
    generate(source, args.output)


if __name__ == "__main__":
    main()
