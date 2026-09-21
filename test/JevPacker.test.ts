import * as it from "@effect/vitest"

import * as JevPacker from "../src/JevPacker.js"

it.describe("JevPacker", () => {
  it.it("enforces total and binding budgets while preferring shared resources", () => {
    const resources = new Map([
      ["r1", { id: "r1", content: "a".repeat(3_000) }],
      ["r2", { id: "r2", content: "b".repeat(3_000) }]
    ])
    const packs = JevPacker.pack({
      resources,
      items: [
        { id: "a1", resourceIds: ["r1"], question: "q".repeat(1_000), value: "a1" },
        { id: "a2", resourceIds: ["r1"], question: "q".repeat(1_000), value: "a2" },
        { id: "b1", resourceIds: ["r2"], question: "q".repeat(1_000), value: "b1" }
      ],
      renderState: (selected) => JSON.stringify(selected.map((resource) => resource.content)),
      limits: { totalTokens: 3_300, bindingTokens: 3_000 }
    })

    it.expect(packs).toHaveLength(2)
    it.expect(packs.find((pack) => pack.resourceIds.includes("r1"))?.items.map((item) => item.id)).toEqual(["a1", "a2"])
    for (const pack of packs) {
      it.expect(pack.estimate.totalTokens).toBeLessThanOrEqual(3_300)
      it.expect(pack.estimate.bindingTokens).toBeLessThanOrEqual(3_000)
    }
  })

  it.it("rejects an item that violates the per-binding budget alone", () => {
    const resources = new Map([["large", { id: "large", content: "x".repeat(5_000) }]])
    it.expect(() => JevPacker.pack({
      resources,
      items: [{ id: "question", resourceIds: ["large"], question: "q", value: undefined }],
      renderState: (selected) => JSON.stringify(selected),
      limits: { totalTokens: 10_000, bindingTokens: 2_000 }
    })).toThrow("binding")
  })
})
