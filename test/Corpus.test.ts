import * as it from "@effect/vitest"

import * as Corpus from "../src/Corpus.js"

it.describe("Corpus", () => {
  it.it("builds uniquely-addressed paragraph hunks with editor offsets", () => {
    const corpus = Corpus.fromDocuments([
      {
        id: "document-7",
        path: "documents/document-7.md",
        content: "First paragraph.\nStill first.\n\nSecond paragraph."
      },
      {
        id: "document-8",
        path: "documents/document-8.md",
        content: "Another document."
      }
    ])

    it.expect(corpus.diff.files).toHaveLength(2)
    it.expect(corpus.diff.files[0]?.hunks).toHaveLength(2)
    it.expect(corpus.segments.map((segment) => segment.hunkId)).toEqual([
      "D0001:H0001",
      "D0001:H0002",
      "D0002:H0001"
    ])
    it.expect(corpus.segments[1]).toMatchObject({
      documentId: "document-7",
      startOffset: 31,
      endOffset: 48,
      startLine: 4,
      endLine: 4,
      text: "Second paragraph."
    })
  })
})
