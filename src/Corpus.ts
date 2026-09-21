import type * as Domain from "./Domain.js"

export interface Document {
  readonly id: string
  readonly path: string
  readonly content: string
}

export interface Segment {
  readonly documentId: string
  readonly path: string
  readonly hunkId: string
  readonly startOffset: number
  readonly endOffset: number
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}

export interface Corpus {
  readonly diff: Domain.DiffSet
  readonly segments: ReadonlyArray<Segment>
}

const lineAt = (source: string, offset: number): number => {
  let line = 1
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) line++
  }
  return line
}

/**
 * Presents each prose paragraph as a synthetic added hunk. Review can then run
 * its normal bounded rule × hunk matrix while callers retain exact offsets for
 * editor highlighting.
 */
export const fromDocuments = (documents: ReadonlyArray<Document>): Corpus => {
  const segments: Array<Segment> = []
  const files: Array<Domain.FileDiff> = []

  for (let fileIndex = 0; fileIndex < documents.length; fileIndex++) {
    const document = documents[fileIndex]
    if (document === undefined) continue
    const fileId = `D${String(fileIndex + 1).padStart(4, "0")}`
    const hunks: Array<Domain.DiffHunk> = []
    const paragraphPattern = /\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/g
    let match: RegExpExecArray | null
    let hunkIndex = 0

    while ((match = paragraphPattern.exec(document.content)) !== null) {
      const text = match[0]
      const startOffset = match.index
      const endOffset = startOffset + text.length
      const startLine = lineAt(document.content, startOffset)
      const lineCount = text.split("\n").length
      const endLine = startLine + lineCount - 1
      const hunkId = `${fileId}:H${String(++hunkIndex).padStart(4, "0")}`
      const header = `@@ -0,0 +${startLine},${lineCount} @@`
      const patch = `${header}\n${text.split("\n").map((line) => `+${line}`).join("\n")}`
      hunks.push({
        id: hunkId,
        header,
        oldStart: 0,
        oldLines: 0,
        newStart: startLine,
        newLines: lineCount,
        patch
      })
      segments.push({
        documentId: document.id,
        path: document.path,
        hunkId,
        startOffset,
        endOffset,
        startLine,
        endLine,
        text
      })
    }

    files.push({
      id: fileId,
      oldPath: "/dev/null",
      newPath: document.path,
      path: document.path,
      patch: hunks.map((hunk) => hunk.patch).join("\n"),
      hunks,
      newSource: document.content
    })
  }

  return {
    diff: { base: "corpus", head: "BUFFER", files },
    segments
  }
}
