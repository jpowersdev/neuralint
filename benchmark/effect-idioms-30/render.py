#!/usr/bin/env python3
"""Render a self-contained HTML view of the 30-rule Effect experiment."""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

SUITE = Path(__file__).resolve().parent
DATA = SUITE / "results/jev.json"
PROVENANCE = SUITE / "provenance.json"
RULES = SUITE / "rules"
OUTPUT = SUITE / "results/debug.html"


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def diff_html(source: str) -> str:
    output = []
    for line in source.splitlines():
        cls = "ctx"
        if line.startswith("+++") or line.startswith("---") or line.startswith("diff ") or line.startswith("index "):
            cls = "meta"
        elif line.startswith("+"):
            cls = "add"
        elif line.startswith("-"):
            cls = "del"
        elif line.startswith("@@"):
            cls = "hunk"
        output.append(f'<span class="line {cls}">{esc(line)}</span>')
    return "\n".join(output)


def main() -> None:
    data = json.loads(DATA.read_text())
    provenance = json.loads(PROVENANCE.read_text())
    source_map = provenance["sources"]
    evidence_map = {entry["id"]: entry["evidenceScope"] for entry in provenance["rules"]}
    rule_sources = {entry["id"]: entry["sources"] for entry in provenance["rules"]}
    rules = []
    for path in sorted(RULES.glob("*.yaml")):
        rule = json.loads(path.read_text())
        rule["evidenceScope"] = evidence_map[rule["id"]]
        rule["sources"] = rule_sources[rule["id"]]
        rules.append(rule)
    rules.sort(key=lambda item: item["id"])
    results = data["results"]
    positives = [item for item in results if item["expected"]]
    cleans = [item for item in results if not item["expected"]]
    retained = sum(item["evaluation"]["primaryRetained"] for item in positives)
    definitive_primary = 0
    for item in positives:
        expected = item["expected"][0]["ruleId"]
        definitive_primary += any(f["ruleId"] == expected and f["status"] == "violation" for f in item["report"]["findings"])
    total_findings = sum(len(item["report"]["findings"]) for item in results)
    definitive = sum(f["status"] == "violation" for item in results for f in item["report"]["findings"])
    inconclusive = total_findings - definitive
    unanticipated = sum(item["evaluation"]["unanticipatedUnique"] for item in results)
    clean_quiet = sum(not item["report"]["findings"] for item in cleans)
    clean_no_definitive = sum(not any(f["status"] == "violation" for f in item["report"]["findings"]) for item in cleans)
    latency = sum(item["evaluation"]["latencyMs"] for item in results) / 1000
    cost = sum(item["evaluation"]["costUsd"] for item in results)
    requests = sum(item["report"]["usage"]["requests"] for item in results)

    sources_html = "".join(f'''<article class="source"><strong>{esc(source['title'])}</strong><code>{esc(source['revision'][:12])}</code><span>{esc(source['license'])}</span><a href="{esc(source['url'])}">source</a></article>''' for source in source_map.values())
    rule_cards = []
    for rule in rules:
        chips = "".join(f'<a class="chip" href="{esc(source_map[key]["url"])}">{esc(key)}</a>' for key in rule["sources"])
        rule_cards.append(f'''
<article class="rule-card" id="rule-{esc(rule['id'])}">
  <div class="rule-top"><code>{esc(rule['id'])}</code><span class="severity {esc(rule['severity'])}">{esc(rule['severity'])}</span></div>
  <h3>{esc(rule['title'])}</h3><p>{esc(rule['description'])}</p>
  <dl><dt>Evidence</dt><dd>{esc(rule['evidenceScope'])}</dd><dt>Violation</dt><dd>{esc(rule['criteria']['violation'])}</dd><dt>Compliant</dt><dd>{esc(rule['criteria']['compliant'])}</dd></dl>
  <div class="chips">{chips}</div>
</article>''')

    rule_ids = [rule["id"] for rule in rules]
    matrix_head = "".join(f'<th title="{esc(rule_id)}"><a href="#rule-{esc(rule_id)}">{esc(rule_id.removeprefix("EFFECT_"))}</a></th>' for rule_id in rule_ids)
    matrix_rows = []
    for item in results:
        expected = {entry["ruleId"] for entry in item["expected"]}
        by_rule: dict[str, list[dict[str, Any]]] = {}
        for finding in item["report"]["findings"]:
            by_rule.setdefault(finding["ruleId"], []).append(finding)
        cells = []
        for rule_id in rule_ids:
            findings = by_rule.get(rule_id, [])
            if rule_id in expected and findings:
                cls, symbol, title = "primary", "P", "primary expectation retained"
            elif rule_id in expected:
                cls, symbol, title = "miss", "×", "primary expectation missed"
            elif any(f["status"] == "violation" for f in findings):
                cls, symbol, title = "extra-def", "+", "unanticipated definitive finding"
            elif findings:
                cls, symbol, title = "extra-inc", "?", "unanticipated inconclusive finding"
            else:
                cls, symbol, title = "empty", "·", "not reported"
            cells.append(f'<td class="{cls}" title="{title}">{symbol}</td>')
        kind = "positive" if item["expected"] else "clean"
        matrix_rows.append(f'<tr><th><a href="#{esc(item["id"])}">{esc(item["id"])}</a><small>{kind}</small></th>{"".join(cells)}</tr>')

    case_cards = []
    for item in results:
        expected_ids = {entry["ruleId"] for entry in item["expected"]}
        primary = next(iter(expected_ids), None)
        primary_finding = next((f for f in item["report"]["findings"] if f["ruleId"] == primary), None)
        if primary is None:
            state = "quiet" if not item["report"]["findings"] else "advisory"
        elif primary_finding is None:
            state = "miss"
        else:
            state = "definitive" if primary_finding["status"] == "violation" else "advisory"
        findings = []
        for finding in item["report"]["findings"]:
            relation = "primary" if finding["ruleId"] in expected_ids else "unanticipated"
            findings.append(f'''
<article class="finding {esc(finding['status'])}">
 <div><code>{esc(finding['ruleId'])}</code><span class="badge {relation}">{relation}</span><span class="badge">{esc(finding['status'])}</span><span class="prob">file {finding['screeningProbability']:.0%} · hunk {finding['violationProbability']:.0%}</span></div>
 <strong>{esc(finding['ruleTitle'])}</strong><p>{esc(finding['ruleDescription'])}</p><small>{esc(finding['path'])} · {esc(finding['hunkHeader'])}</small>
</article>''')
        if not findings:
            findings.append('<p class="quiet-copy">No candidate emitted.</p>')
        expected_html = "No primary finding expected" if primary is None else f'Primary: <code>{esc(primary)}</code>'
        case_cards.append(f'''
<section class="case" id="{esc(item['id'])}" data-kind="{'positive' if primary else 'clean'}" data-state="{state}">
 <div class="case-head"><div><span class="eyebrow">{esc(item['id'])}</span><h3>{esc(item['title'])}</h3></div><span class="outcome {state}">{state}</span></div>
 <div class="meta"><span>{expected_html}</span><span>{item['evaluation']['latencyMs']/1000:.2f}s</span><span>${item['evaluation']['costUsd']:.6f}</span><span>{item['report']['usage']['requests']} requests</span></div>
 <details open><summary>Findings ({len(item['report']['findings'])})</summary>{''.join(findings)}</details>
 <details><summary>Diff</summary><pre class="diff">{diff_html(item['diff'])}</pre></details>
</section>''')

    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>30 Effect idioms · neuralint</title>
