import type * as Domain from "./Domain.js"

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

const normalizePath = (path: string): string => {
  const trimmed = path.trim()
  if (trimmed === "/dev/null") return trimmed
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) return trimmed.slice(2)
  return trimmed
}

interface MutableFile {
  id: string
  oldPath: string
  newPath: string
  lines: Array<string>
  hunks: Array<Domain.DiffHunk>
}

interface MutableHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: Array<string>
}

export const parse = (source: string, base: string, head: string): Domain.DiffSet => {
  const files: Array<Domain.FileDiff> = []
  let file: MutableFile | undefined
  let hunk: MutableHunk | undefined

  const finishHunk = () => {
    if (file === undefined || hunk === undefined) return
    const index = file.hunks.length + 1
    file.hunks.push({
      id: `${file.id}:H${String(index).padStart(3, "0")}`,
      header: hunk.header,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      patch: hunk.lines.join("\n")
    })
    hunk = undefined
  }

  const finishFile = () => {
    if (file === undefined) return
    finishHunk()
    const path = file.newPath === "/dev/null" ? file.oldPath : file.newPath
    files.push({
      id: file.id,
      oldPath: file.oldPath,
      newPath: file.newPath,
      path,
      hunks: file.hunks,
      patch: file.lines.join("\n")
    })
    file = undefined
  }

  for (const line of source.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finishFile()
      file = {
        id: `F${String(files.length + 1).padStart(3, "0")}`,
        oldPath: "",
        newPath: "",
        lines: [line],
        hunks: []
      }
      continue
    }
    if (file === undefined) continue
    file.lines.push(line)
    if (line.startsWith("--- ")) {
      file.oldPath = normalizePath(line.slice(4))
      continue
    }
    if (line.startsWith("+++ ")) {
      file.newPath = normalizePath(line.slice(4))
      continue
    }
    const match = hunkHeader.exec(line)
    if (match !== null) {
      finishHunk()
      hunk = {
        header: line,
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? "1"),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? "1"),
        lines: [line]
      }
      continue
    }
    hunk?.lines.push(line)
  }
  finishFile()

  return {
    base,
    head,
    files: files.filter((candidate) => candidate.oldPath !== "" && candidate.newPath !== "")
  }
}
