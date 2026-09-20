# Gold-handoff remediation benchmark specification

## Claim

Given a correct structured diagnosis and relevant repository evidence, a focused Terra reviewer can produce human-facing remediation guidance that is non-inferior to full-catalog Terra review while using less time and money.

This benchmark intentionally bypasses neuralint detection and verification. It tests the final remediation stage in isolation.

## Arms

### Direct Terra

Terra receives the complete rule catalog, Git diff, repository checkout, and read-only tools. It must discover the applicable policy, diagnose the change, and propose remediation.

### Gold handoff → Terra

Terra receives one or more human-authored, confirmed packets containing:

- rule ID and title;
- violation and compliance conditions;
- authored generic guidance;
- exact changed location and diff evidence;
- grounded diagnosis;
- relevant repository evidence.

It may inspect the checkout with the same read-only tools, but it is not asked to rediscover applicable policies. The packet must not contain the known corrected patch.

## Output contract

Both arms return the same structured review shape:

```json
{
  "reviews": [
    {
      "ruleId": "...",
      "path": "...",
      "summary": "...",
      "impact": "...",
      "evidence": ["decisive changed line"],
      "remediation": "...",
      "validation": ["..."]
    }
  ],
  "summary": "..."
}
```

## Initial corpus

The pilot starts with the five pinned Home Assistant AirGradient regressions because each has:

- an independently sourced official policy;
- a known changed location;
- a generated violating patch;
- a corrected source revision;
- existing direct and routed Terra outputs;
- repository-aware quality adjudication.

The claim-worthy corpus must later expand to 20–30 confirmed violations across Effect/TypeScript, Home Assistant/Python, local rules, cross-file rules, resource lifetimes, concurrency, errors, configuration, and testing.

## Gold-packet constraints

A packet may contain facts establishing the violation but must not reveal the expected corrected patch or copy a previous model's remediation. Gold packets are authored before running either arm and remain frozen.

## Quality rubric

Blinded judges score each review for:

1. correct understanding of the violation;
2. accurate user or engineering impact;
3. decisive changed-line evidence;
4. repository-grounded claims;
5. actionable repository-specific remediation;
6. compatibility with repository architecture;
7. appropriate validation or tests;
8. absence of material errors;
9. absence of unsafe remediation.

Multiple remediation strategies may be valid. Each case records required facts, acceptable strategies, invalid strategies, and unsafe strategies rather than requiring exact text.

## Economics

Record end-to-end wall time, model and tool requests, input/output tokens, provider-reported cost, files read, malformed attempts, and retries. Failed attempts remain in accounting where provider usage is available.

## Pilot gates

The pilot is exploratory. Before a held-out run, freeze these intended claim gates:

- actionable review rate no more than five percentage points below direct Terra;
- material-error and unsafe-remediation rates no higher than direct Terra;
- at least 1.5× faster;
- at least 15% cheaper.

## Exclusions

This benchmark does not establish:

- Jev detection quality;
- false-candidate verification quality;
- missing-evidence retrieval quality;
- end-to-end review recall.

Those are separate benchmarks. A later integration run replaces gold packets with actual Jev and verification output.
