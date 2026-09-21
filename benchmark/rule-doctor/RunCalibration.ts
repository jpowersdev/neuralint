import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import * as Effect from "effect/Effect"

import * as Ai from "../../src/Ai.js"
import * as RuleDoctor from "../../src/RuleDoctor.js"
import { cases, checkIds, type CalibrationCase, type CheckId, type ExpectedStatus } from "./Corpus.js"

const directory = path.dirname(fileURLToPath(import.meta.url))
const outputDirectory = path.join(directory, "results")
const jsonPath = path.join(outputDirectory, "calibration.json")
const reportPath = path.join(outputDirectory, "CALIBRATION.md")
const jevInputUsdPerMillionTokens = 0.042
const currentAdvisoryThreshold = 0.45
const currentFailureThreshold = 0.75
const repetitions = 3

interface Observation {
  readonly caseId: string
  readonly category: CalibrationCase["category"]
  readonly checkId: CheckId
  readonly expected: ExpectedStatus
  readonly probability: number
}

interface Metrics {
  readonly threshold: number
  readonly truePositives: number
  readonly falsePositives: number
  readonly trueNegatives: number
  readonly falseNegatives: number
  readonly precision: number
  readonly recall: number
  readonly specificity: number
  readonly f1: number
}

const ratio = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator
const rounded = (value: number): number => Math.round(value * 10_000) / 10_000
const percent = (value: number): string => `${Math.round(value * 100)}%`

const metricsAt = (
  observations: ReadonlyArray<Observation>,
  threshold: number,
  positive: (status: ExpectedStatus) => boolean
): Metrics => {
  let truePositives = 0
  let falsePositives = 0
  let trueNegatives = 0
  let falseNegatives = 0
  for (const observation of observations) {
    const expectedPositive = positive(observation.expected)
    const predictedPositive = observation.probability >= threshold
    if (expectedPositive && predictedPositive) truePositives++
    else if (!expectedPositive && predictedPositive) falsePositives++
    else if (!expectedPositive) trueNegatives++
    else falseNegatives++
  }
  const precision = ratio(truePositives, truePositives + falsePositives)
  const recall = ratio(truePositives, truePositives + falseNegatives)
  return {
    threshold,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precision: rounded(precision),
    recall: rounded(recall),
    specificity: rounded(ratio(trueNegatives, trueNegatives + falsePositives)),
    f1: rounded(ratio(2 * precision * recall, precision + recall))
  }
}

const thresholds = Array.from({ length: 19 }, (_, index) => (index + 1) * 0.05)
const best = (values: ReadonlyArray<Metrics>): Metrics => [...values].sort((left, right) =>
  right.f1 - left.f1 || right.precision - left.precision || right.threshold - left.threshold
)[0]!

const metricLine = (label: string, metrics: Metrics): string =>
  `| ${label} | ${metrics.threshold.toFixed(2)} | ${percent(metrics.precision)} | ${percent(metrics.recall)} | ${percent(metrics.specificity)} | ${percent(metrics.f1)} | ${metrics.truePositives} | ${metrics.falsePositives} | ${metrics.falseNegatives} |`