<style>
:root{{--bg:#09111d;--panel:#101d2d;--panel2:#14263a;--line:#29415c;--text:#eff8ff;--muted:#9ab1c8;--mint:#5eead4;--green:#73e2a7;--red:#ff7d90;--amber:#ffd166;--blue:#7eb6ff}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:radial-gradient(circle at 8% 0,#18364a 0,transparent 28%),var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,sans-serif}}code,pre{{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}}a{{color:var(--mint);text-decoration:none}}.wrap{{width:min(1550px,calc(100% - 36px));margin:auto}}header{{padding:68px 0 38px;border-bottom:1px solid var(--line)}}.kicker,.eyebrow{{color:var(--mint);font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}}h1{{font-size:clamp(40px,6vw,75px);line-height:1;margin:10px 0 18px;max-width:1100px}}.lede{{font-size:19px;color:var(--muted);max-width:1000px}}.notice{{border:1px solid #85682a;background:#2b2416;color:#ffe6a7;border-radius:10px;padding:14px 17px;margin-top:23px}}.stats{{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:28px}}.stat{{background:linear-gradient(145deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:12px;padding:16px}}.stat strong{{display:block;font-size:27px}}.stat span{{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em}}main{{padding:30px 0 85px}}h2{{font-size:29px;margin:50px 0 8px}}.copy{{color:var(--muted);max-width:950px}}.sources{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}}.source{{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}}.source strong{{width:100%}}.source code,.source span{{color:var(--muted)}}.rules{{display:grid;grid-template-columns:repeat(2,1fr);gap:11px}}.rule-card{{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:17px;scroll-margin-top:10px}}.rule-top{{display:flex;justify-content:space-between;gap:10px}}.rule-card h3{{margin:7px 0}}.rule-card p,.rule-card dd{{color:var(--muted)}}dl{{display:grid;grid-template-columns:80px 1fr;gap:6px 10px}}dt{{font-weight:700}}dd{{margin:0}}.severity,.chip,.badge,.outcome{{font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-radius:999px;padding:3px 8px}}.severity.error,.severity.critical{{color:var(--red);background:#3b1d29}}.severity.warning{{color:var(--amber);background:#352c18}}.chips{{display:flex;gap:5px;flex-wrap:wrap}}.chip{{background:#163543}}.matrix{{overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--panel);max-height:720px}}table{{border-collapse:collapse}}th,td{{border-bottom:1px solid var(--line);padding:7px;text-align:center}}thead th{{height:175px;vertical-align:bottom;position:sticky;top:0;background:var(--panel)}}thead th a{{writing-mode:vertical-rl;transform:rotate(180deg);font-size:10px}}tbody th{{text-align:left;white-space:nowrap;position:sticky;left:0;background:var(--panel)}}tbody th small{{display:block;color:var(--muted)}}td.primary{{color:var(--green);font-weight:bold}}td.miss{{color:var(--red)}}td.extra-def{{color:var(--amber);font-weight:bold}}td.extra-inc{{color:var(--blue)}}td.empty{{color:#36506a}}.controls{{position:sticky;top:0;z-index:4;background:rgba(9,17,29,.94);backdrop-filter:blur(8px);padding:10px 0;display:flex;gap:7px}}button{{background:var(--panel);border:1px solid var(--line);color:var(--text);padding:7px 12px;border-radius:999px;cursor:pointer}}button.active{{border-color:var(--mint);color:var(--mint)}}.case{{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:20px;margin:15px 0;scroll-margin-top:58px}}.case.hidden{{display:none}}.case-head{{display:flex;justify-content:space-between;gap:18px}}.case h3{{margin:3px 0;font-size:22px}}.outcome.definitive,.badge.primary{{color:var(--green);background:#16382d}}.outcome.advisory{{color:var(--amber);background:#382d18}}.outcome.quiet{{color:var(--blue);background:#172d49}}.outcome.miss{{color:var(--red);background:#3b1d29}}.meta{{display:flex;gap:15px;flex-wrap:wrap;color:var(--muted);margin:7px 0 14px}}details{{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}}summary{{cursor:pointer;font-weight:700}}.finding{{background:var(--panel2);border-left:3px solid var(--blue);border-radius:7px;padding:12px;margin:10px 0}}.finding.violation{{border-color:var(--green)}}.finding>div{{display:flex;gap:7px;align-items:center;flex-wrap:wrap}}.finding p{{color:var(--muted);margin:5px 0}}.finding small{{color:#7896b4}}.badge.unanticipated{{color:var(--amber);background:#382d18}}.prob{{margin-left:auto;color:var(--muted);font-size:11px}}.diff{{background:#070d16;border:1px solid #22364d;border-radius:8px;padding:12px;overflow:auto;font-size:12px}}.line{{display:block;white-space:pre}}.line.add{{background:#123428;color:#b8f5d1}}.line.del{{background:#3b1923;color:#ffc3cd}}.line.hunk{{color:#b6c9ff;background:#192742}}.line.meta{{color:#748ca4}}footer{{border-top:1px solid var(--line);padding:25px 0;color:var(--muted)}}@media(max-width:950px){{.stats{{grid-template-columns:repeat(2,1fr)}}.rules,.sources{{grid-template-columns:1fr}}.wrap{{width:calc(100% - 22px)}}}}
</style></head><body><header><div class="wrap"><div class="kicker">neuralint · source-backed rule mining</div><h1>30 semantic rules for idiomatic Effect v4</h1><p class="lede">Guidance compiled from official Effect documentation and two public, MIT-licensed practitioner guides, then exercised against 30 targeted violations and five exception-oriented clean controls.</p><div class="notice"><strong>Exploratory.</strong> Primary expectations are intentionally one rule per positive fixture and are not exhaustive multi-label ground truth. Unanticipated findings may be valid overlaps or noise; no precision claim is made without adjudication.</div><div class="stats"><div class="stat"><strong>{retained}/30</strong><span>primary retained</span></div><div class="stat"><strong>{definitive_primary}/30</strong><span>primary definitive</span></div><div class="stat"><strong>{clean_quiet}/5</strong><span>clean candidate-quiet</span></div><div class="stat"><strong>{clean_no_definitive}/5</strong><span>clean definitive-quiet</span></div><div class="stat"><strong>{latency:.1f}s</strong><span>latency · {requests} requests</span></div><div class="stat"><strong>${cost:.5f}</strong><span>estimated Jev cost</span></div></div></div></header><main class="wrap"><section><h2>Sources</h2><p class="copy">Top Effect contributors' repository instructions were inspected as well. Most current maintainer guidance redirects agents to Effect's official LLMS.md; the catalog therefore treats it as the primary authority and uses practitioner guides for application-level rules and exceptions.</p><div class="sources">{sources_html}</div></section><section><h2>Catalog</h2><p class="copy">Each rule records its required evidence scope. The current neuralint runtime still receives diff hunks only; the distinction shows where enclosing-symbol, file, or repository retrieval is needed next.</p><div class="rules">{''.join(rule_cards)}</div></section><section><h2>Detection matrix</h2><p class="copy"><b>P</b> primary retained · <b>+</b> unanticipated definitive · <b>?</b> unanticipated inconclusive · <b>×</b> primary missed. Overlap is expected.</p><div class="matrix"><table><thead><tr><th>Fixture</th>{matrix_head}</tr></thead><tbody>{''.join(matrix_rows)}</tbody></table></div></section><section><h2>Fixture detail</h2><p class="copy">The 122 emitted candidates comprise {definitive} definitive and {inconclusive} inconclusive findings. There are {unanticipated} unique unanticipated rule/path results awaiting adjudication.</p><div class="controls"><button class="active" data-filter="all">All</button><button data-filter="positive">Positive</button><button data-filter="clean">Clean</button><button data-filter="definitive">Primary definitive</button><button data-filter="advisory">Advisory</button><button data-filter="miss">Misses</button></div>{''.join(case_cards)}</section></main><footer><div class="wrap">Raw output: <code>benchmark/effect-idioms-30/results/jev.json</code>. This report does not include private company guidance or unlicensed third-party text.</div></footer><script>const bs=[...document.querySelectorAll('button[data-filter]')],cs=[...document.querySelectorAll('.case')];bs.forEach(b=>b.addEventListener('click',()=>{{bs.forEach(x=>x.classList.remove('active'));b.classList.add('active');const f=b.dataset.filter;cs.forEach(c=>c.classList.toggle('hidden',!(f==='all'||c.dataset.kind===f||c.dataset.state===f)))}}));</script></body></html>'''
    OUTPUT.write_text(document)
    print(OUTPUT)


if __name__ == "__main__":
    main()
