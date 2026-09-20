# Thirty source-backed Effect idioms

This experiment compiles 30 semantic rules for idiomatic Effect v4 from public guidance, then evaluates them against 30 targeted synthetic violations and five exception-oriented clean controls.

Open [`results/index.html`](results/index.html) for the single PR-shaped 30-file run. The isolated-fixture summary is in [`results/fixtures.html`](results/fixtures.html), while the dense catalog, detection matrix, and every secondary candidate remain available in [`results/debug.html`](results/debug.html).

## Sources

All rule text is newly authored and linked to pinned public, MIT-licensed guidance:

- Effect-TS/effect [`LLMS.md`](https://github.com/Effect-TS/effect/blob/3b155e3e24e42b603d48dff5d3280715944998f0/LLMS.md)
- jpowersdev/effect-pi [`EFFECT.md`](https://github.com/jpowersdev/effect-pi/blob/2dc0f83136bb17bf2e77746b1e98186c57e49471/EFFECT.md)
- kitlangton/skills [`skills/effect`](https://github.com/kitlangton/skills/tree/22c35cb7fd29f931789253fc3c8eb142f2863a8a/skills/effect)

Repository instructions from leading Effect contributors were also surveyed. Most current instructions direct agents back to Effect's official `LLMS.md`, supporting its use as the primary authority. Older guidance that conflicts with current Effect v4 documentation was not used.

Private company guidance and unlicensed third-party material were used only to understand the desired authoring process; no text or rules from those sources are distributed here.

Exact source-to-rule mappings and evidence-scope requirements are in [`provenance.json`](provenance.json).

## Single PR-shaped result

One neuralint invocation evaluated a single Git diff containing 30 changed files against all 30 rules: 900 initial rule/file pairs.

| Measure | File-first | Hunk-focused | Rule-focused basic | Rule-focused enriched Layer rule |
|---|---:|---:|---:|---:|
| Primary candidates retained | **30/30** | 29/30 | **30/30** | **30/30** |
| Primary candidates definitive | 29/30 | 27/30 | 29/30 | **30/30** |
| Primary candidates inconclusive | 1/30 | 2/30 | 1/30 | **0/30** |
| Total findings | 114 | 86 | 169 | 182 |
| Unique secondary candidates | 84 | 57 | 139 | 152 |
| End-to-end latency | 20.77 seconds | 1.50 seconds | 1.50 seconds | **1.47 seconds** |
| Jev requests | 147 | **31** | **31** | **31** |
| Estimated Jev cost | **$0.01155** | $0.01271 | $0.01445 | $0.01503 |

The revised execution plan packs the complete 15,572-character diff into one global catalog screen. Hunk-focused localization asked about every routed rule at each hunk and missed the Layer-lifetime primary. Rule-focused localization instead asks one semantic question across all hunks, concurrently.

A pilot semantic block on the Layer-lifetime rule adds background, an explicit report boundary, exceptions, remediation, one evidence-scope preset, and three contrastive examples. In one follow-up run, its target moved from 66% screening / 71% localization to 79% / 90%, while its other matches remained advisory. This is encouraging but is not a stability result: the runs are single live samples, and total secondary candidates also varied upward.

## Isolated-fixture result

| Measure | Result |
|---|---:|
| Primary candidates retained | **30/30** |
| Primary candidates definitive | **28/30** |
| Primary candidates inconclusive | **2/30** |
| Clean controls with no candidates | **3/5** |
| Clean controls with no definitive findings | **5/5** |
| Total measured latency across 35 separate runs | 33.23 seconds |
| Jev requests | 163 |
| Estimated Jev cost | $0.01319 |

The fixtures predeclare one primary rule each. They are deliberately not exhaustive multi-label ground truth, so unanticipated findings cannot automatically be called false positives. Many are legitimate overlaps; others are visibly speculative. No precision claim is made without adjudicating all 92 unique unanticipated candidates.

The clean controls are encouraging for a confirmed-only UX: all five avoided definitive findings. Two produced low-confidence advisories.

## What this establishes

- A 30-rule semantic catalog is inexpensive enough for manual agent use.
- Jev retained every intended rule in the isolated, file-first, and rule-focused global runs; hunk-focused global localization retained 29/30.
- The enriched Layer rule made its intended candidate definitive in one follow-up run, but repeated and contrastive evaluation is still required.
- Concrete local violations often received high confidence.
- Overlapping idioms naturally produce multiple findings on one change.
- High-recall routing thresholds expose substantial advisory noise when every TypeScript file is eligible for every rule.

## What needs to change before a product pack

1. **Applicability routing:** Each rule needs semantic preconditions beyond path globs.
2. **Evidence planning:** Rules declare `changed-span`, `enclosing-symbol`, or `file` evidence requirements in provenance, but the runtime currently sends only diff hunks.
3. **Precision-oriented output:** Confirmed findings should be the default; advisories should be optional.
4. **Grouped findings:** Multiple rules on one changed construct should render as one location with several applicable conventions.
5. **Adjudication:** Unanticipated findings need valid-secondary, unsupported, incorrect, or ambiguous labels.
6. **Source-backed guidance fields:** The runtime schema should eventually carry source, section, message, guidance, exceptions, and evidence requirements directly.

## Catalog construction workflow

The experiment points toward a reusable pack-authoring process:

```text
primary documentation + maintained examples + organization guidance
  → candidate extraction
  → separate deterministic lint from semantic judgment
  → author applicability, violation, compliance, and exceptions
  → choose required evidence scope
  → create violation, compliant, and near-miss fixtures
  → run in advisory mode
  → adjudicate unexpected findings
  → publish a versioned pack
```

## Reproduce

```sh
python benchmark/effect-idioms-30/BuildCatalog.py
python benchmark/effect-idioms-30/BuildFixtures.py
pnpm build
direnv exec . python benchmark/effect-idioms-30/run.py
python benchmark/effect-idioms-30/run_pr.py
python benchmark/effect-idioms-30/render.py
python benchmark/effect-idioms-30/render_summary.py
python benchmark/effect-idioms-30/render_pr.py
xdg-open benchmark/effect-idioms-30/results/index.html
```

Machine-readable Jev output is stored in [`results/jev.json`](results/jev.json).
