# neuralint nested-catalog benchmark

> **Pilot result:** one run per catalog size on five generated Home Assistant regressions. All 54 source policies are independently authored official Integration Quality Scale rules. These results measure this fixture, not general production reliability.

## Headline

Jev found all five expected issues with no extra candidates at 10, 25, and 54 policies. No reviewer won every group. The cheapest qualified workflows were **Jev → Luna at N=10**, **Jev → Terra at N=25**, and **full-catalog Luna at N=54**. The fastest qualified workflows were **Jev → Sonnet at N=10** and **Jev → Terra at N=25 and N=54**. Screening reduced expensive-review scope by 90.0%, 96.0%, and 98.1% as the catalog grew.

A workflow passes the **100% quality gate** only when it reviews every expected issue, emits no extra review, and every review is information-complete, grounded, actionable, free of material errors, and free of unsafe remediation. An explicitly inconclusive but complete and useful review remains eligible.

## Cheapest workflows with 100% quality

| N | Rank | Reviewer | Workflow | Quality | Issues reviewed | Status | End-to-end cost |
|---:|---:|---|---|---:|---:|---:|---:|
| 10 | 1 | GPT-5.6 Luna, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | $0.004508 |
| 10 | 2 | GPT-5.6 Terra, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | $0.055756 |
| 10 | 3 | GPT-5.6 Terra, low | Full-catalog review | 100% ✓ | 5/5 | 5 V / 0 I | $0.105532 |
| 25 | 1 | GPT-5.6 Terra, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | $0.039202 |
| 25 | 2 | GPT-5.6 Terra, low | Full-catalog review | 100% ✓ | 5/5 | 5 V / 0 I | $0.059467 |
| 25 | 3 | Claude Haiku 4.5, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | $0.277428 |
| 54 | 1 | GPT-5.6 Luna, low | Full-catalog review | 100% ✓ | 5/5 | 5 V / 0 I | $0.008586 |
| 54 | 2 | GPT-5.6 Terra, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | $0.047194 |
| 54 | 3 | GPT-5.6 Terra, low | Full-catalog review | 100% ✓ | 5/5 | 5 V / 0 I | $0.092324 |

## Fastest workflows with 100% quality

| N | Rank | Reviewer | Workflow | Quality | Issues reviewed | Status | End-to-end time |
|---:|---:|---|---|---:|---:|---:|---:|
| 10 | 1 | Claude Sonnet 5, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | 43.43s |
| 10 | 2 | GPT-5.6 Luna, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | 52.24s |
| 10 | 3 | GPT-5.6 Terra, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | 57.31s |
| 25 | 1 | GPT-5.6 Terra, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | 58.04s |
| 25 | 2 | Claude Haiku 4.5, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | 160.79s |
| 25 | 3 | GPT-5.6 Terra, low | Full-catalog review | 100% ✓ | 5/5 | 5 V / 0 I | 175.63s |
| 54 | 1 | GPT-5.6 Terra, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | 57.85s |
| 54 | 2 | Claude Haiku 4.5, low | Jev screen → focused review | 100% ✓ | 5/5 | 4 V / 1 I | 153.63s |
| 54 | 3 | GPT-5.6 Luna, low | Full-catalog review | 100% ✓ | 5/5 | 5 V / 0 I | 162.11s |

## End-to-end results by catalog size

### 10 policies

**5 PRs · 50 policy/PR decisions · 5 expected issues · seed `20260919`**

