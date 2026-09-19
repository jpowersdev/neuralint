# neuralint

AI code review against your repository's rules, powered by TypeSafe AI's Jev.

`neuralint` treats review policy as versioned repository artifacts. It compares the merge base of a selected ref with `HEAD`, screens every applicable rule against coherent diff packs, localizes positive rules to individual hunks, and emits a structured list of candidate violations for a human or another agent to investigate.

## Status

Early prototype. The first vertical slice includes:

- rules discovered from `.neuralint/rules/**/*.yaml`;
- strict schema validation with duplicate-ID and threshold checks;
- merge-base-aware Git diffs;
- unified-diff parsing into stable file and hunk IDs;
- deterministic path-based rule applicability;
- a high-recall screening pass followed by focused hunk localization;
- TypeSafe Jev through Effect's provider-neutral `DecisionModel` and `@effect/ai-typesafe`;
- text and versioned JSON output.

It does not yet implement request caching, repository configuration, cross-file rule scopes, or token-aware request batching.

## Install for development

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

`@effect/ai-typesafe` and Effect's CLI are currently Effect v4 release-candidate APIs and are pinned together.

## Repository setup

Create rule artifacts in the repository being reviewed:

```text
.neuralint/
└── rules/
    ├── boundaries/
    │   └── unvalidated-input.yaml
    └── security/
        └── authorization.yaml
```

See [`examples/.neuralint/rules/unvalidated-input.yaml`](examples/.neuralint/rules/unvalidated-input.yaml) for a complete rule.

For a runnable, PR-shaped repository with two policies and two intentional violations, see [`examples/unsafe-service`](examples/unsafe-service/README.md).

## Usage

This repository's `.envrc` loads ignored local settings from `.envrc.local`. For development:

```sh
printf '%s\n' 'export TYPESAFE_API_KEY="..."' > .envrc.local
direnv allow

# Compare merge-base(main, HEAD) to HEAD
neuralint check --base main

# Compare against another ref and emit machine-readable output
neuralint check --base origin/develop --format json

# Run against another checkout
neuralint check --root ../service --base origin/main
```

Exit codes:

- `0`: no candidate violations or inconclusive findings;
- `1`: at least one candidate violation;
- `2`: configuration/provider failure or an inconclusive finding.

### Reading a finding

A finding means Jev classified a specific diff hunk as matching a policy's violation condition. It is not an independently verified diagnosis. Text and JSON output include:

- the policy description and its explicit violation/compliance conditions;
- the file, stable hunk ID, and exact relevant diff;
- the broad screening probability and focused hunk probability.

Probabilities are model outputs used for routing and thresholding, not calibrated severity scores. Severity comes from the repository-authored policy.

## Rule artifact

```yaml
version: 1
id: AUTH001
title: Mutating endpoints require authorization
description: State-changing endpoints must be protected by an authorization policy.
severity: critical
scope:
  include: ["src/api/**/*.ts"]
  exclude: ["**/*.test.ts"]
instructions: >-
  Check new or changed mutation paths. Account for authorization inherited from
  enclosing routers or middleware.
criteria:
  violation: >-
    The change introduces or exposes a state mutation that can execute without
    an applicable authorization check.
  compliant: >-
    Authorization is guaranteed locally or by visible enclosing infrastructure,
    or the changed path cannot mutate state.
thresholds:
  screenAt: 0.35
  violationAt: 0.85
```

`screenAt` is deliberately lower than `violationAt`. The first pass optimizes for recall; only positive rules pay for a second localization request.

## Review pipeline

```text
base ref ── merge-base ── HEAD
                    │
                    ▼
             semantic diff hunks
                    │
       path selectors route applicable rules
                    │
                    ▼
      Jev screen: rule × coherent diff pack
                    │
          probabilities >= screenAt
                    │
                    ▼
       Jev localize: rule × individual hunk
                    │
                    ▼
 versioned report: violations + inconclusive findings
```

The report calls these **candidate violations**. Jev is a fast policy classifier, not a proof system. A remediation agent should independently inspect the referenced code and rule before proposing changes.

## Planned next steps

1. Add token-aware packing and question batching under Jev's request budget.
2. Add a content-addressed cache keyed by model, rule, and evidence.
3. Add file, component, and PR-global rule scopes for cross-hunk invariants.
4. Include base/head source context for changed symbols when a diff is insufficient.
5. Add SARIF and GitHub Checks output.
6. Add a verification command that prepares focused evidence bundles for a stronger agent.
7. Calibrate per-rule thresholds from accepted and rejected findings.
