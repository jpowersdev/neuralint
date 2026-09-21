# Rule doctor: OPENCODE_PREFER_BUN_APIS

## Deterministic checks

No deterministic issues found.

## Jev quality checks

| Check | Failure probability | Result |
|---|---:|---|
| Operational violation boundary | 54% | advisory |
| Internal consistency | 23% | pass |
| Applicability clarity | 30% | pass |
| Operational exceptions | 37% | pass |
| Evidence feasibility | 68% | advisory |
| Actionable remediation | 25% | pass |
| Faithful example labels | 54% | advisory |
| Boundary example coverage | 18% | pass |

Jev usage: 1 request, 1822 input tokens.

## Quality concerns

### Operational violation boundary · advisory · 54%

The boundary relies on subjective, undefined, circular, or non-operational terms that require guessing.

Relevant fields: `instructions`, `criteria.violation`, `criteria.compliant`, `semantic.reportWhen`.

Suggested next step: Define the triggering source facts explicitly and contrast them with a recognizable compliant or excluded case.

### Evidence feasibility · advisory · 68%

The rule requires facts outside its evidence preset, or the evidence requirement is inherently unbounded or unspecified.

Relevant fields: `criteria.violation`, `semantic.reportWhen`, `semantic.evidence`.

Suggested next step: Either narrow the decision to facts present in the selected evidence or choose the smallest bounded evidence preset that can establish them.

### Faithful example labels · advisory · 54%

At least one example is mislabeled, unexplained, contradictory, or cannot be decided from the example evidence.

Relevant fields: `criteria`, `semantic.examples`.

Suggested next step: Replace examples whose outcomes cannot be derived directly from the criteria, and explain the deciding fact in each example.

## Astra explanation

“Complete enclosing operation” has no clear boundary, and enclosing-symbol evidence may omit callers or runtime configuration needed to establish equivalence. “Shows no semantic or runtime reason” risks treating absent constraints as proof, despite the explicit evidence requirement. The asynchronous example omits runtime context; the synchronous example clearly demonstrates its constraint. These are expression and evidence concerns, not established policy gaps.

Human policy decision required: no

Questions for the maintainer:
- What evidence establishes the operation boundary and required runtime?
- Is the asynchronous example intended to assume Bun-compatible runtime evidence not shown?

Astra usage: 609 input tokens, 118 output tokens, $0.01199.

The doctor diagnoses rule authorship quality; it does not determine organizational policy or modify the active rule.