| Reviewer | Workflow | Work allocation | Issues reviewed | Status | Information-complete | Grounded/actionable | Material errors | Time | Cost |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| **GPT-5.6 Terra, low** | Full-catalog review | GPT-5.6 Terra evaluates 50 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | **100% ✓** | 0/5 | 147.60s | $0.105532 |
| **GPT-5.6 Terra, low** | Jev screen → focused review | Jev screens 50; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | **100% ✓** | 0/5 | 57.31s | $0.055756 |
| **GPT-5.6 Luna, low** | Full-catalog review | GPT-5.6 Luna evaluates 50 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | 80% (4/5) | 1/5 | 108.73s | $0.006119 |
| **GPT-5.6 Luna, low** | Jev screen → focused review | Jev screens 50; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | **100% ✓** | 0/5 | 52.24s | $0.004508 |
| **Claude Sonnet 5, low** | Full-catalog review | Claude Sonnet 5 evaluates 50 decisions | 4/5 (+1 extra) | 5 V / 0 I | 5/5 | 80% (4/5) | 1/5 | 118.30s | $0.522035 |
| **Claude Sonnet 5, low** | Jev screen → focused review | Jev screens 50; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | **100% ✓** | 0/5 | 43.43s | $0.119930 |
| **Claude Haiku 4.5, low** | Full-catalog review | Claude Haiku 4.5 evaluates 50 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | 40% (2/5) | 1/5 | 392.77s | $0.561451 |
| **Claude Haiku 4.5, low** | Jev screen → focused review | Jev screens 50; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | 80% (4/5) | 1/5 | 282.07s | $0.387749 |

> **GPT-5.6 Terra, low difference:** 90.0% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 100% → 100% (+0 points); **2.58× faster** (61.2% less time); **47.2% cheaper**.
> **GPT-5.6 Luna, low difference:** 90.0% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 80% → 100% (+20 points); **2.08× faster** (52.0% less time); **26.3% cheaper**.
> **Claude Sonnet 5, low difference:** 90.0% less expensive-review scope; issue coverage 4/5 → 5/5 (+1); actionable quality 80% → 100% (+20 points); **2.72× faster** (63.3% less time); **77.0% cheaper**.
> **Claude Haiku 4.5, low difference:** 90.0% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 40% → 80% (+40 points); **1.39× faster** (28.2% less time); **30.9% cheaper**.

### 25 policies

**5 PRs · 125 policy/PR decisions · 5 expected issues · seed `20260919`**

| Reviewer | Workflow | Work allocation | Issues reviewed | Status | Information-complete | Grounded/actionable | Material errors | Time | Cost |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| **GPT-5.6 Terra, low** | Full-catalog review | GPT-5.6 Terra evaluates 125 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | **100% ✓** | 0/5 | 175.63s | $0.059467 |
| **GPT-5.6 Terra, low** | Jev screen → focused review | Jev screens 125; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | **100% ✓** | 0/5 | 58.04s | $0.039202 |
| **GPT-5.6 Luna, low** | Full-catalog review | GPT-5.6 Luna evaluates 125 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | 80% (4/5) | 1/5 | 136.52s | $0.007154 |
| **GPT-5.6 Luna, low** | Jev screen → focused review | Jev screens 125; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | 80% (4/5) | 0/5 | 50.86s | $0.005231 |
| **Claude Sonnet 5, low** | Full-catalog review | Claude Sonnet 5 evaluates 125 decisions | 4/5 (+0 extra) | 4 V / 0 I | 4/4 | 100% (4/4) | 0/4 | 81.88s | $0.264587 |
| **Claude Sonnet 5, low** | Jev screen → focused review | Jev screens 125; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | 80% (4/5) | 1/5 | 45.07s | $0.110817 |
| **Claude Haiku 4.5, low** | Full-catalog review | Claude Haiku 4.5 evaluates 125 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | 40% (2/5) | 2/5 | 328.00s | $0.652724 |
| **Claude Haiku 4.5, low** | Jev screen → focused review | Jev screens 125; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | **100% ✓** | 0/5 | 160.79s | $0.277428 |

> **GPT-5.6 Terra, low difference:** 96.0% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 100% → 100% (+0 points); **3.03× faster** (67.0% less time); **34.1% cheaper**.
> **GPT-5.6 Luna, low difference:** 96.0% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 80% → 80% (+0 points); **2.68× faster** (62.7% less time); **26.9% cheaper**.
> **Claude Sonnet 5, low difference:** 96.0% less expensive-review scope; issue coverage 4/5 → 5/5 (+1); actionable quality 100% → 80% (-20 points); **1.82× faster** (45.0% less time); **58.1% cheaper**.
> **Claude Haiku 4.5, low difference:** 96.0% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 40% → 100% (+60 points); **2.04× faster** (51.0% less time); **57.5% cheaper**.

