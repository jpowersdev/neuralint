import type * as Domain from "./Domain.js"

export const fromText = (path: string, source: string, startLine: number): Domain.DiffSet => {
  const lines = source === "" ? [] : source.replace(/\n$/, "").split("\n")
  const count = lines.length
  const header = `@@ -0,0 +${startLine},${count} @@`
  const body = lines.map((line) => `+${line}`).join("\n")
  const patch = body === "" ? header : `${header}\n${body}`
  const hunk: Domain.DiffHunk = {
    id: "FSTDIN:H001",
    header,
    oldStart: 0,
    oldLines: 0,
    newStart: startLine,
    newLines: count,
    patch
  }
  return {
    base: "stdin",
    head: "BUFFER",
    files: [{
      id: "FSTDIN",
      oldPath: "/dev/null",
      newPath: path,
      path,
      patch,
      hunks: [hunk],
      newSource: source
    }]
  }
}
