import * as it from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import * as AssessmentPlanner from "../src/AssessmentPlanner.js"
import * as Domain from "../src/Domain.js"
import * as Review from "../src/Review.js"

const makeRule = (planner?: string) => Schema.decodeUnknownSync(Domain.ReviewRule)({
  version: 1,
  id: planner === "filenames" ? "FILES001" : "SEMANTIC001",
  title: "Assessment rule",
  description: "Assess the selected collection.",
  severity: "warning",
  scope: { include: ["src/**/*.ts", "test/**/*.ts"], exclude: [] },
  instructions: "Use only the supplied assessment case.",
  criteria: { violation: "The case violates the policy.", compliant: "The case satisfies the policy." },
  thresholds: { screenAt: 0.3, violationAt: 0.8 },
  ...(planner === undefined ? {} : { assessment: { planner } })
})

const diff: Domain.DiffSet = {
  base: "base",
  head: "head",
  files: [{
    id: "F001",
    oldPath: "/dev/null",
    newPath: "src/Accounts.ts",
    path: "src/Accounts.ts",
    patch: "@@ -0,0 +1,1 @@\n+export class Accounts {}",
    hunks: [{
      id: "F001:H001",
      header: "@@ -0,0 +1,1 @@",
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      patch: "@@ -0,0 +1,1 @@\n+export class Accounts {}"
    }],
    newSource: "export class Accounts {}"
  }, {
    id: "F002",
    oldPath: "test/Accounts.test.ts",
    newPath: "test/Accounts.test.ts",
    path: "test/Accounts.test.ts",
    patch: "@@ -1,1 +1,1 @@\n+describe(\"Accounts\", () => {})",
    hunks: [{
      id: "F002:H001",
      header: "@@ -1,1 +1,1 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      patch: "@@ -1,1 +1,1 @@\n+describe(\"Accounts\", () => {})"
    }],
    newSource: "describe(\"Accounts\", () => {})"
  }]
}

it.describe("AssessmentPlanner", () => {
  it.effect("uses bounded semantic chunks by default", () =>
    AssessmentPlanner.plan(diff, [makeRule()]).pipe(Effect.map((plan) => {
      it.expect(plan.diagnostics).toEqual([])
      it.expect(plan.rules[0]?.planner).toBe("semantic-chunks")
      it.expect(plan.rules[0]?.partitioning).toBe("independent-cases")
      it.expect(plan.rules[0]?.cases).toHaveLength(2)
      it.expect(plan.rules[0]?.cases[0]?.subjects[0]?.sources[0]?.path).toBe("src/Accounts.ts")
    })))

  it.effect("projects the complete matching path manifest with filenames", () =>
    AssessmentPlanner.plan(diff, [makeRule("filenames")]).pipe(Effect.map((plan) => {
      const assessment = plan.rules[0]?.cases[0]
      it.expect(assessment?.planner).toBe("filenames")
      it.expect(assessment?.partitioning).toBe("global-unsplittable")
      it.expect(assessment?.completeness).toEqual({
        status: "complete",
        basis: "all files in the caller-selected collection matching the rule scope were listed",
        filesConsidered: 2
      })
      it.expect(JSON.stringify(assessment?.evidence[0]?.facts)).toContain("src/Accounts.ts")
      it.expect(JSON.stringify(assessment?.evidence[0]?.facts)).toContain("test/Accounts.test.ts")
      it.expect(assessment?.relevantDiff).toContain("added")
      it.expect(assessment?.locations).toHaveLength(2)
    })))

  it.effect("preflights cases and request estimates without a decision model", () =>
    Review.plan(diff, [makeRule("filenames")], { maxStateChars: 60_000 }).pipe(Effect.map((plan) => {
      it.expect(plan.cases).toBe(1)
      it.expect(plan.requests).toBe(1)
      it.expect(plan.planners).toEqual([{
        ruleId: "FILES001",
        planner: "filenames",
        partitioning: "global-unsplittable",
        cases: 1
      }])
    })))
})