### 54 policies

**5 PRs · 270 policy/PR decisions · 5 expected issues · seed `20260919`**

| Reviewer | Workflow | Work allocation | Issues reviewed | Status | Information-complete | Grounded/actionable | Material errors | Time | Cost |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| **GPT-5.6 Terra, low** | Full-catalog review | GPT-5.6 Terra evaluates 270 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | **100% ✓** | 0/5 | 225.64s | $0.092324 |
| **GPT-5.6 Terra, low** | Jev screen → focused review | Jev screens 270; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | **100% ✓** | 0/5 | 57.85s | $0.047194 |
| **GPT-5.6 Luna, low** | Full-catalog review | GPT-5.6 Luna evaluates 270 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | **100% ✓** | 0/5 | 162.11s | $0.008586 |
| **GPT-5.6 Luna, low** | Jev screen → focused review | Jev screens 270; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | 80% (4/5) | 1/5 | 61.75s | $0.007089 |
| **Claude Sonnet 5, low** | Full-catalog review | Claude Sonnet 5 evaluates 270 decisions | 5/5 (+0 extra) | 5 V / 0 I | 5/5 | 80% (4/5) | 1/5 | 110.20s | $0.348164 |
| **Claude Sonnet 5, low** | Jev screen → focused review | Jev screens 270; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | 80% (4/5) | 1/5 | 72.39s | $0.118520 |
| **Claude Haiku 4.5, low** | Full-catalog review | Claude Haiku 4.5 evaluates 270 decisions | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | 80% (4/5) | 1/5 | 396.87s | $0.883336 |
| **Claude Haiku 4.5, low** | Jev screen → focused review | Jev screens 270; reviewer receives 5 packets | 5/5 (+0 extra) | 4 V / 1 I | 5/5 | **100% ✓** | 0/5 | 153.63s | $0.211038 |

> **GPT-5.6 Terra, low difference:** 98.1% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 100% → 100% (+0 points); **3.90× faster** (74.4% less time); **48.9% cheaper**.
> **GPT-5.6 Luna, low difference:** 98.1% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 100% → 80% (-20 points); **2.63× faster** (61.9% less time); **17.4% cheaper**.
> **Claude Sonnet 5, low difference:** 98.1% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 80% → 80% (+0 points); **1.52× faster** (34.3% less time); **66.0% cheaper**.
> **Claude Haiku 4.5, low difference:** 98.1% less expensive-review scope; issue coverage unchanged at 5/5; actionable quality 80% → 100% (+20 points); **2.58× faster** (61.3% less time); **76.1% cheaper**.

## Jev screening diagnostics

| N | Decisions screened | Candidates | Final status | Expected issue recall | Extra candidates | Fraction routed | Time | Cost |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 50 | 5 | 4 V / 1 I | 5/5 | 0 | 10.0% | 2.26s | $0.000970 |
| 25 | 125 | 5 | 4 V / 1 I | 5/5 | 0 | 4.0% | 2.31s | $0.001790 |
| 54 | 270 | 5 | 4 V / 1 I | 5/5 | 0 | 1.9% | 3.41s | $0.003508 |

## Workflows that did not pass the 100% quality gate

