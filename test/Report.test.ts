import * as it from "@effect/vitest"
import * as Schema from "effect/Schema"

import * as Domain from "../src/Domain.js"
import * as Report from "../src/Report.js"

it.describe("Report", () => {
  it.it("renders candidate violations grouped by rule", () => {
    const ruleId = Schema.decodeUnknownSync(Domain.RuleId)("AUTH001")
    const output = Report.renderText({
      schemaVersion: 1,
      base: "abc",
      head: "HEAD",
      filesReviewed: 1,
      rulesLoaded: 1,
      findings: [{
        ruleId,
        ruleTitle: "Authorization required",
        ruleDescription: "Mutating endpoints must enforce authorization.",
        violationCondition: "A mutation can run without authorization.",
        complianceCondition: "Authorization is guaranteed before the mutation.",
        severity: "critical",
        status: "violation",
        path: "src/api.ts",
        hunkId: "F001:H001",
        hunkHeader: "@@ -1 +1 @@",
        relevantDiff: "@@ -1 +1 @@\n-run()\n+runWithoutAuthorization()",
        screeningProbability: 0.95,
        violationProbability: 0.91
      }],
      usage: { requests: 1, inputTokens: 100, outputTokens: 4 }
    })

    it.expect(output).toContain("AUTH001 [critical] Authorization required")
    it.expect(output).toContain("Policy: Mutating endpoints must enforce authorization.")
    it.expect(output).toContain("VIOLATION at src/api.ts (F001:H001)")
    it.expect(output).toContain("Jev match probability: 91%")
    it.expect(output).toContain("+runWithoutAuthorization()")
  })
})
