# Jev one-pass decision-matrix feasibility benchmark

This benchmark tests whether fast semantic linting can use a bounded number of Jev calls rather than a screen-plus-per-rule N+1 workflow.

Each run sends all 30 synthetic Effect changes together with 1, 4, 10, 15, 20, 25, or 30 rules in **one provider request**. It creates an independent probability decision for every applicable rule/change pair.

| Run | Decisions | Provider requests |
|---:|---:|---:|
| 1 rule × 30 changes | 30 | 1 |
| 4 rules × 30 changes | 120 | 1 |
| 10 rules × 30 changes | 300 | 1 |
| 15 rules × 30 changes | 450 | 1 |
| 20 rules × 30 changes | 600 | 1 |
| 25 rules × 30 changes | 750 | 1 |
| 30 rules × 30 changes | 900 | 1 |

The runner records provider-limit failures alongside successful runs so the result establishes a usable decision-packing boundary.

The experiment measures provider acceptance, primary retention, definitive primary classification, unexpected candidates, latency, token use, and estimated Jev cost. It is a feasibility spike, not a production-quality precision benchmark: the 30 changes are positive-heavy and primary labels are not exhaustive.

Run:

```sh
direnv exec . pnpm benchmark:jev-matrix
```

Raw results are written to:

- `results/scaling.json`
- `results/packed-30x30.json`

## First observed result

The provider accepted up to 450 decisions in one request and rejected 600, 750, and 900 decisions with `max_tokens_exceeded` for this encoding. Two concurrent 15-rule packs covered the complete 30 × 30 matrix:

| Measure | Result |
|---|---:|
| Changed files | 30 |
| Rules | 30 |
| Rule/change decisions | 900 |
| Jev requests | **2** |
| End-to-end latency | **0.72 seconds** |
| Primary retained | **30/30** |
| Primary definitive | **30/30** |
| Unexpected candidates | 66 |
| Unexpected definitive candidates | 14 |
| Input tokens | 119,631 |
| Estimated cost | **$0.00502** |

Compared with the preserved 31-request rule-focused run, this single observation used 29 fewer requests, reduced latency from 1.47 seconds, reduced estimated cost from $0.01503, and retained the same 30 primary classifications. Unexpected findings remain non-exhaustively labeled and require adjudication, so this is not a precision result.

The first production character-budget packer used **3 requests**, completed in **0.98 seconds**, cost **$0.00635**, and retained **30/30 definitive primary findings**. A later dual-budget implementation models TypeSafe's documented constraints—64k tokens across state plus all questions and 32k across state plus the longest question—with conservative 55k/27k targets, shared-resource best-fit packing, and deterministic split-on-limit fallback. After changed-span state was added, the same 30 × 30 workload used **4 requests**, completed in **1.565 seconds**, cost **$0.00864**, and retained **30/30 definitive primary findings**. The first rule-coherent `semantic-chunks` planner run automatically added compact Tree-sitter context and kept each rule's cases together: it used **6 requests**, completed in **1.829 seconds**, cost **$0.01156**, and retained **30/30 definitive primary findings**. Unanticipated findings increased from 9 to 19 and remain unadjudicated, so this is not evidence of improved precision. Raw output is at `benchmark/effect-idioms-30/results/pr-30-files-production-matrix.json`.

## Go/no-go questions

1. Can `jev-latest` accept the matrix in a small, input-size-bounded number of requests? **Yes: two for this workload.**
2. Does end-to-end latency stay within a three-second lint budget? **Yes in the first run: 0.72 seconds.**
3. Does the packed matrix retain the 30 predeclared primary candidates? **Yes in the first run: 30/30 definitive.**
4. Does quality remain stable on balanced and repeated fixtures? **Not established.**
5. Is cost lower than the preserved 31-request rule-focused run? **Yes in the first run: $0.00502 versus $0.01503.**

A positive result justifies replacing candidate-dependent follow-up requests with request packs determined only by total evidence and decision budget. A negative result is evidence that Jev cannot support the intended fast-mode architecture at this catalog size.
