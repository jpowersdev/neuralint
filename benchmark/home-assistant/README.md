# Home Assistant 54-rule funnel benchmark

This suite tests neuralint's intended top-of-funnel role with a larger, independently sourced policy catalog.

## Rule catalog

All 54 rules come from Home Assistant's official [Integration Quality Scale](https://developers.home-assistant.io/docs/core/integration-quality-scale/) documentation at developer-docs commit `17a7d242991cd7a22d11087acfe60545fa58ee49`.

The rule artifacts were generated and frozen before the benchmark patches were created. Each artifact retains its official title, reasoning, source URL, and a generic violation/compliance predicate. [`provenance.json`](provenance.json) records the source of every rule.

For this stress test, all 54 rules are scoped broadly to integration and integration-test paths. Therefore every rule is screened against every PR even when realistic path routing could remove some documentation-oriented rules earlier.

## Repository and PRs

The suite uses the real [`home-assistant/core`](https://github.com/home-assistant/core) repository at commit `40fcd7dc6b37781291745e3d6c39601563e87349` and its platinum-quality `airgradient` integration.

Five generated PRs introduce plausible regressions:

1. remove config-entry unloading;
2. stop injecting Home Assistant's shared web session;
3. remove sensor unique IDs;
4. replace a translated action exception with an English string;
5. remove the explicit parallel-update limit.

The five PRs and 54 rules produce 270 rule × PR opportunities with five labeled findings.

## Evaluators

- **neuralint / Jev:** all 54 rules are batched into each screening request; only screened candidates receive focused localization.
- **GPT-5.6 Terra, low:** a repository-aware Pi agent reads the same catalog, inspects the full checkout with tools, and returns candidate findings.

Competitors are configured in [`competitors.yaml`](competitors.yaml); adding another Pi-supported model requires only another entry.

## Initial result

The production-shaped comparison asks both paths to produce complete PR-review comments with concrete explanations, decisive evidence, and suggested alternatives:

| Workflow | Review coverage | Candidate precision | End-to-end latency | Cost |
|---|---:|---:|---:|---:|
| neuralint candidate routing | 100% (5/5) | 100% | 2.68 s | $0.003508 |
| Terra direct review of all 54 rules | 100% (5/5) | 100% | 208.61 s | $0.115992 |
| neuralint → focused Terra review drafting | 100% (5/5) | 100% | 60.49 s | $0.043732 |

Jev pricing is calculated at **$0.042 per million input tokens with free output**. The cascade cost combines `$0.003508` for Jev with `$0.040224` reported by the focused Terra drafting stage.

neuralint reduced 270 possible combinations to exactly five candidates without a routing miss or false positive. Terra then generated one review comment for every routed candidate; it was not asked to re-discover, confirm, reject, or suppress candidates.

Both direct and routed Terra produced substantive explanations and actionable alternatives for all five regressions. The routed path preserved neuralint's inconclusive status for the parallel-update finding while still explaining the risk and recommending restoration of an explicit limit.

Compared with direct Terra, the complete review-drafting cascade was approximately **3.45× faster** and **62% cheaper**. Focused Terra used 12,556 reported input tokens and 1,174 output tokens, versus 31,099 input and 2,102 output for direct Terra.

The complete direct and routed reviews are preserved in [`results/airgradient-54-terra-review-drafting.json`](results/airgradient-54-terra-review-drafting.json).

## Interpretation

The run supports the speed, cost, and routing hypothesis, but **does not yet show attention-related reliability degradation in direct Terra**: direct Terra still found all five violations at 54 rules. The advantage demonstrated here is that Jev can remove broad policy discovery from the expensive agent's job while preserving complete review output.

Review-comment quality has only been inspected qualitatively, not blindly scored. The next experiment should repeat both paths, use a separate judge or human rubric for explanation and suggestion quality, and test nested catalogs at 10, 25, 54, 100, 200, and 500 rules with randomized order. Harder multi-file regressions and clean PRs are also necessary.

## Run

```sh
direnv exec . pnpm benchmark:home-assistant \
  > benchmark/home-assistant/results/airgradient-54-terra-low.json
```

The first run clones the pinned repository into ignored `benchmark/.cache/`. Temporary scenario checkouts are removed afterward.

## Limitations

- The PRs are generated one-line regressions rather than historical PRs.
- Every PR contains a violation; unrelated rules provide negatives, but clean PRs are still needed.
- Results are single runs with fixed rule ordering.
- The extracted policy text is a compact representation of official guidance, not a complete replacement for the source documents.
- Terra has full repository tools while neuralint currently classifies diff evidence, intentionally comparing the proposed workflows rather than isolated models.

A future suite should use TigerBeetle as a contrasting systems-code repository with strong documented invariants and a very different language and failure model.
