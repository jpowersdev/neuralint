# neuralint

Fast semantic linting for changed code, powered by TypeSafe AI's Jev.

`neuralint` lets a repository keep versioned engineering rules alongside its code. It compares the selected base ref with `HEAD`, evaluates applicable rules against changed code in a bounded Jev decision matrix, and returns localized candidate violations that a coding agent can act on immediately.

The intended product carries repository-owned guidance through the lifecycle of a change:

```text
Before generation
  repository rules → portable agent context

Before mutation
  proposed edit → semantic guard → allow, warn, or deny

Before publication
  merge-base diff → semantic check → pre-push and CI feedback

Human review
  semantic finding → focused reviewer → repository-specific remediation
```

The fast, read-only `check` command and Jev-based `rules doctor` diagnostics are implemented. Portable `context` output, pre-edit `guard` integrations, and focused human-review remediation remain product goals not yet exposed as public CLI commands.

## Status

**Alpha.** The CLI is usable for repository-local, diff-scoped semantic rules. Rule and JSON report formats may change before 1.0.

Current capabilities:

- `neuralint init` repository bootstrap;
- `.neuralint/config.yaml` repository configuration;
- rules under `.neuralint/rules/**/*.yaml`;
- `neuralint rules list`, `neuralint rules validate`, and Jev-based `neuralint rules doctor`;
- strict schemas, duplicate-ID checks, and example validation;
- merge-base-aware Git diffs;
- deterministic path routing and changed-span locations;
- optional local Tree-sitter scope ladders and associated comments for supported languages;
- Jev packs constrained by the documented 64k aggregate and 32k binding budgets;
- bounded, concurrent decision-matrix requests with deterministic oversize splitting;
- text and versioned JSON output;
- optional rule background, exceptions, guidance, evidence scope, and contrastive examples.

Still planned:

- portable, deterministic rule context for any coding harness;
- a host-neutral pre-edit guard and thin integrations for supported harnesses;
- first-party Git pre-push integration for `check`;
- related-definition and repository evidence retrieval;
- focused human-review remediation as a CLI command;
- rule generation and whole-pack behavioral regression;
- provider abstraction, redaction, and local/self-hosted deployment options.

## Requirements

