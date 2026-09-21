import * as it from "@effect/vitest"

import type * as Domain from "../src/Domain.js"
import * as ChangedSpan from "../src/ChangedSpan.js"

const file = (patch: string, newLines: number, oldLines = 0): Domain.FileDiff => ({
  id: "F001",
  oldPath: oldLines === 0 ? "/dev/null" : "src/example.ts",
  newPath: "src/example.ts",
  path: "src/example.ts",
  patch,
  hunks: [{
    id: "F001:H001",
    header: `@@ -1,${oldLines} +1,${newLines} @@`,
    oldStart: 1,
    oldLines,
    newStart: 1,
    newLines,
    patch
  }]
})

it.describe("ChangedSpan", () => {
  it.it("splits a large new file at deterministic blank-delimited blocks", () => {
    const lines = [
      "import { test } from 'bun:test'",
      "",
      "const original = process.env.VALUE",
      "",
      "afterEach(() => {",
      "  if (original === undefined) delete process.env.VALUE",
      "  else process.env.VALUE = original",
      "})",
      "",
      ...Array.from({ length: 50 }, (_, index) => `export const value${index} = ${index}`)
    ]
    const patch = `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`
    const spans = ChangedSpan.extractFile(file(patch, lines.length))

    it.expect(spans.length).toBeGreaterThan(3)
    const relevant = spans.find((span) => span.primaryPatch.includes("else process.env.VALUE"))
    it.expect(relevant?.newRange).toEqual({ startLine: 5, endLine: 8 })
    it.expect(relevant?.id).toContain(":O-:N5-8")
    it.expect(Math.max(...spans.map((span) => span.newRange?.endLine ?? 0))).toBe(lines.length)
  })

  it.it("tracks both old and new coordinates for a replacement", () => {
    const patch = "@@ -10,2 +10,2 @@\n-const mode = 'old'\n+const mode = 'new'\n keep()"
    const diff = file(patch, 2, 2)
    const spans = ChangedSpan.extractFile({
      ...diff,
      hunks: [{
        id: "F001:H001", header: "@@ -10,2 +10,2 @@", oldStart: 10, oldLines: 2,
        newStart: 10, newLines: 2, patch
      }]
    })

    it.expect(spans).toHaveLength(1)
    it.expect(spans[0]?.oldRange).toEqual({ startLine: 10, endLine: 10 })
    it.expect(spans[0]?.newRange).toEqual({ startLine: 10, endLine: 10 })
  })
})