const program = Effect.gen(function* () {
  const startedAt = performance.now()
  const runs = yield* Effect.forEach(cases, (entry) => Effect.gen(function* () {
    const started = performance.now()
    const samples = yield* Effect.forEach(
      Array.from({ length: repetitions }),
      () => RuleDoctor.diagnose(entry.rule),
      { concurrency: 1 }
    )
    const checks = samples[0]!.diagnostics.map((diagnostic) => {
      const probabilities = samples.map((sample) =>
        sample.diagnostics.find((candidate) => candidate.id === diagnostic.id)?.failureProbability ?? 1
      ).sort((left, right) => left - right)
      const probability = probabilities[Math.floor(probabilities.length / 2)]!
      return {
        id: diagnostic.id as CheckId,
        expected: entry.expected[diagnostic.id as CheckId],
        probability,
        probabilities,
        productStatus: probability >= currentFailureThreshold
          ? "failure" as const
          : probability >= currentAdvisoryThreshold ? "advisory" as const : "pass" as const
      }
    })
    return {
      caseId: entry.id,
      category: entry.category,
      rationale: entry.rationale,
      latencyMs: Math.round(performance.now() - started),
      usage: {
        requests: samples.reduce((sum, sample) => sum + sample.usage.requests, 0),
        inputTokens: samples.reduce((sum, sample) => sum + sample.usage.inputTokens, 0),
        outputTokens: samples.reduce((sum, sample) => sum + sample.usage.outputTokens, 0)
      },
      checks
    }
  }), { concurrency: 4 })

  const observations: ReadonlyArray<Observation> = runs.flatMap((run) => run.checks.map((check) => ({
    caseId: run.caseId,
    category: run.category,
    checkId: check.id,
    expected: check.expected,
    probability: check.probability
  })))
  const advisorySweep = thresholds.map((threshold) => metricsAt(observations, threshold, (status) => status !== "pass"))
  const failureSweep = thresholds.map((threshold) => metricsAt(observations, threshold, (status) => status === "failure"))
  const advisoryCurrent = metricsAt(observations, currentAdvisoryThreshold, (status) => status !== "pass")
  const failureCurrent = metricsAt(observations, currentFailureThreshold, (status) => status === "failure")
  const advisoryBest = best(advisorySweep)
  const failureBest = best(failureSweep)
  const ruleObservations: ReadonlyArray<Observation> = runs.map((run) => ({
    caseId: run.caseId,
    category: run.category,
    checkId: checkIds[0],
    expected: run.checks.some((check) => check.expected === "failure")
      ? "failure"
      : run.checks.some((check) => check.expected === "advisory") ? "advisory" : "pass",
    probability: Math.max(...run.checks.map((check) => check.probability))
  }))
  const ruleAdvisorySweep = thresholds.map((threshold) => metricsAt(ruleObservations, threshold, (status) => status !== "pass"))
  const ruleFailureSweep = thresholds.map((threshold) => metricsAt(ruleObservations, threshold, (status) => status === "failure"))
  const ruleAdvisoryCurrent = metricsAt(ruleObservations, currentAdvisoryThreshold, (status) => status !== "pass")
  const ruleFailureCurrent = metricsAt(ruleObservations, currentFailureThreshold, (status) => status === "failure")
  const ruleAdvisoryBest = best(ruleAdvisorySweep)
  const ruleFailureBest = best(ruleFailureSweep)
  const totalInputTokens = runs.reduce((sum, run) => sum + run.usage.inputTokens, 0)
  const totalOutputTokens = runs.reduce((sum, run) => sum + run.usage.outputTokens, 0)
  const spreads = runs.flatMap((run) => run.checks.map((check) => ({
    caseId: run.caseId,
    checkId: check.id,
    minimum: Math.min(...check.probabilities),
    maximum: Math.max(...check.probabilities),
    spread: Math.max(...check.probabilities) - Math.min(...check.probabilities)
  })))
  const stability = {
    maximumSpread: rounded(Math.max(...spreads.map((entry) => entry.spread))),
    advisoryThresholdCrossings: spreads.filter((entry) => entry.minimum < currentAdvisoryThreshold && entry.maximum >= currentAdvisoryThreshold).length,
    failureThresholdCrossings: spreads.filter((entry) => entry.minimum < currentFailureThreshold && entry.maximum >= currentFailureThreshold).length,
    widest: [...spreads].sort((left, right) => right.spread - left.spread).slice(0, 10)
  }
  const categorySummary = [...new Set(cases.map((entry) => entry.category))].map((category) => {
    const selected = runs.filter((run) => run.category === category)
    return {
      category,
      cases: selected.length,
      casesWithExpectedConcern: selected.filter((run) => run.checks.some((check) => check.expected !== "pass")).length,
      casesFlaggedAtCurrentAdvisory: selected.filter((run) => run.checks.some((check) => check.probability >= currentAdvisoryThreshold)).length,
      casesFailedAtCurrentFailure: selected.filter((run) => run.checks.some((check) => check.probability >= currentFailureThreshold)).length
    }
  })
  const perCheck = checkIds.map((checkId) => {
    const selected = observations.filter((observation) => observation.checkId === checkId)
    return {
      checkId,
      expectedConcerns: selected.filter((observation) => observation.expected !== "pass").length,
      advisory: metricsAt(selected, currentAdvisoryThreshold, (status) => status !== "pass"),
      expectedFailures: selected.filter((observation) => observation.expected === "failure").length,
      failure: metricsAt(selected, currentFailureThreshold, (status) => status === "failure")
    }
  })
  const result = {
    schemaVersion: 1,
    experiment: "rule-doctor-balanced-calibration",
    model: "jev-latest",
    corpus: {
      cases: cases.length,
      checksPerCase: checkIds.length,
      observations: observations.length,
      categories: categorySummary
    },
    execution: {
      concurrency: 4,
      repetitions,
      latencyMs: Math.round(performance.now() - startedAt),
      requests: runs.reduce((sum, run) => sum + run.usage.requests, 0),
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd: rounded(totalInputTokens / 1_000_000 * jevInputUsdPerMillionTokens)
    },
    stability,
    currentThresholds: {
      checkLevel: { advisory: advisoryCurrent, failure: failureCurrent },
      ruleLevel: { advisory: ruleAdvisoryCurrent, failure: ruleFailureCurrent }
    },
    bestObservedThresholds: {
      checkLevel: { advisory: advisoryBest, failure: failureBest },
      ruleLevel: { advisory: ruleAdvisoryBest, failure: ruleFailureBest }
    },
    perCheck,
    sweeps: {
      checkLevel: { advisory: advisorySweep, failure: failureSweep },
      ruleLevel: { advisory: ruleAdvisorySweep, failure: ruleFailureSweep }
    },
    runs
  }

  const categoryRows = categorySummary.map((row) =>
    `| ${row.category} | ${row.cases} | ${row.casesWithExpectedConcern} | ${row.casesFlaggedAtCurrentAdvisory} | ${row.casesFailedAtCurrentFailure} |`
  )
  const mismatches = runs.flatMap((run) => run.checks
    .filter((check) => (check.expected !== "pass") !== (check.probability >= currentAdvisoryThreshold))
    .map((check) => `- \`${run.caseId}\` / \`${check.id}\`: expected ${check.expected}, Jev ${Math.round(check.probability * 100)}% (${check.productStatus})`))
  const report = [
    "# Rule doctor calibration",
    "",
    "This controlled corpus contains four good, four clearly defective, four ambiguous, and four evidence-infeasible rules. Labels are human-authored at the fixed-check level. Controlled mutations isolate known authorship defects; this is a calibration baseline, not an estimate of production prevalence.",
    "",
    "## Execution",
    "",
    `- ${cases.length} rules × ${checkIds.length} checks = ${observations.length} labeled observations`,
    `- Median probability across ${repetitions} repeated evaluations per rule`,
    `- ${result.execution.requests} Jev requests at concurrency ${result.execution.concurrency}`,
    `- ${result.execution.latencyMs} ms wall time`,
    `- ${result.execution.inputTokens.toLocaleString()} input tokens`,
    `- Estimated Jev input cost: $${result.execution.estimatedCostUsd.toFixed(5)}`,
    `- Maximum repeated-score spread: ${Math.round(stability.maximumSpread * 100)} percentage points; ${stability.advisoryThresholdCrossings} advisory and ${stability.failureThresholdCrossings} failure threshold crossings`,
    "",
    "## Rule-level detection",
    "",
    "| Category | Cases | Expected concern | Flagged ≥45% | Failed ≥75% |",
    "|---|---:|---:|---:|---:|",
    ...categoryRows,
    "",
    "## Threshold metrics",
    "",
    "Advisory metrics treat both human-labeled advisories and failures as positive. Failure metrics treat only human-labeled failures as positive. Rule-level scores use each rule's maximum check probability, matching whether the CLI emits any concern at a band.",
    "",
    "| Band | Threshold | Precision | Recall | Specificity | F1 | TP | FP | FN |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    metricLine("Rule: current advisory", ruleAdvisoryCurrent),
    metricLine("Rule: best observed advisory", ruleAdvisoryBest),
    metricLine("Rule: current failure", ruleFailureCurrent),
    metricLine("Rule: best observed failure", ruleFailureBest),
    metricLine("Check: current advisory", advisoryCurrent),
    metricLine("Check: best observed advisory", advisoryBest),
    metricLine("Check: current failure", failureCurrent),
    metricLine("Check: best observed failure", failureBest),
    "",
    "## Current-advisory mismatches",
    "",
    ...(mismatches.length === 0 ? ["None."] : mismatches),
    "",
    "## Interpretation boundary",
    "",
    "Do not change product thresholds from this small controlled corpus alone. Prefer thresholds that preserve precision for good rules, then expand with independently authored and blinded examples before treating the bands as calibrated.",
    ""
  ].join("\n")

  yield* Effect.promise(async () => {
    await fs.mkdir(outputDirectory, { recursive: true })
    await Promise.all([
      fs.writeFile(jsonPath, JSON.stringify(result, null, 2) + "\n"),
      fs.writeFile(reportPath, report)
    ])
  })
  console.log(report)
  console.log(`Wrote ${jsonPath}`)
})

await Effect.runPromise(program.pipe(Effect.provide(Ai.decisionModelLayer)))
