import { createRequire } from "node:module"
import * as path from "node:path"

import type { Language, Node, Parser } from "@vscode/tree-sitter-wasm"

import type * as ChangedSpan from "./ChangedSpan.js"

export interface SourceRange {
  readonly startLine: number
  readonly endLine: number
  readonly source: string
  readonly nodeTypes?: ReadonlyArray<string>
}

export interface EvidenceBundle {
  readonly localBlock: SourceRange
  readonly scopes: ReadonlyArray<SourceRange>
  readonly comments: ReadonlyArray<SourceRange>
}

interface Runtime {
  readonly Parser: {
    readonly init: () => Promise<void>
    new(): Parser
  }
  readonly Language: {
    readonly load: (path: string) => Promise<Language>
  }
}

const require = createRequire(import.meta.url)
const runtime = require("@vscode/tree-sitter-wasm") as Runtime
const wasmDirectory = path.dirname(require.resolve("@vscode/tree-sitter-wasm"))
const maximumScopeLines = 80
const maximumScopes = 4

const grammarByExtension: Readonly<Record<string, string>> = {
  ".bash": "bash",
  ".c": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "c-sharp",
  ".css": "css",
  ".go": "go",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".php": "php",
  ".ps1": "powershell",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx"
}

let initialized: Promise<void> | undefined
const languages = new Map<string, Promise<Language>>()

const initialize = (): Promise<void> => initialized ??= runtime.Parser.init()

const languageFor = async (filePath: string): Promise<Language | undefined> => {
  const grammar = grammarByExtension[path.extname(filePath).toLowerCase()]
  if (grammar === undefined) return undefined
  await initialize()
  let language = languages.get(grammar)
  if (language === undefined) {
    language = runtime.Language.load(path.join(wasmDirectory, `tree-sitter-${grammar}.wasm`))
    languages.set(grammar, language)
  }
  return language
}

const sourceRange = (lines: ReadonlyArray<string>, startLine: number, endLine: number, nodeTypes?: ReadonlyArray<string>): SourceRange => ({
  startLine,
  endLine,
  source: lines.slice(startLine - 1, endLine).join("\n"),
  ...(nodeTypes === undefined ? {} : { nodeTypes })
})

const localBlock = (lines: ReadonlyArray<string>, target: ChangedSpan.LineRange): SourceRange => {
  let startLine = target.startLine
  while (startLine > 1 && lines[startLine - 2]?.trim() !== "") startLine--
  let endLine = target.endLine
  while (endLine < lines.length && lines[endLine]?.trim() !== "") endLine++
  if (endLine - startLine + 1 > maximumScopeLines) {
    const targetLines = target.endLine - target.startLine + 1
    const remaining = Math.max(0, maximumScopeLines - targetLines)
    const before = Math.floor(remaining / 2)
    startLine = Math.max(startLine, target.startLine - before)
    endLine = Math.min(endLine, startLine + maximumScopeLines - 1)
    if (endLine < target.endLine) {
      endLine = target.endLine
      startLine = Math.max(1, endLine - maximumScopeLines + 1)
    }
  }
  return sourceRange(lines, startLine, endLine)
}

const nodeEndLine = (node: Node): number =>
  node.endPosition.row + (node.endPosition.column === 0 ? 0 : 1)

const commentsOf = (
  root: Node,
  lines: ReadonlyArray<string>,
  largest: SourceRange
): ReadonlyArray<SourceRange> => {
  const raw: Array<readonly [number, number]> = []
  const stack: Array<Node> = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined) continue
    if (node.type === "comment") raw.push([node.startPosition.row + 1, nodeEndLine(node)])
    for (const child of node.namedChildren) if (child !== null) stack.push(child)
  }
  raw.sort((left, right) => left[0] - right[0])
  const groups: Array<[number, number]> = []
  for (const [start, end] of raw) {
    const previous = groups.at(-1)
    if (previous !== undefined && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else groups.push([start, end])
  }
  return groups.flatMap(([start, end]) => {
    const inside = largest.startLine <= start && end <= largest.endLine
    const immediatelyBefore = end < largest.startLine && largest.startLine - end <= 1
    return inside || immediatelyBefore ? [sourceRange(lines, start, end)] : []
  })
}

