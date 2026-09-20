#!/usr/bin/env python3
"""Render the concise single-PR performance result."""

from __future__ import annotations

import html
import json
from pathlib import Path

SUITE = Path(__file__).resolve().parent
DATA = SUITE / "results/pr-30-files-rule-focused.json"
BASELINE = SUITE / "results/pr-30-files-file-first.json"
OUTPUT = SUITE / "results/index.html"


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def main() -> None:
    data = json.loads(DATA.read_text())
    baseline = json.loads(BASELINE.read_text())
    metrics = data["metrics"]
    baseline_metrics = baseline["metrics"]
    primary = data["primary"]
    attention = [item for item in primary if item["status"] != "violation"]
    detected = [item for item in primary if item["status"] == "violation"]
    localization_requests = metrics["requests"] - 1
    latency_reduction = 1 - metrics["latencyMs"] / baseline_metrics["latencyMs"]
    request_reduction = 1 - metrics["requests"] / baseline_metrics["requests"]
    attention_copy = (
        "All intended rules were definitive in this run."
        if not attention
        else f"{len(attention)} intended rule{'s were' if len(attention) != 1 else ' was'} not definitive."
    )

    def row(item: dict) -> str:
        probability = item["violationProbability"] or 0
        state = "ok" if item["status"] == "violation" else "review"
        return f'''<article class="row {state}"><span class="dot"></span><div><strong>{esc(item['ruleId'])}</strong><small>{esc(item['path'])}</small></div><span>{esc(item['title'])}</span><b>{probability:.0%}</b><em>{esc(item['status'])}</em></article>'''

    document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>30-file PR · neuralint</title><style>
:root{{--bg:#f5f7fb;--paper:#fff;--ink:#172033;--muted:#68758b;--line:#dce3ed;--green:#087f5b;--greenbg:#e8f7f1;--amber:#9a6700;--amberbg:#fff6d9;--blue:#2457a6}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,system-ui,sans-serif}}.wrap{{width:min(1050px,calc(100% - 30px));margin:auto}}header{{background:var(--paper);border-bottom:1px solid var(--line);padding:48px 0 30px}}.kicker{{color:var(--blue);font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.1em}}h1{{font-size:42px;line-height:1.08;margin:8px 0}}.lede{{font-size:17px;color:var(--muted)}}.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:24px}}.stat{{border:1px solid var(--line);border-radius:10px;padding:14px}}.stat strong{{font-size:27px;display:block}}.stat span{{font-size:11px;color:var(--muted);text-transform:uppercase}}main{{padding:28px 0 60px}}h2{{font-size:23px;margin:32px 0 6px}}.copy{{color:var(--muted);max-width:780px}}.performance{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}}.performance div{{background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:14px}}.performance b{{display:block;font-size:22px}}.performance span{{color:var(--muted)}}.callout{{background:var(--amberbg);border-left:4px solid var(--amber);padding:13px 15px;border-radius:6px}}.row{{display:grid;grid-template-columns:12px minmax(250px,1.4fr) minmax(230px,1fr) 45px 85px;gap:11px;align-items:center;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px 13px;margin:6px 0}}.row small{{display:block;color:var(--muted);font-family:ui-monospace,monospace}}.row>span{{color:var(--muted)}}.row em{{font-style:normal;text-align:center;font-size:10px;text-transform:uppercase;padding:3px 6px;border-radius:999px;background:var(--greenbg);color:var(--green)}}.dot{{width:9px;height:9px;border-radius:50%;background:var(--green)}}.review .dot{{background:var(--amber)}}.review em{{background:var(--amberbg);color:var(--amber)}}details{{margin-top:16px}}summary{{cursor:pointer;color:var(--blue);font-weight:700}}.links{{display:flex;gap:10px;flex-wrap:wrap;margin-top:25px}}.button{{background:var(--ink);color:#fff;padding:8px 12px;border-radius:7px;text-decoration:none}}footer{{border-top:1px solid var(--line);padding:23px 0;color:var(--muted)}}@media(max-width:760px){{.stats,.performance{{grid-template-columns:repeat(2,1fr)}}.row{{grid-template-columns:12px 1fr 45px}}.row>span,.row>em{{display:none}}}}
</style></head><body><header><div class="wrap"><div class="kicker">single PR-shaped run</div><h1>30 changed files × 30 Effect rules</h1><p class="lede">One neuralint invocation over a single 30-file Git diff: 900 deterministic rule/file pairs before semantic screening.</p><div class="stats"><div class="stat"><strong>{metrics['latencyMs']/1000:.2f}s</strong><span>end-to-end latency</span></div><div class="stat"><strong>${metrics['costUsd']:.5f}</strong><span>estimated Jev cost</span></div><div class="stat"><strong>{metrics['primaryRetained']}/30</strong><span>primary rules retained</span></div><div class="stat"><strong>{metrics['primaryDefinitive']}/30</strong><span>primary definitive</span></div></div></div></header><main class="wrap"><section><h2>What consumed the time</h2><div class="performance"><div><b>{metrics['requests']}</b><span>Jev requests after batching</span></div><div><b>1</b><span>global catalog screen</span></div><div><b>{localization_requests}</b><span>concurrent hunk localizations</span></div></div><p class="callout">The rule-focused global plan reduced requests by {request_reduction:.0%} and latency by {latency_reduction:.0%} versus the preserved file-first baseline ({baseline_metrics['requests']} requests, {baseline_metrics['latencyMs']/1000:.2f}s). Adding contrastive guidance to the Layer-lifetime rule moved its primary match from 71% to 90% in this single follow-up run; this is encouraging, not yet a stability result.</p></section><section><h2>Needs review</h2><p class="copy">{attention_copy}</p>{''.join(row(item) for item in attention)}</section><section><h2>Definitive primary detections</h2><p class="copy">{metrics['primaryDefinitive']} intended rules were definitive. Secondary overlaps are omitted from this concise view.</p>{''.join(row(item) for item in detected)}</section><section><h2>Secondary matches</h2><p class="copy">The run emitted {metrics['findings']} total findings: {metrics['definitiveFindings']} definitive and {metrics['inconclusiveFindings']} inconclusive. There were {metrics['unanticipatedUnique']} unique secondary rule/path matches. They need adjudication and are not treated as false positives here.</p><div class="links"><a class="button" href="fixtures.html">Open isolated fixture summary</a><a class="button" href="debug.html">Open full diagnostic report</a><a class="button" href="pr-30-files-rule-focused.json">Raw enriched-rule result</a><a class="button" href="pr-30-files-rule-focused-basic.json">Raw basic-rule result</a><a class="button" href="pr-30-files-hunk-focused.json">Raw hunk-focused result</a><a class="button" href="pr-30-files-file-first.json">Raw baseline</a></div></section></main><footer><div class="wrap">Synthetic PR-shaped workload; one invocation, one diff, thirty changed files.</div></footer></body></html>'''
    OUTPUT.write_text(document)
    print(OUTPUT)


if __name__ == "__main__":
    main()