| N | Reviewer | Workflow | Actionable | Material errors | Why excluded |
|---:|---|---|---:|---:|---|
| 10 | Claude Haiku 4.5, low | Full-catalog review | 2/5 | 1/5 | `create-private-websession`: The changed constructor, violated session-injection requirement, and primary restoration are clear and accurately evidenced. Repository inspection validates the quality-scale, manifest, import, and HTTP-use claims. However, marking this HTTP integration exempt would not cure the violation, and the instruction to remove the session-helper import conflicts with restoring the cited constructor unless understood conditionally. Those alternatives materially undermine the otherwise correct remediation and can produce either false policy metadata or broken code.; `remove-parallel-update-limit`: Loss of declared quality-scale compliance is a concrete engineering consequence, so impact is identifiable even without a runtime failure. The changed lines are accurately quoted. Restoring the constant is valid, but merely declaring an exemption or coordinating similar removals elsewhere would not be justified for this polling platform and would not fix the stated requirement.; `remove-unload-entry`: The repository confirms the platform list, quality-scale declaration, and runtime-unload consequence, correcting the initial judge's unsupported-evidence concern. Restoring the hook is a valid fix. However, merely changing quality_scale.yaml and documenting intentional reliance on nonexistent implicit teardown would leave the policy violation in place, so the alternative remediation materially undermines the primary fix. |
| 10 | Claude Haiku 4.5, low | Jev screen → focused review | 4/5 | 1/5 | `remove-parallel-update-limit`: The central changed-line evidence, compliance impact, and restore recommendation are sound. The universal comparison with every other update platform is demonstrably false and materially overstates repository convention. The documentation/exemption alternatives are also inappropriate here because this entity independently polls the firmware service and has no existing exemption. |
| 10 | GPT-5.6 Luna, low | Full-catalog review | 4/5 | 1/5 | `create-private-websession`: Both quoted evidence items are factual when repository context is considered, and the review clearly identifies the regression and its resource impact. Restoring session injection is correct. Explicitly closing a private session would address leakage but would not satisfy the shared-websession requirement or recover its pooling efficiency, so presenting it as an alternative remediation is materially misleading. Closing an owned session is not itself unsafe. |
| 10 | Claude Sonnet 5, low | Full-catalog review | 4/5 | 1/5 | Missing 1 expected review. `create-private-websession`: The alleged unloading requirement, file, function, consequence, and proposed restoration are understandable, so the identifiability fields remain true independently of accuracy. Nevertheless, the review addresses the wrong rule and fabricates removal of a function that remains present. Its evidence has the wrong change, and restoring an already-existing unload handler does not remediate the actual websession regression. |
| 25 | Claude Haiku 4.5, low | Full-catalog review | 2/5 | 2/5 | `remove-sensor-unique-id`: The violation, location, quoted diff evidence, impact, and proposed restoration are all clear and correct. The assertion that Home Assistant falls back to an auto-generated unique ID is materially false: the entity retains `unique_id=None`; only an entity ID is allocated. That mechanism error can mislead readers about whether the entity remains registry-backed, although it does not invalidate the recommended fix.; `create-private-websession`: The violation, location, resource impact, evidence, and primary fix are accurate. Repository inspection validates all contextual evidence. However, client-owned lifecycle is not an applicable exemption for an integration that makes HTTP requests. Recommending that the rule be marked exempt would conceal rather than fix the regression, materially undermines the remediation, and creates a clear quality-scale policy problem.; `remove-parallel-update-limit`: Repository inspection validates the contextual evidence that was absent from the diff, so the evidence is grounded. The finding and potential consequence are accurate. Restoring the constant is appropriate, but documentation or verification alone is not an alternative fix for a rule that explicitly requires the platform declaration. |
| 25 | GPT-5.6 Luna, low | Full-catalog review | 4/5 | 1/5 | `remove-parallel-update-limit`: The diagnosis and restoration are otherwise clear and appropriate. The evidence block materially misstates change direction, marks unchanged code as removed, and omits the actual deleted PARALLEL_UPDATES line, so it is not grounded despite the unchanged async_update code existing in the repository. |
| 25 | GPT-5.6 Luna, low | Jev screen → focused review | 4/5 | 0/5 | `remove-parallel-update-limit`: The removed requirement, location, potential consequence, and evidence are understandable. The primary restoration is valid, but the suggested documentation-only alternative would leave the required declaration absent and is not an applicable official exception. |
| 25 | Claude Sonnet 5, low | Full-catalog review | 4/4 | 0/4 | Missing 1 expected review. |
| 25 | Claude Sonnet 5, low | Jev screen → focused review | 4/5 | 1/5 | `remove-parallel-update-limit`: The finding, evidence, impact, and conditional recommendations to set an explicit value are clear. Calling the compliance finding inconclusive is materially misleading: safety in practice or coordinator use does not satisfy this integration's done rule without an explicit constant. |
| 54 | Claude Haiku 4.5, low | Full-catalog review | 4/5 | 1/5 | `remove-unload-entry`: The deleted function is accurately identified and restoring it would fix the issue. However, the claimed genuine uncertainty about implicit unloading is materially misleading for this pinned core: unload is explicitly refused. Offering verification or documentation as alternatives to retaining the hook does not itself repair the violation, so the remediation is not fully appropriate. |
| 54 | GPT-5.6 Luna, low | Jev screen → focused review | 4/5 | 1/5 | `remove-parallel-update-limit`: The policy, file, removed construct, and possible overload consequence are understandable, and the diff evidence is accurate. However, the claim about concurrency across config entries misstates the removed constant's scope: each config entry has its own platform and semaphore, so restoring PARALLEL_UPDATES does not serialize entries against each other. The alternative custom bounded mechanism also would not satisfy the repository's explicit PARALLEL_UPDATES checker. |
| 54 | Claude Sonnet 5, low | Full-catalog review | 4/5 | 1/5 | `remove-sensor-unique-id`: The review correctly identifies the violated requirement, changed class, user impact, evidence, and proper restoration. However, it materially misdescribes runtime behavior by suggesting an entity without a unique ID may receive a new registry entry or be rejected because sibling sensors collide. Home Assistant does not create a registry entry in the no-unique-ID branch and allocates available entity IDs to avoid such collisions. The core finding and remediation remain correct. |
| 54 | Claude Sonnet 5, low | Jev screen → focused review | 4/5 | 1/5 | `remove-parallel-update-limit`: The direct evidence and explicit-value remediation are sound for this module. Nonetheless, the review makes a false global claim that Home Assistant never supplies an implicit limit and incorrectly treats the policy violation as potentially acceptable or inconclusive because of coordinator use. |

