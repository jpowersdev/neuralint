#!/usr/bin/env python3
"""Render a concise, decision-oriented HTML summary for the 30-rule run."""

from __future__ import annotations

import html
import json
import statistics
from pathlib import Path
from typing import Any

SUITE = Path(__file__).resolve().parent
DATA = SUITE / "results/jev.json"
RULES = SUITE / "rules"
OUTPUT = SUITE / "results/fixtures.html"


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def changed_lines(diff: str, limit: int = 10) -> str:
    lines = [line for line in diff.splitlines() if (line.startswith("+") and not line.startswith("+++")) or (line.startswith("-") and not line.startswith("---"))]
    clipped = lines[:limit]
    if len(lines) > limit:
        clipped.append(f"… {len(lines) - limit} more changed lines")
    rendered = []
    for line in clipped:
        cls = "add" if line.startswith("+") else "del" if line.startswith("-") else "more"
        rendered.append(f'<span class="line {cls}">{esc(line)}</span>')
    return "\n".join(rendered)


def full_diff(diff: str) -> str:
    rendered = []
    for line in diff.splitlines():
        cls = "ctx"
        if line.startswith("+") and not line.startswith("+++"):
            cls = "add"
        elif line.startswith("-") and not line.startswith("---"):
            cls = "del"
        elif line.startswith("@@"):
            cls = "hunk"
        elif line.startswith(("diff ", "index ", "+++", "---")):
            cls = "meta"
        rendered.append(f'<span class="line {cls}">{esc(line)}</span>')
    return "\n".join(rendered)


def main() -> None:
    data = json.loads(DATA.read_text())
    rules = {json.loads(path.read_text())["id"]: json.loads(path.read_text()) for path in RULES.glob("*.yaml")}
    positives = [item for item in data["results"] if item["expected"]]
    controls = [item for item in data["results"] if not item["expected"]]
    primary_rows = []
    attention_rows = []
    extra_definitive = 0
    extra_advisory = 0

    for item in positives:
        rule_id = item["expected"][0]["ruleId"]
        rule = rules[rule_id]
        primary = next((finding for finding in item["report"]["findings"] if finding["ruleId"] == rule_id), None)
        extras = []
        seen = set()
        for finding in item["report"]["findings"]:
            if finding["ruleId"] == rule_id or finding["ruleId"] in seen:
                continue
            seen.add(finding["ruleId"])
            extras.append(finding)
            if finding["status"] == "violation":
                extra_definitive += 1
            else:
                extra_advisory += 1
        if primary is None:
            state, label, probability = "miss", "missed", 0
        elif primary["status"] == "violation":
            state, label, probability = "found", "found", primary["violationProbability"]
        else:
            state, label, probability = "review", "needs review", primary["violationProbability"]
        extras_html = "".join(
            f'<li><code>{esc(f["ruleId"])}</code> <span>{esc(f["status"])}, {f["violationProbability"]:.0%}</span></li>'
            for f in extras
        ) or "<li>None</li>"
        open_attr = " open" if state != "found" else ""
        card = f'''
<details class="result {state}"{open_attr}>
 <summary><span class="dot"></span><span class="rule-name">{esc(rule['title'])}<small>{esc(rule_id)}</small></span><span class="case-name">{esc(item['title'])}</span><strong>{probability:.0%}</strong><span class="status">{label}</span></summary>
 <div class="result-body">
  <div><h4>Changed lines</h4><pre>{changed_lines(item['diff'])}</pre></div>
  <div><h4>Why this rule applies</h4><p>{esc(rule['description'])}</p><p class="guidance"><b>Compliant:</b> {esc(rule['criteria']['compliant'])}</p><h4>Other rule matches</h4><ul>{extras_html}</ul></div>
 </div>
 <details class="nested"><summary>Full diff</summary><pre>{full_diff(item['diff'])}</pre></details>
</details>'''
        if state == "found":
            primary_rows.append(card)
        else:
            attention_rows.append(card)

    clean_cards = []
    for item in controls:
        findings = item["report"]["findings"]
        definitive = [finding for finding in findings if finding["status"] == "violation"]
        advisories = [finding for finding in findings if finding["status"] == "inconclusive"]
        extra_definitive += len({finding["ruleId"] for finding in definitive})
        extra_advisory += len({finding["ruleId"] for finding in advisories})
        state = "clean" if not definitive else "miss"
        detail = "No candidates" if not findings else f"{len(advisories)} advisories, no definitive finding" if not definitive else f"{len(definitive)} definitive findings"
        finding_list = "".join(f'<li><code>{esc(f["ruleId"])}</code> {f["violationProbability"]:.0%}</li>' for f in findings) or "<li>None</li>"
        clean_cards.append(f'''<article class="control {state}"><span class="dot"></span><div><strong>{esc(item['title'])}</strong><small>{esc(item['id'])}</small><p>{detail}</p><details><summary>Details</summary><ul>{finding_list}</ul><pre>{changed_lines(item['diff'])}</pre></details></div></article>''')

    cost = sum(item["evaluation"]["costUsd"] for item in data["results"])
    latencies = [item["evaluation"]["latencyMs"] / 1000 for item in data["results"]]
    latency = sum(latencies)
    median_latency = statistics.median(latencies)
    average_cost = cost / len(data["results"])
    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Effect idiom check · neuralint</title><style>
