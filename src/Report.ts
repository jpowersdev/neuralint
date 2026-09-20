import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import * as Domain from "./Domain.js"

export type OutputFormat = "text" | "json"

const percent = (value: number): string => `${Math.round(value * 100)}%`

const indent = (value: string, spaces: number): ReadonlyArray<string> => {
  const prefix = " ".repeat(spaces)
  return value.trimEnd().split("\n").map((line) => `${prefix}${line}`)
}

export const renderText = (report: Domain.ReviewReport): string => {
  const lines: Array<string> = []
  const violations = report.findings.filter((finding) => finding.status === "violation")
  const inconclusive = report.findings.filter((finding) => finding.status === "inconclusive")

  lines.push(`neuralint ${report.base}..${report.head}`)
  lines.push(`${report.filesReviewed} file(s), ${report.rulesLoaded} rule(s), ${report.usage.requests} Jev request(s)`)
  lines.push("")

  let currentRule = ""
  for (const finding of report.findings) {
    if (finding.ruleId !== currentRule) {
      if (currentRule !== "") lines.push("")
      currentRule = finding.ruleId
      lines.push(`${finding.ruleId} [${finding.severity}] ${finding.ruleTitle}`)
      lines.push(`  Policy: ${finding.ruleDescription}`)
      lines.push(`  Violation condition: ${finding.violationCondition}`)
      lines.push(`  Compliant when: ${finding.complianceCondition}`)
    }
    const primary = finding.locations?.find((location) => location.role === "primary")
    const location = primary === undefined
      ? `${finding.path} (${finding.hunkId})`
      : `${primary.path}:${primary.startLine}-${primary.endLine}`
    lines.push(`  ${finding.status === "violation" ? "VIOLATION" : "INCONCLUSIVE"} at ${location}`)
    lines.push(`    Jev match probability: ${percent(finding.violationProbability)}`)
    lines.push("    Relevant diff:")
    lines.push(...indent(finding.relevantDiff, 6))
  }

  if (report.findings.length === 0) lines.push("No candidate violations.")
  lines.push("")
  lines.push(`${violations.length} violation(s), ${inconclusive.length} inconclusive`)
  return `${lines.join("\n")}\n`
}

export const renderJson = Effect.fn("Report.renderJson")(function* (report: Domain.ReviewReport) {
  const encoded = yield* Schema.encodeEffect(Domain.ReviewReport)(report)
  return `${JSON.stringify(encoded, null, 2)}\n`
})

export const render = (report: Domain.ReviewReport, format: OutputFormat) =>
  format === "json" ? renderJson(report) : Effect.succeed(renderText(report))

export const exitCode = (report: Domain.ReviewReport): number => {
  if (report.findings.some((finding) => finding.status === "inconclusive")) return 2
  if (report.findings.some((finding) => finding.status === "violation")) return 1
  return 0
}