## Models and methodology

| Role | Model | Configuration |
|---|---|---|
| Full/focused reviewer | GPT-5.6 Terra | low thinking, Pi repository read/bash tools |
| Full/focused reviewer | GPT-5.6 Luna | low thinking, Pi repository read/bash tools |
| Full/focused reviewer | Claude Sonnet 5 | low effort, Claude CLI safe mode with Read/Bash tools |
| Full/focused reviewer | Claude Haiku 4.5 | low effort, Claude CLI safe mode with Read/Bash tools |
| Quality judge | GPT-5.6 Sol | high thinking; blinded context-free pass, then repository-aware adjudication |
| Screening router | TypeSafe AI Jev | current `jev-latest` endpoint |

The quality judge evaluated 119 reviews in 24 blinded batches. The initial judge had no tools; 22 non-passing reviews then received repository-aware adjudication against the pinned checkout. Initial judge overhead was 1171.58s and $2.270740; repository-aware adjudication added 669.18s and $0.516963. Both are excluded from production workflow time and cost.

Each catalog contains all five target policies. The remaining policies are a deterministic, nested sample from the same frozen 54-rule official catalog. Rule order is independently shuffled at each N. The same Jev candidates are handed to all four reviewers within a run. Screened reviewers must draft every candidate without rejecting or suppressing it.

## Limitations

- This is one run per N, so latency, cost, and model-output variance are not yet estimated.
- All five PRs are generated regressions and every PR is positive; there are no clean-PR controls.
- The suite covers one Home Assistant integration and five relatively localized policy failures.
- The quality judge is in the same provider family as Terra and Luna; human or cross-provider calibration remains necessary.
- A 100% result means five of five reviews in this fixture, not a population-level reliability estimate.

## Reproduce

```sh
direnv exec . python benchmark/scaling/run.py
direnv exec . python benchmark/scaling/judge.py
direnv exec . python benchmark/scaling/adjudicate.py
python benchmark/scaling/report.py
```
