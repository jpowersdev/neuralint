import { createHash } from "node:crypto"

import type * as Domain from "./Domain.js"

export interface LineRange {
  readonly startLine: number
  readonly endLine: number
}

export interface ChangedSpan {
  readonly id: string
  readonly parentHunkId: string
  readonly path: string
  readonly header: string
  readonly primaryPatch: string
  readonly before: string
  readonly after: string
  readonly contextBefore: string
  readonly contextAfter: string
  readonly oldRange?: LineRange
  readonly newRange?: LineRange
}

interface PatchLine {
  readonly kind: "context" | "addition" | "deletion" | "metadata"
  readonly raw: string
  readonly text: string
  readonly oldLine?: number
  readonly newLine?: number
}

const maximumPrimaryLines = 40
const maximumPrimaryCharacters = 6_000
const contextLines = 3

const parseLines = (hunk: Domain.DiffHunk): ReadonlyArray<PatchLine> => {
  const output: Array<PatchLine> = []
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  const lines = hunk.patch.split("\n")
  const firstPatchLine = lines[0]?.startsWith("@@") ? 1 : 0
  for (let index = firstPatchLine; index < lines.length; index++) {
    const raw = lines[index] ?? ""
    if (raw.startsWith("+")) {
      output.push({ kind: "addition", raw, text: raw.slice(1), newLine })
      newLine++
    } else if (raw.startsWith("-")) {
      output.push({ kind: "deletion", raw, text: raw.slice(1), oldLine })
      oldLine++
    } else if (raw.startsWith(" ")) {
      output.push({ kind: "context", raw, text: raw.slice(1), oldLine, newLine })
      oldLine++
      newLine++
    } else {
      output.push({ kind: "metadata", raw, text: raw })
    }
  }
  return output
}

const isChanged = (line: PatchLine): boolean => line.kind === "addition" || line.kind === "deletion"

const splitLargeBlock = (block: ReadonlyArray<PatchLine>): ReadonlyArray<ReadonlyArray<PatchLine>> => {
  const characters = block.reduce((total, line) => total + line.raw.length + 1, 0)
  if (block.length <= maximumPrimaryLines && characters <= maximumPrimaryCharacters) return [block]

  const blankDelimited: Array<Array<PatchLine>> = []
  let current: Array<PatchLine> = []
  for (const line of block) {
    if (line.text.trim() === "") {
      if (current.length > 0) blankDelimited.push(current)
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) blankDelimited.push(current)

  const output: Array<ReadonlyArray<PatchLine>> = []
  for (const section of blankDelimited) {
    let start = 0
    while (start < section.length) {
      let end = Math.min(section.length, start + maximumPrimaryLines)
      let size = 0
      for (let index = start; index < end; index++) {
        const next = section[index]
        if (next === undefined) break
        if (index > start && size + next.raw.length + 1 > maximumPrimaryCharacters) {
          end = index
          break
        }
        size += next.raw.length + 1
      }
      if (end === start) end++
      output.push(section.slice(start, end))
      start = end
    }
  }
  return output
}

const rangeOf = (lines: ReadonlyArray<PatchLine>, side: "old" | "new"): LineRange | undefined => {
  const values = lines.flatMap((line) => {
    const value = side === "old" ? line.oldLine : line.newLine
    return value === undefined || (side === "old" ? line.kind === "addition" : line.kind === "deletion") ? [] : [value]
  })
  if (values.length === 0) return undefined
  return { startLine: Math.min(...values), endLine: Math.max(...values) }
}

const spanId = (path: string, oldRange: LineRange | undefined, newRange: LineRange | undefined): string => {
  const pathHash = createHash("sha256").update(path).digest("hex").slice(0, 10)
  const oldPart = oldRange === undefined ? "-" : `${oldRange.startLine}-${oldRange.endLine}`
  const newPart = newRange === undefined ? "-" : `${newRange.startLine}-${newRange.endLine}`
  return `S${pathHash}:O${oldPart}:N${newPart}`
}

export const extract = (file: Domain.FileDiff, hunk: Domain.DiffHunk): ReadonlyArray<ChangedSpan> => {
  const lines = parseLines(hunk)
  const blocks: Array<{ readonly start: number; readonly end: number; readonly lines: ReadonlyArray<PatchLine> }> = []
  let index = 0
  while (index < lines.length) {
    if (!isChanged(lines[index]!)) {
      index++
      continue
    }
    const start = index
    while (index < lines.length && isChanged(lines[index]!)) index++
    const block = lines.slice(start, index)
    let searchOffset = 0
    for (const section of splitLargeBlock(block)) {
      const first = section[0]
      if (first === undefined) continue
      const sectionOffset = block.indexOf(first, searchOffset)
      if (sectionOffset < 0) continue
      blocks.push({
        start: start + sectionOffset,
        end: start + sectionOffset + section.length,
        lines: section
      })
      searchOffset = sectionOffset + section.length
    }
  }

  return blocks.map((block) => {
    const oldRange = rangeOf(block.lines, "old")
    const newRange = rangeOf(block.lines, "new")
    const before = lines.slice(Math.max(0, block.start - contextLines), block.start)
    const after = lines.slice(block.end, Math.min(lines.length, block.end + contextLines))
    return {
      id: spanId(file.path, oldRange, newRange),
      parentHunkId: hunk.id,
      path: file.path,
      header: hunk.header,
      primaryPatch: block.lines.map((line) => line.raw).join("\n"),
      before: block.lines.filter((line) => line.kind !== "addition").map((line) => line.text).join("\n"),
      after: block.lines.filter((line) => line.kind !== "deletion").map((line) => line.text).join("\n"),
      contextBefore: before.map((line) => line.raw).join("\n"),
      contextAfter: after.map((line) => line.raw).join("\n"),
      ...(oldRange === undefined ? {} : { oldRange }),
      ...(newRange === undefined ? {} : { newRange })
    }
  })
}

export const extractFile = (file: Domain.FileDiff): ReadonlyArray<ChangedSpan> =>
  file.hunks.flatMap((hunk) => extract(file, hunk))
