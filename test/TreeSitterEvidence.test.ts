import * as it from "@effect/vitest"

import * as TreeSitterEvidence from "../src/TreeSitterEvidence.js"

it.describe("TreeSitterEvidence", () => {
  it.it("builds a bounded ancestor ladder with associated comments", async () => {
    const source = `const load = Effect.fn("load")(function* (path: string) {
  // Synchronous on purpose because startup cannot yield here.
  const value = yield* Effect.sync(() => {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return ""
    }
  })
  return value
})`
    const bundle = await TreeSitterEvidence.build("src/load.ts", source, { startLine: 5, endLine: 5 })

    it.expect(bundle).toBeDefined()
    it.expect(bundle?.scopes.length).toBeGreaterThan(1)
    it.expect(bundle?.scopes.at(-1)?.source).toContain("const load = Effect.fn")
    it.expect(bundle?.comments.map((comment) => comment.source).join("\n")).toContain("Synchronous on purpose")
  })

  it.it("caps blank-free local blocks below whole-file size", async () => {
    const source = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index}`).join("\n")
    const bundle = await TreeSitterEvidence.build("src/values.ts", source, { startLine: 100, endLine: 100 })

    it.expect(bundle).toBeDefined()
    it.expect((bundle?.localBlock.endLine ?? 0) - (bundle?.localBlock.startLine ?? 0) + 1).toBeLessThanOrEqual(80)
  })

  it.it("falls back when no grammar is available or parsing fails", async () => {
    it.expect(await TreeSitterEvidence.build("notes.md", "hello", { startLine: 1, endLine: 1 })).toBeUndefined()
    it.expect(await TreeSitterEvidence.build("src/broken.ts", "function broken( {", { startLine: 1, endLine: 1 })).toBeUndefined()
  })
})
