# Rule-doctor calibration

This suite evaluates the fixed Jev rule-quality matrix and the optional Astra explanation separately.

## Balanced controlled corpus

`Corpus.ts` defines 16 human-labeled rules:

- four good rules with concrete boundaries, exceptions, remediation, evidence, and contrastive examples;
- four clearly defective rules with controlled contradictions, mislabeled examples, circular remediation, or broad underspecification;
- four ambiguous rules whose boundaries depend on undefined judgments;
- four evidence-infeasible rules whose selected evidence cannot establish call-graph, runtime, cross-file, or deployment facts.

Every rule has a human-authored expected status for each of the eight fixed checks. `RunCalibration.ts` evaluates every rule three times, uses the median probability, and reports both rule-level and check-level threshold metrics.

```sh
pnpm benchmark:doctor:calibrate
```

The current result is in [`results/CALIBRATION.md`](results/CALIBRATION.md), with raw probabilities and threshold sweeps in [`results/calibration.json`](results/calibration.json).

### Current interpretation

At the rule level, the current 45% advisory band found all 12 rules with an expected concern and flagged one of four good rules. An advisory band around 65–70% separated this controlled corpus in repeated runs, but that result is too small and synthetic to justify changing the product threshold. At the individual-check level, 45% retained 97% recall but only about 50% precision; defects in one field often raised probabilities for adjacent checks.

The 75% failure band did not cleanly separate clear defects from ambiguous rules: the recorded run reached 60% rule-level precision and 75% recall, with nearby repeated runs varying materially. No scalar threshold solved that separation. This indicates that the failure band is not calibrated yet and may require clearer severity semantics or independently authored labels, rather than merely moving the cutoff.

The provisional decision is therefore:

- keep 45% as a deliberately sensitive advisory threshold while collecting natural examples;
- do not claim that 75% is calibrated;
- do not change either product threshold from this controlled corpus alone;
- prioritize independently authored, blinded rules before threshold changes.

## Astra explanation validation

`ValidateExplanations.ts` runs three focused cases through the published `@jpowersdev/effect-pi` integration and records actual usage.

```sh
pnpm benchmark:doctor:explain
```

The current result is in [`results/explanation-validation.json`](results/explanation-validation.json), with rendered reports under [`results/explanation-validation/`](results/explanation-validation/).

Manual adjudication:

| Case | Expected behavior | Result |
|---|---|---|
| Good rule | No concern and no Astra call | Pass |
| Deliberately defective rule | Explain missing boundaries, require human policy decisions, do not draft policy | Pass |
| Bun evidence case | Distinguish evidence/expression limitations from an absent policy decision | Pass |

The Bun case exposed an important response-contract ambiguity: “human decision” was initially interpreted as any maintainer decision. The prompt now defines `requiresHumanDecision` as true only for a missing organizational-policy decision. Astra then correctly marked the Bun evidence-planner concern false while still asking implementation-oriented evidence questions.

These explanation calls are quality checks, not threshold calibration. Astra remains opt-in and never edits active policy.