const bundleFor = (
  root: Node,
  lines: ReadonlyArray<string>,
  target: ChangedSpan.LineRange
): EvidenceBundle | undefined => {
  if (target.startLine < 1 || target.startLine > lines.length) return undefined
  const startRow = target.startLine - 1
  const endRow = Math.min(lines.length - 1, target.endLine - 1)
  const node = root.descendantForPosition(
    { row: startRow, column: 0 },
    { row: endRow, column: lines[endRow]?.length ?? 0 }
  )
  if (node === null) return undefined

  const grouped = new Map<string, { readonly start: number; readonly end: number; readonly types: Array<string> }>()
  let current: Node | null = node
  while (current !== null && current.parent !== null) {
    if (current.isNamed) {
      const start = current.startPosition.row + 1
      const end = nodeEndLine(current)
      const count = end - start + 1
      if (start <= target.startLine && target.endLine <= end && count <= maximumScopeLines) {
        const key = `${start}:${end}`
        const present = grouped.get(key)
        if (present === undefined) grouped.set(key, { start, end, types: [current.type] })
        else present.types.push(current.type)
      }
    }
    current = current.parent
  }
  const ordered = [...grouped.values()]
    .sort((left, right) => (left.end - left.start) - (right.end - right.start) || left.start - right.start)
  const selected = ordered.length <= maximumScopes
    ? ordered
    : [ordered[0]!, ...ordered.slice(-(maximumScopes - 1))]
  const scopes = selected.map((scope) => sourceRange(lines, scope.start, scope.end, scope.types))
  if (scopes.length === 0) return undefined
  return {
    localBlock: localBlock(lines, target),
    scopes,
    comments: commentsOf(root, lines, scopes.at(-1)!)
  }
}

export const buildMany = async (
  filePath: string,
  source: string,
  targets: ReadonlyArray<{ readonly id: string; readonly range: ChangedSpan.LineRange }>
): Promise<ReadonlyMap<string, EvidenceBundle>> => {
  const language = await languageFor(filePath)
  if (language === undefined || targets.length === 0) return new Map()
  const parser = new runtime.Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  if (tree === null) {
    parser.delete()
    return new Map()
  }
  try {
    if (tree.rootNode.hasError) return new Map()
    const lines = source.split("\n")
    const bundles = new Map<string, EvidenceBundle>()
    for (const target of targets) {
      const bundle = bundleFor(tree.rootNode, lines, target.range)
      if (bundle !== undefined) bundles.set(target.id, bundle)
    }
    return bundles
  } finally {
    tree.delete()
    parser.delete()
  }
}

export const build = async (
  filePath: string,
  source: string,
  target: ChangedSpan.LineRange
): Promise<EvidenceBundle | undefined> =>
  (await buildMany(filePath, source, [{ id: "target", range: target }])).get("target")

export const render = (bundle: EvidenceBundle): string => [
  `LOCAL BLOCK [${bundle.localBlock.startLine}-${bundle.localBlock.endLine}]:\n${bundle.localBlock.source}`,
  ...bundle.scopes.map((scope, index) =>
    `TREE-SITTER SCOPE ${index + 1} [${scope.startLine}-${scope.endLine}]${scope.nodeTypes === undefined ? "" : ` (${scope.nodeTypes.join(", ")})`}:\n${scope.source}`),
  ...bundle.comments.map((comment, index) =>
    `ASSOCIATED COMMENT ${index + 1} [${comment.startLine}-${comment.endLine}]:\n${comment.source}`)
].join("\n\n")

export const renderCompact = (bundle: EvidenceBundle): string => {
  const scope = bundle.scopes.at(-1) ?? bundle.localBlock
  return [
    `ENCLOSING SEMANTIC SCOPE [${scope.startLine}-${scope.endLine}]${scope.nodeTypes === undefined ? "" : ` (${scope.nodeTypes.join(", ")})`}:\n${scope.source}`,
    ...bundle.comments.map((comment, index) =>
      `ASSOCIATED COMMENT ${index + 1} [${comment.startLine}-${comment.endLine}]:\n${comment.source}`)
  ].join("\n\n")
}
