# Rule doctor: CAL_DEFECTIVE_UNDERSPECIFIED

## Deterministic checks

No deterministic issues found.

## Jev quality checks

| Check | Failure probability | Result |
|---|---:|---|
| Operational violation boundary | 95% | failure |
| Internal consistency | 73% | advisory |
| Applicability clarity | 91% | failure |
| Operational exceptions | 70% | advisory |
| Evidence feasibility | 87% | failure |
| Actionable remediation | 92% | failure |
| Faithful example labels | 87% | failure |
| Boundary example coverage | 94% | failure |

Jev usage: 1 request, 1580 input tokens.

## Quality concerns

### Operational violation boundary · failure · 95%

The boundary relies on subjective, undefined, circular, or non-operational terms that require guessing.

Relevant fields: `instructions`, `criteria.violation`, `criteria.compliant`, `semantic.reportWhen`.

Suggested next step: Define the triggering source facts explicitly and contrast them with a recognizable compliant or excluded case.

### Internal consistency · advisory · 73%

Two or more rule fields contradict, materially broaden, or materially narrow one another.

Relevant fields: `description`, `instructions`, `criteria`, `semantic`.

Suggested next step: Choose one policy boundary and make every criterion, exception, and example describe that same boundary.

### Applicability clarity · failure · 91%

Important applicability conditions are missing, circular, or dependent on unstated policy.

Relevant fields: `scope`, `instructions`, `criteria`, `semantic.reportWhen`, `semantic.doNotReport`.

Suggested next step: State the preconditions that make the rule applicable and identify the nearest superficially similar non-applicable case.

### Operational exceptions · advisory · 70%

Exceptions use undefined judgment calls, contradict the rule, or leave an explicitly mentioned near miss undecidable.

Relevant fields: `criteria.compliant`, `semantic.doNotReport`, `semantic.examples`.

Suggested next step: Express exceptions as observable conditions. If the organization has not decided the exception, record a human policy question instead of guessing.

### Evidence feasibility · failure · 87%

The rule requires facts outside its evidence preset, or the evidence requirement is inherently unbounded or unspecified.

Relevant fields: `criteria.violation`, `semantic.reportWhen`, `semantic.evidence`.

Suggested next step: Either narrow the decision to facts present in the selected evidence or choose the smallest bounded evidence preset that can establish them.

### Actionable remediation · failure · 92%

The guidance is absent, circular, unsafe, or merely repeats that the violation should be removed.

Relevant fields: `semantic.guidance`, `instructions`.

Suggested next step: Describe the desired corrective direction and constraints without prescribing a repository-specific implementation that the policy does not support.

### Faithful example labels · failure · 87%

At least one example is mislabeled, unexplained, contradictory, or cannot be decided from the example evidence.

Relevant fields: `criteria`, `semantic.examples`.

Suggested next step: Replace examples whose outcomes cannot be derived directly from the criteria, and explain the deciding fact in each example.

### Boundary example coverage · failure · 94%

The examples do not exercise both sides of the actual policy boundary or omit the rule's central exception.

Relevant fields: `semantic.examples`, `semantic.doNotReport`.

Suggested next step: Use contrastive examples that differ in the specific fact deciding the rule, including its most important exception or near miss.

## Astra explanation

“Preferred,” “best,” and “good reason” lack concrete boundaries. Scope identifies files, not applicable API choices. Identical examples receive opposite outcomes without distinguishing context. Changed-span evidence may not establish API necessity or alternatives; “Fix the issue” provides no actionable direction. No authoritative guidance resolves these gaps.

Human policy decision required: yes

Questions for the maintainer:
- Which APIs are preferred over which alternatives, and under what conditions?
- What reasons justify retaining a nonpreferred API?

Astra usage: 442 input tokens, 103 output tokens, $0.00957.

The doctor diagnoses rule authorship quality; it does not determine organizational policy or modify the active rule.