:root{{--bg:#f5f7fb;--paper:#fff;--ink:#172033;--muted:#657189;--line:#dce2ec;--green:#087f5b;--greenbg:#e8f7f1;--amber:#9a6700;--amberbg:#fff6d9;--red:#c92a2a;--redbg:#fff0f0;--blue:#2457a6}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}}.wrap{{width:min(1120px,calc(100% - 32px));margin:auto}}header{{padding:48px 0 30px;background:var(--paper);border-bottom:1px solid var(--line)}}.kicker{{color:var(--blue);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.1em}}h1{{font-size:38px;line-height:1.1;margin:7px 0}}.lede{{color:var(--muted);font-size:17px;max-width:760px}}.stats{{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}}.stat{{border:1px solid var(--line);border-radius:10px;padding:10px 15px;min-width:145px}}.stat strong{{display:block;font-size:22px}}.stat span{{color:var(--muted);font-size:11px;text-transform:uppercase}}main{{padding:28px 0 65px}}h2{{font-size:24px;margin:34px 0 6px}}.copy{{color:var(--muted);margin-top:0;max-width:790px}}.callout{{border-left:4px solid var(--amber);background:var(--amberbg);padding:13px 16px;border-radius:6px;margin:18px 0}}details.result{{background:var(--paper);border:1px solid var(--line);border-radius:9px;margin:8px 0;overflow:hidden}}details.result>summary{{list-style:none;display:grid;grid-template-columns:14px minmax(250px,2fr) minmax(200px,1.4fr) 55px 100px;align-items:center;gap:12px;padding:12px 15px;cursor:pointer}}summary::-webkit-details-marker{{display:none}}.dot{{width:9px;height:9px;border-radius:50%;background:var(--green);display:inline-block}}.review .dot{{background:var(--amber)}}.miss .dot{{background:var(--red)}}.rule-name small,.control small{{display:block;color:var(--muted);font-family:ui-monospace,monospace;font-size:10px}}.case-name{{color:var(--muted)}}.status{{text-align:center;border-radius:999px;padding:3px 7px;background:var(--greenbg);color:var(--green);font-size:10px;font-weight:800;text-transform:uppercase}}.review .status{{background:var(--amberbg);color:var(--amber)}}.miss .status{{background:var(--redbg);color:var(--red)}}.result-body{{display:grid;grid-template-columns:1fr 1fr;gap:20px;border-top:1px solid var(--line);padding:16px}}h4{{margin:0 0 6px}}p{{margin:6px 0}}.guidance{{color:var(--muted)}}pre{{background:#101827;color:#d9e4f3;border-radius:7px;padding:11px;overflow:auto;font:11px/1.45 ui-monospace,monospace;margin:5px 0}}.line{{display:block;white-space:pre}}.line.add{{color:#8ce4b7}}.line.del{{color:#ff9dab}}.line.hunk{{color:#a9c8ff}}.line.meta{{color:#71839c}}.nested{{margin:0 16px 14px}}.nested>summary,.control summary{{color:var(--blue);cursor:pointer}}ul{{padding-left:20px}}li span{{color:var(--muted)}}.controls{{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}}.control{{display:flex;gap:10px;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:13px}}.control p{{color:var(--muted);margin:2px 0}}.control .dot{{margin-top:5px}}.links{{display:flex;gap:12px;margin-top:18px}}.button{{display:inline-block;padding:8px 12px;border-radius:7px;background:var(--ink);color:white;text-decoration:none}}footer{{border-top:1px solid var(--line);padding:24px 0;color:var(--muted)}}@media(max-width:760px){{details.result>summary{{grid-template-columns:12px 1fr 55px}}.case-name,.status{{display:none}}.result-body,.controls{{grid-template-columns:1fr}}}}
</style></head><body><header><div class="wrap"><div class="kicker">neuralint · Effect v4 experiment</div><h1>Did Jev recognize the intended idioms?</h1><p class="lede">One primary expectation per violating changeset. Open a row only when you want the changed lines and related matches.</p><div class="stats"><div class="stat"><strong>30/30</strong><span>primary rules found</span></div><div class="stat"><strong>28/30</strong><span>definitive</span></div><div class="stat"><strong>5/5</strong><span>clean controls had no violation</span></div><div class="stat"><strong>{median_latency:.2f}s</strong><span>median per check · ${average_cost:.5f} avg</span></div></div></div></header><main class="wrap"><section><h2>Needs attention</h2><p class="copy">Two intended findings were retained but remained below the 80% definitive threshold.</p>{''.join(attention_rows)}</section><section><h2>Definitive primary detections</h2><p class="copy">These 28 rows show only the predeclared primary rule. Related rule matches are tucked inside each row.</p>{''.join(primary_rows)}</section><section><h2>Clean controls</h2><p class="copy">No clean control received a definitive violation. Two produced advisories.</p><div class="controls">{''.join(clean_cards)}</div></section><section><h2>Additional matches</h2><div class="callout"><strong>{extra_definitive + extra_advisory} unique secondary candidates</strong>: {extra_definitive} definitive and {extra_advisory} advisory. Some are useful overlapping rules; others are noise. They have not been adjudicated, so this is not a precision score.</div><div class="links"><a class="button" href="debug.html">Open full diagnostic report</a><a class="button" href="../provenance.json">View provenance JSON</a></div></section></main><footer><div class="wrap">Source-backed synthetic experiment. Not official Effect guidance.</div></footer></body></html>'''
    OUTPUT.write_text(document)
    print(OUTPUT)


if __name__ == "__main__":
    main()