- Node.js 26 or newer
- A TypeSafe AI API key
- A Git repository
- For optional `rules doctor --explain` only: Pi credentials and model configuration with access to GPT-6 Astra; neuralint embeds [`effect-pi`](https://github.com/jpowersdev/effect-pi)

```sh
export TYPESAFE_API_KEY="..."
```

`TYPESAFE_API_URL` may select a compatible approved endpoint.

## Install

```sh
npm install --global neuralint@alpha
neuralint --version
```

Pin `neuralint@0.1.0-alpha.2` in automation while the package is in alpha.

To run from a checkout instead:

```sh
pnpm install
pnpm check
pnpm build
npm link
```

## Quick start

From a Git repository:

```sh
neuralint init --base origin/main
```

This creates:

```text
.neuralint/
├── config.yaml
└── rules/
    └── no-secret-logging.yaml
```

The command is idempotent and does not overwrite existing configuration or rules.

Inspect and edit the generated example, then run:

```sh
neuralint rules validate
neuralint rules list
neuralint check
```

By default, `check` prints only definitive matches. Include inconclusive semantic advisories explicitly:

```sh
neuralint check --advisories
```

Machine-readable output:

```sh
neuralint check --format json
```

Override the configured base for one invocation:

```sh
neuralint check --base origin/develop
```

Run against another checkout:

```sh
neuralint check --root ../service
```

Evaluate only one named rule against the Git diff:

```sh
neuralint check --rule EXAMPLE_NO_SECRET_LOGGING
```

Evaluate unsaved source or an editor selection through stdin:

```sh
cat src/client.ts | neuralint check \
  --stdin \
  --path src/client.ts \
  --rule EXAMPLE_NO_SECRET_LOGGING \
  --format json
```

For a selection that begins later in the file:

```sh
printf '%s\n' 'logger.info({ token })' | neuralint check \
  --stdin --path src/client.ts --start-line 42 \
  --rule EXAMPLE_NO_SECRET_LOGGING --format json
```

Stdin is treated as newly proposed code rather than compared with Git. JSON findings include deterministic `locations` containing path, old/new side, start line, end line, role, and precision. This is the initial editor-integration surface.

## Repository configuration

`.neuralint/config.yaml` deliberately starts small:

```yaml
version: 1
base: origin/main
```

Command-line `--base` overrides the configured value. In the absence of a configuration file, `check` remains backward compatible and defaults to `main`.

## Rule management

```sh
# Validate schemas, IDs, examples, and thresholds
neuralint rules validate

# Show ID, severity, evidence scope, and title
neuralint rules list

# Run deterministic and Jev quality checks
neuralint rules doctor --rule EXAMPLE_NO_SECRET_LOGGING

# Include authoritative guidance in source-alignment checks
neuralint rules doctor \
  --rule EXAMPLE_NO_SECRET_LOGGING \
  --source AGENTS.md

# Ask Astra to explain any Jev concerns without rewriting the rule
neuralint rules doctor \
  --rule EXAMPLE_NO_SECRET_LOGGING \
  --source AGENTS.md \
  --explain
```

`rules doctor` validates the active catalog first and asks Jev a fixed matrix of rule-quality questions covering operational boundaries, consistency, applicability, exceptions, evidence feasibility, remediation, and examples. With `--source`, it also checks alignment with authoritative guidance. A check is an advisory at 45% failure probability and a failure at 75%; these are fixed product thresholds, not per-rule tuning. A 16-rule controlled calibration corpus found the advisory band deliberately sensitive but did not cleanly validate the failure band, so both remain provisional pending independently authored, blinded examples.

Doctor always writes a human-readable `report.md` under `.neuralint/doctor/<rule-id>/`, with authored explanations, relevant fields, and general next steps for every advisory or failure. It does not invoke a general model by default. `--explain` uses the embedded `effect-pi` integration to send only the concerns and focused rule data to Astra, which may add one concise contextual diagnosis and maintainer questions. Astra is explicitly prohibited from rewriting the rule or inventing policy. Doctor never writes a patch or modifies active policy.

Planned maintainer commands:

```text
neuralint rules generate
neuralint rules test
```

Generated or repaired rules remain Git-reviewable drafts; neuralint does not silently publish inferred organizational policy.

## Rule format

The generated example demonstrates the complete current format:

```yaml
version: 1
id: EXAMPLE_NO_SECRET_LOGGING
title: Do not write secrets to logs
description: Credentials and tokens must not be written to application logs.
severity: critical
scope:
  include: ["**/*.ts", "**/*.py"]
  exclude: ["**/generated/**", "**/vendor/**"]
instructions: Inspect changed logging calls and values flowing into them.
criteria:
  violation: Changed code logs an actual secret value.
  compliant: Logs exclude the value or use established redaction.
thresholds:
  screenAt: 0.35
  violationAt: 0.8
semantic:
  context: Logs are retained and exposed more broadly than production secrets.
  reportWhen: A changed logger or trace field receives a secret value.
  doNotReport: Do not report secret names, presence checks, or safely redacted values.
  guidance: Remove the value and retain only non-sensitive operation metadata.
  evidence: enclosing-symbol
  examples:
    - outcome: violation
      explanation: The bearer token itself is logged.
      code: logger.info("calling provider", { token: config.apiToken })
    - outcome: nonviolation
      explanation: Only credential presence is logged.
      code: logger.info("configured", { hasToken: config.apiToken.length > 0 })
```

Semantic guidance accepts 2–4 examples and requires both violation and nonviolation outcomes. Evidence scope is one of:

```text
changed-span
enclosing-symbol
complete-file
related-definitions
repository
```

The runtime always derives deterministic changed spans. For `enclosing-symbol`, it parses the complete file locally when a bundled Tree-sitter grammar is available, then sends bounded ancestor ranges and associated comments rather than the complete syntax tree. `complete-file` sends the selected file subject to the evidence-size limit. Related-definition and repository retrieval remain under development.

## Fast execution model

```text
merge-base(base, HEAD) → deterministic changed spans
                        → optional local syntax scope bundles
                        → deterministic path routing
                        → rule × span decision matrix
                        → dual-budget Jev packs
                        → optional bounded evidence refinement
                        → span-localized findings
```

Base request count is determined by matrix size and the documented provider budgets. Inconclusive findings that request enclosing-symbol or complete-file evidence may receive one additional packed refinement stage; neuralint never performs one request per finding.

A finding means Jev classified a changed span as matching a rule's violation condition. It is not mathematical proof. Probabilities route findings and uncertainty; severity comes from the authored rule.

Exit codes:

- `0`: no visible findings;
- `1`: at least one definitive candidate violation;
- `2`: configuration/provider failure, or an inconclusive finding when `--advisories` is enabled.

## Data handling

`check` is read-only with respect to reviewed source code. It invokes Git to compute a diff and sends applicable rule text plus changed evidence to the configured TypeSafe API endpoint. Evidence-scoped rules may also send bounded unchanged source, enclosing syntax scopes, associated comments, or a complete file.

Diffs and contextual evidence may contain proprietary code or secrets. Do not run neuralint on data you are not authorized to send to that endpoint. The alpha does not yet provide redaction. JSON and text reports also contain relevant diff content and must be handled accordingly.

The API key is loaded through Effect's redacted configuration and is not included in reports.

`rules doctor` sends the selected rule and, when supplied, up to 40,000 characters of the `--source` guidance file to the configured TypeSafe Jev endpoint. Only when `--explain` is requested and Jev reports a concern does it send the focused concern packet through `effect-pi` to Astra. The embedded session uses no tools and an empty resource loader, so extensions, skills, prompt templates, and automatic context-file discovery are disabled. Review both providers' approval and data-retention terms before using explanation. Doctor reports can quote policy text and should be handled as repository data.

## Benchmarks

Benchmarks are supporting evidence, not production reliability claims.

### Fast matrix feasibility

[`benchmark/jev-matrix/`](benchmark/jev-matrix/README.md) evaluates 30 Effect rules against 30 changed files:

| Measure | Result |
|---|---:|
| Rule/change decisions | 900 |
| Jev requests | 2 in the direct matrix spike; 4 in the span/evidence production packer |
| Production-packer latency | **1.565 seconds** |
| Expected findings retained | **30/30** |
| Expected findings definitive | **30/30** |
| Production-packer estimated cost | **$0.00864** |

The corpus is positive-heavy and unexpected findings are not exhaustively adjudicated, so this establishes feasibility and expected-candidate recall—not precision.

### Focused remediation

[`benchmark/remediation/results/REPORT.md`](benchmark/remediation/results/REPORT.md) compares full-catalog Terra with a human-authored confirmed packet handed to Terra across five Home Assistant regressions:

| Workflow | Actionable | Time | Cost |
|---|---:|---:|---:|
| Full-catalog Terra | 5/5 | 513.5s | $0.127532 |
| Gold handoff → Terra | 5/5 | **154.9s** | **$0.096778** |

The focused arm was 3.31× faster and 24.1% cheaper. Blinded Sol/high judging scored all ten reviews actionable, with zero material errors, zero unsafe remediation, and ten pairwise ties. The result is a five-case pilot using gold packets, not an end-to-end detection claim.

Additional historical benchmark suites remain under [`benchmark/`](benchmark/).

## Development

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

The project uses pinned matching Effect v4 release-candidate packages.
